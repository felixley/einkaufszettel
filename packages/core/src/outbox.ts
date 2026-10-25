import { compareTimestamps, timestampToMillis } from './time.js';
import type { AddToListRequest } from './add-to-list.js';
import type { IsoTimestamp, ListItemRowData, RowId } from './types.js';

export type OutboxOp = 'upsert' | 'delete' | 'add_to_list';

interface OutboxEntryBase {
  /** Idempotenzschlüssel des Outbox-Eintrags (UUIDv7). */
  id: string;
  table: string;
  /** Clientzeit; dient nur der Reihenfolge, nicht der Konfliktentscheidung. */
  client_ts: IsoTimestamp;
  attempts: number;
}

export interface UpsertEntry extends OutboxEntryBase {
  op: 'upsert';
  payload: {
    row: ListItemRowData;
    /** Felder, die dieser Schreibvorgang geändert hat. */
    changed_fields: readonly string[];
  };
}

export interface DeleteEntry extends OutboxEntryBase {
  op: 'delete';
  payload: { id: RowId };
}

export interface AddToListEntry extends OutboxEntryBase {
  op: 'add_to_list';
  payload: AddToListRequest;
}

export type OutboxEntry = UpsertEntry | DeleteEntry | AddToListEntry;

export interface Outbox {
  readonly entries: readonly OutboxEntry[];
}

export const DEFAULT_MAX_ATTEMPTS = 5;

export function createOutbox(entries: readonly OutboxEntry[] = []): Outbox {
  return { entries: [...entries] };
}

function rowKey(entry: OutboxEntry): string | null {
  switch (entry.op) {
    case 'upsert':
      return `${entry.table}:${entry.payload.row.id}`;
    case 'delete':
      return `${entry.table}:${entry.payload.id}`;
    case 'add_to_list':
      return null;
  }
}

function withAttempts(entry: OutboxEntry, attempts: number): OutboxEntry {
  return { ...entry, attempts } as OutboxEntry;
}

function mergeChangedFields(prior: readonly string[], next: readonly string[]): readonly string[] {
  return [...new Set([...prior, ...next])];
}

/**
 * Legt einen Outbox-Eintrag ab — rein und idempotent.
 *
 * - Gleiche `id` wird ignoriert (doppeltes Einreihen erzeugt kein Duplikat).
 * - `add_to_list` wird zusätzlich über `request_id` dedupliziert.
 * - Schreibvorgänge auf dieselbe Zeile werden zusammengefasst: Der letzte
 *   Upsert gewinnt (Felder werden vereinigt); ein Delete verdrängt alle
 *   Upserts derselben Zeile und gewinnt auch gegen später eintreffende Edits
 *   (PLAN.md §4.2: Delete gewinnt gegen Edit).
 */
export function enqueue(outbox: Outbox, entry: OutboxEntry): Outbox {
  if (outbox.entries.some((existing) => existing.id === entry.id)) return outbox;

  if (entry.op === 'add_to_list') {
    const duplicate = outbox.entries.some(
      (existing) =>
        existing.op === 'add_to_list' &&
        existing.table === entry.table &&
        existing.payload.request_id === entry.payload.request_id,
    );
    if (duplicate) return outbox;
    return { entries: [...outbox.entries, entry] };
  }

  const key = rowKey(entry);
  const withoutRow = outbox.entries.filter((existing) => rowKey(existing) !== key);

  if (entry.op === 'upsert') {
    const deletePending = outbox.entries.some(
      (existing) => existing.op === 'delete' && rowKey(existing) === key,
    );
    if (deletePending) return outbox;

    const prior = outbox.entries.find(
      (existing): existing is UpsertEntry => existing.op === 'upsert' && rowKey(existing) === key,
    );
    const merged: UpsertEntry = {
      ...entry,
      payload: {
        row: entry.payload.row,
        changed_fields:
          prior === undefined
            ? [...entry.payload.changed_fields]
            : mergeChangedFields(prior.payload.changed_fields, entry.payload.changed_fields),
      },
    };
    return { entries: [...withoutRow, merged] };
  }

  // delete: verdrängt alle Upserts derselben Zeile.
  return { entries: [...withoutRow, entry] };
}

/** Entfernt quittierte Einträge (nach erfolgreichem Replay). */
export function acknowledge(outbox: Outbox, ids: readonly string[]): Outbox {
  const acknowledged = new Set(ids);
  return { entries: outbox.entries.filter((entry) => !acknowledged.has(entry.id)) };
}

/** Einträge in Abspielreihenfolge (client_ts, dann id als deterministischer Tiebreak). */
export function pending(outbox: Outbox): OutboxEntry[] {
  return [...outbox.entries].sort((a, b) => {
    const comparison = compareTimestamps(a.client_ts, b.client_ts);
    return comparison !== 0 ? comparison : a.id.localeCompare(b.id);
  });
}

export interface FailureResult {
  outbox: Outbox;
  deadLettered: OutboxEntry | null;
}

/**
 * Erhöht den Fehlerzähler eines Eintrags. Ab `maxAttempts` wird er aus der
 * Outbox entfernt und als Dead-Letter zurückgegeben (PLAN.md §5, T4.3).
 */
export function recordFailure(
  outbox: Outbox,
  id: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): FailureResult {
  const entry = outbox.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) return { outbox, deadLettered: null };

  const attempts = entry.attempts + 1;
  if (attempts >= maxAttempts) {
    return {
      outbox: { entries: outbox.entries.filter((candidate) => candidate.id !== id) },
      deadLettered: withAttempts(entry, attempts),
    };
  }
  return {
    outbox: {
      entries: outbox.entries.map((candidate) =>
        candidate.id === id ? withAttempts(candidate, attempts) : candidate,
      ),
    },
    deadLettered: null,
  };
}

/** Sortierschlüssel für Tests/Diagnose: Millisekunden eines Eintrags. */
export function entryTime(entry: OutboxEntry): number {
  return timestampToMillis(entry.client_ts);
}
