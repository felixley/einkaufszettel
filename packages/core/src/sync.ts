import type { AddToListRequest } from './add-to-list.js';
import {
  acknowledge,
  createOutbox,
  DEFAULT_MAX_ATTEMPTS,
  pending,
  recordFailure,
  type BackoffOptions,
  type Clock,
  type FailureOptions,
  type Outbox,
  type OutboxEntry,
} from './outbox.js';
import type { ListItemRowData, RowId } from './types.js';

/**
 * Abstraktion des Sync-Ziels. Der Fake-Adapter in `testing/` implementiert sie
 * ohne Netzwerk; der echte Client spricht Supabase/PostgREST darüber an.
 *
 * Alle Methoden müssen idempotent sein:
 * - `upsert` per UUID (gleicher Inhalt → kein Zustandswechsel),
 * - `softDelete` mehrfach aufrufbar,
 * - `addToList` dedupliziert über `request_id`.
 */
export interface SyncAdapter {
  upsert(
    table: string,
    row: ListItemRowData,
    changedFields: readonly string[],
  ): void | Promise<void>;
  softDelete(table: string, id: RowId): void | Promise<void>;
  addToList(request: AddToListRequest): void | Promise<void>;
}

export interface ReplayOptions {
  maxAttempts?: number;
  /** Injizierbare Uhr für `next_attempt_at`; Default `new Date()`. */
  now?: Clock;
  /** Backoff-Konfiguration (Jitter, Deckel). */
  backoff?: BackoffOptions;
}

export interface ReplayResult {
  /** Outbox ohne erfolgreich angewendete Einträge. */
  outbox: Outbox;
  deadLetter: Outbox;
  applied: string[];
  failed: { id: string; error: unknown }[];
  deadLettered: string[];
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const serialized = JSON.stringify(error);
    return serialized === undefined ? String(error) : serialized;
  } catch {
    return String(error);
  }
}

async function applyEntry(adapter: SyncAdapter, entry: OutboxEntry): Promise<void> {
  switch (entry.op) {
    case 'upsert':
      await adapter.upsert(entry.table, entry.payload.row, entry.payload.changed_fields);
      return;
    case 'delete':
      await adapter.softDelete(entry.table, entry.payload.id);
      return;
    case 'add_to_list':
      await adapter.addToList(entry.payload);
      return;
  }
}

/**
 * Spielt die Outbox idempotent ab (PLAN.md §4.2).
 *
 * Einträge werden in `client_ts`-Reihenfolge angewendet. Erfolgreiche Einträge
 * werden quittiert und aus der Outbox entfernt; fehlgeschlagene bleiben mit
 * erhöhtem `attempts` zurück und wandern ab `maxAttempts` ins Dead-Letter.
 * Ein zweiter Lauf auf demselben Outbox-Stand erzeugt keine Duplikate, weil der
 * Adapter Upserts per UUID und RPCs per `request_id` dedupliziert.
 */
export async function replayOutbox(
  outbox: Outbox,
  adapter: SyncAdapter,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let current = outbox;
  let deadLetter = createOutbox();
  const applied: string[] = [];
  const failed: { id: string; error: unknown }[] = [];
  const deadLettered: string[] = [];

  for (const entry of pending(outbox)) {
    try {
      await applyEntry(adapter, entry);
      current = acknowledge(current, [entry.id]);
      applied.push(entry.id);
    } catch (error) {
      failed.push({ id: entry.id, error });
      const failureOptions: FailureOptions = {
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.backoff === undefined ? {} : { backoff: options.backoff }),
        lastError: errorText(error),
      };
      const result = recordFailure(current, entry.id, maxAttempts, failureOptions);
      current = result.outbox;
      if (result.deadLettered !== null) {
        deadLetter = { entries: [...deadLetter.entries, result.deadLettered] };
        deadLettered.push(entry.id);
      }
    }
  }

  return { outbox: current, deadLetter, applied, failed, deadLettered };
}
