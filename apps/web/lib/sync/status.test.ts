import { describe, expect, it } from 'vitest';
import { computeSyncStatus, type SyncStatusInput } from './status';

function input(overrides: Partial<SyncStatusInput> = {}): SyncStatusInput {
  return {
    mode: 'supabase',
    online: true,
    signedIn: true,
    pendingCount: 0,
    deadLetterCount: 0,
    running: false,
    lastError: null,
    ...overrides,
  };
}

describe('computeSyncStatus', () => {
  it('zeigt "synchronisiert", wenn nichts aussteht', () => {
    const status = computeSyncStatus(input());
    expect(status.state).toBe('synced');
    expect(status.label).toBe('Synchronisiert');
    expect(status.tone).toBe('success');
  });

  it('zeigt ausstehende Anzahl, solange Einträge in der Outbox liegen', () => {
    const status = computeSyncStatus(input({ pendingCount: 3 }));
    expect(status.state).toBe('pending');
    expect(status.label).toBe('Ausstehend: 3');
  });

  it('zeigt offline mit ausstehender Anzahl', () => {
    const status = computeSyncStatus(input({ online: false, pendingCount: 2 }));
    expect(status.state).toBe('offline');
    expect(status.label).toBe('Offline – 2 ausstehend');
    expect(status.tone).toBe('warning');
  });

  it('zeigt Dead-Letter als Fehler', () => {
    const status = computeSyncStatus(input({ deadLetterCount: 1, pendingCount: 4 }));
    expect(status.state).toBe('error');
    expect(status.label).toBe('1 nicht synchronisiert');
    expect(status.tone).toBe('danger');
  });

  it('zeigt laufenden Sync', () => {
    const status = computeSyncStatus(input({ running: true, pendingCount: 2 }));
    expect(status.state).toBe('syncing');
    expect(status.label).toBe('Synchronisiere …');
  });

  it('zeigt Fehler ohne ausstehende Einträge', () => {
    const status = computeSyncStatus(input({ lastError: 'RLS verweigert' }));
    expect(status.state).toBe('error');
    expect(status.label).toBe('Sync-Fehler');
    expect(status.detail).toBe('RLS verweigert');
  });

  it('kennzeichnet den Mock-Modus als nur lokal', () => {
    const status = computeSyncStatus(input({ mode: 'mock' }));
    expect(status.state).toBe('local-only');
    expect(status.label).toBe('Nur lokal (Dev)');
    expect(status.tone).toBe('muted');
  });

  it('kennzeichnet abgemeldete Nutzer', () => {
    const status = computeSyncStatus(input({ signedIn: false }));
    expect(status.state).toBe('signed-out');
    expect(status.label).toBe('Nicht angemeldet');
  });
});
