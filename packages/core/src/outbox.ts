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
  /**
   * Frühester erneuter Replay-Zeitpunkt (ISO). Nur bei wartenden Einträgen
   * gesetzt; erfolgreiche Einträge werden quittiert, Dead-Letter haben keinen
   * Retry-Termin mehr. Optional, damit bestehende Einträge typechecken.
   */
  next_attempt_at?: IsoTimestamp;
  /** Letzter Fehlertext; nur bei Dead-Letter-Einträgen gesetzt. */
  last_error?: string;
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

/** Basis der exponentiellen Wartezeit: 1 s. */
export const BASE_RETRY_DELAY_MS = 1_000;
/** Harte Obergrenze der Wartezeit: 60 s. */
export const DEFAULT_RETRY_MAX_DELAY_MS = 60_000;
/** Relativer Jitter-Anteil (±20 %). */
export const RETRY_JITTER_RATIO = 0.2;

export interface BackoffOptions {
  /** Zufallsquelle in [0, 1]; Default `Math.random`. */
  rand?: () => number;
  /** ±20 % Jitter aktivieren. Default `false` (exakte Sequenz). */
  jitter?: boolean;
  /** Harter Deckel in Millisekunden; Default 60 000. */
  maxDelayMs?: number;
}

/**
 * Wartezeit bis zum nächsten Replay-Versuch in Millisekunden.
 *
 * Die Basissequenz ist exponentiell: 1 s, 2 s, 4 s, 8 s, 16 s, 32 s … und wird
 * bei 60 s gedeckelt. `attempts` zählt bereits fehlgeschlagene Versuche, daher
 * liefern 0 und 1 dieselbe erste Wartezeit von 1 s. Jitter ist optional und
 * deterministisch, sobald `rand` injiziert wird. Die Funktion ist rein und hat
 * keine Seiteneffekte.
 */
export function nextRetryDelayMs(attempts: number, options: BackoffOptions = {}): number {
  if (!Number.isFinite(attempts) || attempts < 0) {
    throw new RangeError(`attempts muss endlich und >= 0 sein: ${attempts}`);
  }

  const maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
    throw new RangeError(`maxDelayMs muss endlich und >= 0 sein: ${maxDelayMs}`);
  }

  const normalizedAttempts = Math.max(1, Math.floor(attempts));
  const base = Math.min(BASE_RETRY_DELAY_MS * 2 ** (normalizedAttempts - 1), maxDelayMs);

  if (options.jitter !== true) return base;

  const rand = options.rand ?? Math.random;
  const sample = rand();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
    throw new RangeError(`rand() muss in [0, 1] liegen: ${sample}`);
  }

  const jittered = base * (1 - RETRY_JITTER_RATIO + 2 * RETRY_JITTER_RATIO * sample);
  return Math.min(Math.round(jittered), maxDelayMs);
}

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

/** Injizierbare Uhr: liefert ein `Date` oder einen ISO-String. */
export type Clock = () => Date | string;

export interface FailureOptions {
  /** Uhr für `next_attempt_at`; Default `new Date()`. */
  now?: Clock;
  /** Backoff-Konfiguration (Jitter, Deckel). */
  backoff?: BackoffOptions;
  /** Fehlertext, der bei Dead-Letter am Eintrag hinterlegt wird. */
  lastError?: string;
}

function clockMillis(now: Clock): number {
  const value = now();
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(millis)) throw new Error(`Ungültige Uhrzeit: ${String(value)}`);
  return millis;
}

/**
 * Erhöht den Fehlerzähler eines Eintrags. Ab `maxAttempts` wird er aus der
 * Outbox entfernt und als Dead-Letter zurückgegeben (PLAN.md §5, T4.3).
 *
 * Bei weiterhin wartenden Einträgen wird zusätzlich `next_attempt_at` aus der
 * injizierbaren Uhr plus `nextRetryDelayMs(neue attempts)` gesetzt. Bei
 * Dead-Letter wird optional `lastError` als `last_error` hinterlegt. Die
 * Funktion bleibt rein: Uhr, Zufall und Backoff sind injizierbar.
 */
export function recordFailure(
  outbox: Outbox,
  id: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  options: FailureOptions = {},
): FailureResult {
  const entry = outbox.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) return { outbox, deadLettered: null };

  const attempts = entry.attempts + 1;
  if (attempts >= maxAttempts) {
    // Dead-Letter werden nicht mehr versucht: einen eventuell vorhandenen
    // Retry-Termin entfernen, damit kein fälliger Zeitpunkt zurückbleibt.
    const deadLetteredBase: OutboxEntry = { ...withAttempts(entry, attempts) };
    delete (deadLetteredBase as { next_attempt_at?: IsoTimestamp }).next_attempt_at;
    const deadLettered: OutboxEntry =
      options.lastError === undefined
        ? deadLetteredBase
        : { ...deadLetteredBase, last_error: options.lastError };
    return {
      outbox: { entries: outbox.entries.filter((candidate) => candidate.id !== id) },
      deadLettered,
    };
  }

  const now = options.now ?? (() => new Date());
  const nextAttemptAt = new Date(
    clockMillis(now) + nextRetryDelayMs(attempts, options.backoff),
  ).toISOString();
  return {
    outbox: {
      entries: outbox.entries.map((candidate) =>
        candidate.id === id
          ? { ...withAttempts(candidate, attempts), next_attempt_at: nextAttemptAt }
          : candidate,
      ),
    },
    deadLettered: null,
  };
}

/** Sortierschlüssel für Tests/Diagnose: Millisekunden eines Eintrags. */
export function entryTime(entry: OutboxEntry): number {
  return timestampToMillis(entry.client_ts);
}
