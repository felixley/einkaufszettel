import type { SyncAdapter } from '@einkaufszettel/core';
import type { SyncMode } from './status';
import { LocalOnlySyncAdapter } from './local-adapter';
import { MockSyncAdapter } from './mock-adapter';
import { createMockRealtimeSource } from './mock-realtime';
import { createSupabaseRealtimeSource } from './realtime';
import type { RealtimeSource } from './realtime';
import { SupabaseSyncAdapter } from './supabase-adapter';

export interface SyncFactoryOptions {
  /** Sync-Scope (Haushalts-ID; im Dev-Mock notfalls `default-household`). */
  scope?: string;
  /** Basis-URL für die Mock-Route; im Browser leer (relative Route). */
  baseUrl?: string;
  /** Testbarer fetch für Mock-Adapter/-Realtime. */
  fetchImpl?: typeof fetch;
}

/**
 * Wählt den Sync-Adapter passend zum Auth-/Sync-Modus.
 *
 * - `supabase`: echter PostgREST-Adapter (unverändert).
 * - `mock-sync`: Dev-Mock-Adapter gegen die In-Memory-Route (T4.2a).
 * - `mock`: reiner No-op-Adapter; bleibt für Unit-Tests und als bewusster
 *   „Nur lokal (Dev)“-Modus erhalten.
 */
export function createSyncAdapter(mode: SyncMode, options: SyncFactoryOptions = {}): SyncAdapter {
  if (mode === 'supabase') return new SupabaseSyncAdapter();
  if (mode === 'mock-sync') {
    return new MockSyncAdapter({
      scope: options.scope ?? 'default-household',
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  }
  return new LocalOnlySyncAdapter();
}

/**
 * Passende Realtime-Quelle je Modus. `mock` hat bewusst keine Realtime.
 * Supabase wird erst bei Aufruf instanziiert (SSR-sicher).
 */
export function createRealtimeSource(
  mode: SyncMode,
  options: SyncFactoryOptions = {},
): RealtimeSource | undefined {
  if (mode === 'supabase') return createSupabaseRealtimeSource();
  if (mode === 'mock-sync') {
    return createMockRealtimeSource({
      scope: options.scope ?? 'default-household',
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    });
  }
  return undefined;
}
