'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/context/AuthContext';
import { getDb, indexedDbAvailable } from '@/lib/db/database';
import { countPending } from '@/lib/db/repository';
import { readCachedHouseholdId } from '@/lib/recipes/household-cache';
import { createRealtimeSource, createSyncAdapter } from './create-adapter';
import { computeSyncStatus, type SyncMode, type SyncStatus } from './status';
import { SyncWorker } from './worker';

interface SyncContextValue {
  status: SyncStatus;
  pendingCount: number;
  triggerSync: () => Promise<void>;
}

const INITIAL_STATUS: SyncStatus = {
  state: 'local-only',
  label: 'Sync wird vorbereitet …',
  detail: 'Die lokale Datenbank wird initialisiert.',
  tone: 'muted',
  pendingCount: 0,
};

const SyncContext = createContext<SyncContextValue>({
  status: INITIAL_STATUS,
  pendingCount: 0,
  triggerSync: async () => {},
});

/**
 * Startet den Sync-Worker im Browser und stellt den Status appweit bereit.
 *
 * Muss innerhalb von <AuthProvider> stehen. Im Mock-Auth-Modus läuft der Worker
 * gegen die Dev-Mock-Gegenstelle (`/api/mock/sync`) samt Polling-Realtime
 * (T4.2a); der Status verhält sich dann wie ein echter Server. Der reine
 * `LocalOnlySyncAdapter` bleibt als `mock`-Modus für Unit-Tests erhalten.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { user, mode, loading } = useAuth();
  const [status, setStatus] = useState<SyncStatus>(INITIAL_STATUS);
  const [pendingCount, setPendingCount] = useState(0);
  const workerRef = useRef<SyncWorker | null>(null);

  useEffect(() => {
    if (loading || !indexedDbAvailable()) return;

    const db = getDb();
    const workerMode: SyncMode = mode === 'mock' ? 'mock-sync' : 'supabase';
    // Dev-Mock-Scope: bevorzugt die zuletzt gecachte Haushalts-ID (damit zwei
    // Geraete desselben Haushalts konvergieren), sonst die Nutzer-ID als
    // dev-only Isolation. Supabase/RLS bleibt davon unberuehrt.
    const scope = readCachedHouseholdId() ?? user?.id ?? 'default-household';
    const signedIn = user !== null;
    const online = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine);

    if (!signedIn) {
      setStatus(
        computeSyncStatus({
          mode: workerMode,
          online: online(),
          signedIn: false,
          pendingCount: 0,
          deadLetterCount: 0,
          running: false,
          lastError: null,
        }),
      );
      return;
    }

    const adapter = createSyncAdapter(workerMode, { scope });
    const realtime = createRealtimeSource(workerMode, { scope });

    const worker = new SyncWorker({
      db,
      adapter,
      mode: workerMode,
      signedIn,
      online,
      onStatus: (next) => {
        setStatus(next);
        setPendingCount(next.pendingCount);
      },
      ...(realtime === undefined ? {} : { realtime }),
    });
    workerRef.current = worker;
    worker.start();

    void countPending(db)
      .then((count) => setPendingCount(count))
      .catch(() => setPendingCount(0));

    return () => {
      worker.stop();
      workerRef.current = null;
    };
  }, [mode, user, loading]);

  const triggerSync = useCallback(async () => {
    await workerRef.current?.syncNow();
  }, []);

  const value = useMemo<SyncContextValue>(
    () => ({ status, pendingCount, triggerSync }),
    [status, pendingCount, triggerSync],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  return useContext(SyncContext);
}
