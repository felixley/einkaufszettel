import type { SyncAdapter } from '@einkaufszettel/core';
import type { SyncMode } from './status';
import { LocalOnlySyncAdapter } from './local-adapter';
import { SupabaseSyncAdapter } from './supabase-adapter';

/**
 * Wählt den Sync-Adapter passend zum Auth-Modus.
 *
 * Im Mock-Modus gibt es keinen Server; Einträge werden nur quittiert. Der
 * Status sagt das ausdrücklich („Nur lokal (Dev)“), statt einen Sync
 * vorzutäuschen.
 */
export function createSyncAdapter(mode: SyncMode): SyncAdapter {
  return mode === 'mock' ? new LocalOnlySyncAdapter() : new SupabaseSyncAdapter();
}
