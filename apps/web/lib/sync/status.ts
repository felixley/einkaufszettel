/**
 * Reine Status-Berechnung für die Sync-Anzeige (PLAN.md §4.2).
 *
 * Die UI zeigt genau einen von fünf Zuständen: synchronisiert, ausstehend: N,
 * offline, Fehler oder (Dev-Mock) nur lokal. Die Funktion ist frei von
 * Browser-/Dexie-Abhängigkeiten und damit unit-testbar.
 */

/**
 * `mock` = Dev-Mock ohne Sync-Gegenstelle (LocalOnlySyncAdapter, „Nur lokal“).
 * `mock-sync` = Dev-Mock mit In-Memory-Sync-Server + Polling-Realtime (T4.2a);
 * verhält sich statusseitig wie ein echter Server, nur ohne Persistenz.
 */
export type SyncMode = 'supabase' | 'mock' | 'mock-sync';

export type SyncState =
  'synced' | 'pending' | 'syncing' | 'offline' | 'error' | 'local-only' | 'signed-out';

export type SyncTone = 'success' | 'warning' | 'info' | 'danger' | 'muted';

export interface SyncStatus {
  state: SyncState;
  label: string;
  detail: string;
  tone: SyncTone;
  pendingCount: number;
  /** Anzahl dauerhaft fehlgeschlagener Einträge (Dead-Letter), T4.3. */
  deadLetterCount: number;
}

export interface SyncStatusInput {
  mode: SyncMode;
  online: boolean;
  signedIn: boolean;
  pendingCount: number;
  deadLetterCount: number;
  running: boolean;
  lastError: string | null;
}

export function computeSyncStatus(input: SyncStatusInput): SyncStatus {
  const base = {
    pendingCount: input.pendingCount,
    deadLetterCount: input.deadLetterCount,
  };

  if (input.mode === 'mock') {
    return {
      ...base,
      state: 'local-only',
      label: 'Nur lokal (Dev)',
      detail:
        'Dev-Mock-Auth: Es gibt keinen Server. Änderungen bleiben in dieser Browser-Datenbank.',
      tone: 'muted',
    };
  }

  if (!input.signedIn) {
    return {
      ...base,
      state: 'signed-out',
      label: 'Nicht angemeldet',
      detail: 'Ohne Anmeldung wird nicht synchronisiert. Lokale Änderungen bleiben erhalten.',
      tone: 'muted',
    };
  }

  if (!input.online) {
    return {
      ...base,
      state: 'offline',
      label:
        input.pendingCount > 0
          ? `Offline – ${input.pendingCount} ausstehend`
          : 'Offline – lokal gespeichert',
      detail:
        'Keine Netzverbindung. Schreibvorgänge liegen in der Outbox und werden nach Reconnect gesendet.',
      tone: 'warning',
    };
  }

  if (input.deadLetterCount > 0) {
    return {
      ...base,
      state: 'error',
      label: `${input.deadLetterCount} nicht synchronisiert`,
      detail:
        'Mindestens ein Eintrag ist dauerhaft fehlgeschlagen (Dead-Letter). Erneut versuchen oder Eintrag prüfen.',
      tone: 'danger',
    };
  }

  if (input.running) {
    return {
      ...base,
      state: 'syncing',
      label: 'Synchronisiere …',
      detail: `${input.pendingCount} Eintrag/Einträge werden gesendet.`,
      tone: 'info',
    };
  }

  if (input.lastError !== null && input.pendingCount === 0) {
    return {
      ...base,
      state: 'error',
      label: 'Sync-Fehler',
      detail: input.lastError,
      tone: 'danger',
    };
  }

  if (input.pendingCount > 0) {
    return {
      ...base,
      state: 'pending',
      label: `Ausstehend: ${input.pendingCount}`,
      detail: 'Änderungen sind lokal gespeichert und warten auf die Übertragung.',
      tone: 'warning',
    };
  }

  return {
    ...base,
    state: 'synced',
    label: 'Synchronisiert',
    detail:
      input.mode === 'mock-sync'
        ? 'Alle lokalen Änderungen sind auf dem Dev-Mock-Server angekommen (nicht persistent).'
        : 'Alle lokalen Änderungen sind auf dem Server angekommen.',
    tone: 'success',
  };
}
