import { afterEach, describe, expect, it } from 'vitest';
import { createRealtimeSource, createSyncAdapter } from './create-adapter';
import { LocalOnlySyncAdapter } from './local-adapter';
import { MockSyncAdapter } from './mock-adapter';
import { MockRealtimeSource } from './mock-realtime';

const ENV_KEYS = [
  'NEXT_PUBLIC_AUTH_MOCK',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('Adapter-Auswahl', () => {
  it('nutzt im Mock-Modus ohne Gegenstelle den LocalOnly-Adapter', () => {
    expect(createSyncAdapter('mock')).toBeInstanceOf(LocalOnlySyncAdapter);
  });

  it('nutzt im Mock-Sync-Modus den Dev-Mock-Adapter + Polling-Realtime', () => {
    const adapter = createSyncAdapter('mock-sync', { scope: 'haushalt-x' });
    expect(adapter).toBeInstanceOf(MockSyncAdapter);

    const realtime = createRealtimeSource('mock-sync', { scope: 'haushalt-x' });
    expect(realtime).toBeInstanceOf(MockRealtimeSource);
  });

  it('hat im reinen Mock-Modus keine Realtime-Quelle', () => {
    expect(createRealtimeSource('mock')).toBeUndefined();
  });

  it('laesst den Supabase-Pfad unangetastet', () => {
    const configured = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
    if (configured) {
      expect(createSyncAdapter('supabase').constructor.name).toBe('SupabaseSyncAdapter');
      expect(createRealtimeSource('supabase')).toBeDefined();
      return;
    }
    // Ohne Konfiguration muss der echte Client sauber scheitern (kein Mock-Fallback).
    expect(() => createSyncAdapter('supabase')).toThrow(/nicht konfiguriert/);
  });
});
