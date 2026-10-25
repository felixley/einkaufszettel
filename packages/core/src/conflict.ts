import { compareTimestamps, latestTimestamp } from './time.js';
import type { IsoTimestamp, ListItem, ListItemFields, VersionedRow } from './types.js';

export type ConflictResolution = 'local' | 'remote' | 'merged' | 'deleted' | 'unchanged';

export interface ConflictOptions {
  /**
   * Welche Seite ist der Server? Standard ist `remote` — im Sync-Pfad ist die
   * lokale Seite die Client-Kopie und die Remote-Seite der Serverstand.
   * Bei Zeitstempel-Gleichstand gewinnt die Server-Seite (PLAN.md §4.2).
   */
  serverSide?: 'local' | 'remote';
}

export interface ConflictResult<T extends object> {
  row: VersionedRow<T>;
  resolution: ConflictResolution;
  /** Felder, in denen die lokale Seite den Remote-Stand überschreibt. */
  changed_fields: string[];
}

function pickFieldTimestamp<T extends object>(row: VersionedRow<T>, field: string): IsoTimestamp {
  const timestamps = row.field_updated_at as Record<string, IsoTimestamp | undefined>;
  return timestamps[field] ?? row.updated_at;
}

function earliestTimestamp(first: IsoTimestamp, second: IsoTimestamp): IsoTimestamp {
  return compareTimestamps(first, second) <= 0 ? first : second;
}

/**
 * Löst einen Konflikt feldweise per Last-Write-Wins auf.
 *
 * Regeln (PLAN.md §4.2):
 * - Pro Feld gewinnt der jüngere Zeitstempel.
 * - Bei Gleichstand gewinnt die Server-Seite (Default: `remote`).
 * - Löschen gewinnt gegen Bearbeiten: Ist auf einer Seite `deleted_at` gesetzt,
 *   ist das Ergebnis gelöscht — unabhängig davon, wie neu die Bearbeitung ist.
 * - Sind beide Seiten gelöscht, bleibt der früheste Löschzeitpunkt erhalten
 *   (deterministisch und idempotent).
 *
 * Die Funktion ist rein: Eingaben werden nicht verändert, das Ergebnis ist bei
 * gleicher Eingabe stets identisch.
 */
export function resolveRow<T extends object>(
  local: VersionedRow<T>,
  remote: VersionedRow<T>,
  options: ConflictOptions = {},
): ConflictResult<T> {
  const serverSide = options.serverSide ?? 'remote';
  const localFields = local.fields as unknown as Record<string, unknown>;
  const remoteFields = remote.fields as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(localFields), ...Object.keys(remoteFields)]);

  const mergedFields: Record<string, unknown> = {};
  const mergedFieldTimestamps: Record<string, IsoTimestamp> = {};
  let localWins = 0;
  let remoteWins = 0;

  for (const key of keys) {
    const localHas = Object.hasOwn(localFields, key);
    const remoteHas = Object.hasOwn(remoteFields, key);
    const localTimestamp = pickFieldTimestamp(local, key);
    const remoteTimestamp = pickFieldTimestamp(remote, key);

    let winner: 'local' | 'remote';
    if (localHas && !remoteHas) {
      winner = 'local';
    } else if (!localHas && remoteHas) {
      winner = 'remote';
    } else {
      const comparison = compareTimestamps(localTimestamp, remoteTimestamp);
      if (comparison > 0) winner = 'local';
      else if (comparison < 0) winner = 'remote';
      else winner = serverSide;
    }

    const winningValue = winner === 'local' ? localFields[key] : remoteFields[key];
    mergedFields[key] = winningValue;
    mergedFieldTimestamps[key] = winner === 'local' ? localTimestamp : remoteTimestamp;

    if (winner === 'local' && !Object.is(winningValue, remoteFields[key])) localWins += 1;
    if (winner === 'remote' && !Object.is(winningValue, localFields[key])) remoteWins += 1;
  }

  const deleteTimestamps = [local.deleted_at, remote.deleted_at].filter(
    (value): value is IsoTimestamp => value !== null,
  );
  const deleted = deleteTimestamps.length > 0;
  const deletedAt = deleted
    ? deleteTimestamps.reduce((earliest, candidate) => earliestTimestamp(earliest, candidate))
    : null;

  const updatedAt = latestTimestamp(
    local.updated_at,
    remote.updated_at,
    ...(Object.values(mergedFieldTimestamps) as IsoTimestamp[]),
    ...(deletedAt === null ? [] : [deletedAt]),
  );

  const resolution: ConflictResolution = deleted
    ? 'deleted'
    : localWins > 0 && remoteWins > 0
      ? 'merged'
      : localWins > 0
        ? 'local'
        : remoteWins > 0
          ? 'remote'
          : 'unchanged';

  const changedFields = keysArrayChanged(localFields, remoteFields, mergedFields);
  if (!Object.is(deletedAt, remote.deleted_at)) changedFields.push('deleted_at');

  return {
    row: {
      id: local.id,
      updated_at: updatedAt,
      deleted_at: deletedAt,
      field_updated_at: mergedFieldTimestamps as VersionedRow<T>['field_updated_at'],
      fields: mergedFields as T,
    },
    resolution,
    changed_fields: changedFields,
  };
}

function keysArrayChanged(
  localFields: Record<string, unknown>,
  remoteFields: Record<string, unknown>,
  mergedFields: Record<string, unknown>,
): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(mergedFields)) {
    const localValue = localFields[key];
    const remoteValue = remoteFields[key];
    const mergedValue = mergedFields[key];
    if (Object.is(localValue, remoteValue)) continue;
    if (!Object.is(mergedValue, remoteValue)) changed.push(key);
  }
  return changed;
}

export interface CheckOptions {
  at: IsoTimestamp;
  by?: string | null;
}

/**
 * Setzt `checked` idempotent. Wiederholtes Abhaken mit demselben Wert ändert
 * nichts (auch `updated_at` bleibt unangetastet); ein gelöschtes Item wird
 * nicht wiederbelebt.
 */
export function applyCheck(item: ListItem, checked: boolean, options: CheckOptions): ListItem {
  if (item.deleted_at !== null) return item;
  if (item.fields.checked === checked) return item;

  const by = options.by ?? null;
  const fields: ListItemFields = {
    ...item.fields,
    checked,
    checked_by: checked ? by : null,
  };
  const updatedAt = latestTimestamp(item.updated_at, options.at);

  return {
    ...item,
    updated_at: updatedAt,
    field_updated_at: { ...item.field_updated_at, checked: options.at },
    fields,
  };
}
