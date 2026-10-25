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
import { createSyncAdapter } from './create-adapter';
import { createSupabaseRealtimeSource } from './realtime';
import { computeSyncStatus, type SyncStatus } from './status';
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
 * Muss innerhalb von <AuthProvider> stehen. Im Mock-Modus läuft der Worker mit
 * einem lokalen No-op-Adapter; der Status zeigt dann „Nur lokal (Dev)“.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { user, mode } = useAuth();
  const [status, setStatus] = useState<SyncStatus>(INITIAL_STATUS);
  const [pendingCount, setPendingCount] = useState(0);
  const workerRef = useRef<SyncWorker | null>(null);

  useEffect(() => {
    if (!indexedDbAvailable()) return;

    const db = getDb();
    const signedIn = mode === 'mock' || user !== null;
    const online = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine);

    if (!signedIn) {
      setStatus(
        computeSyncStatus({
          mode,
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

    const adapter = createSyncAdapter(mode);
    const realtime = mode === 'supabase' ? createSupabaseRealtimeSource() : undefined;

    const worker = new SyncWorker({
      db,
      adapter,
      mode,
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
  }, [mode, user]);

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
