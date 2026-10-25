import { normalizeName } from './name.js';
import type { IsoTimestamp, ListItem, ListItemFields, RowId, Unit } from './types.js';
import { convertQuantity, roundQuantity, unitDimension } from './units.js';

/**
 * Payload der serverseitigen RPC `add_to_list` (PLAN.md §4.2).
 *
 * `request_id` ist der Idempotenzschlüssel: Der Client wiederholt die RPC nach
 * einem Timeout mit derselben ID; der Server darf die Menge dann nicht erneut
 * addieren.
 */
export interface AddToListRequest {
  request_id: string;
  list_id: string;
  name: string;
  quantity: number;
  unit: Unit | null;
}

export interface AddToListContext {
  /** Serverzeit, mit der die geänderte Zeile gestempelt wird. */
  now: IsoTimestamp;
  /** Bereits angewendete RPC-IDs (Idempotenz-Ledger des Servers). */
  applied_request_ids: ReadonlySet<string>;
  /** Erzeugt eine neue UUIDv7 für eine neu angelegte Zeile. */
  generate_id: () => RowId;
}

export interface AddToListOutcome {
  rows: ListItem[];
  affected: ListItem | null;
  created: boolean;
  duplicate: boolean;
  applied_request_ids: Set<string>;
}

function validate(request: AddToListRequest): void {
  if (request.request_id.trim() === '') {
    throw new TypeError('request_id darf nicht leer sein');
  }
  if (request.list_id.trim() === '') {
    throw new TypeError('list_id darf nicht leer sein');
  }
  if (request.name.trim() === '') {
    throw new TypeError('name darf nicht leer sein');
  }
  if (!Number.isFinite(request.quantity) || request.quantity <= 0) {
    throw new RangeError('quantity muss eine endliche Zahl größer 0 sein');
  }
}

function findAggregationTarget(
  rows: readonly ListItem[],
  request: AddToListRequest,
  normalizedName: string,
): ListItem | undefined {
  const requestDimension = unitDimension(request.unit);
  return rows.find((row) => {
    if (row.deleted_at !== null) return false;
    if (row.fields.list_id !== request.list_id) return false;
    if (row.fields.name_normalized !== normalizedName) return false;
    if (unitDimension(row.fields.unit) !== requestDimension) return false;
    return convertQuantity(request.quantity, request.unit, row.fields.unit) !== null;
  });
}

/**
 * Reine Umsetzung der RPC `add_to_list`.
 *
 * Der Aufrufer (Server) muss die Funktion atomar/serialisiert ausführen; die
 * Funktion selbst verändert die Eingabe nicht. Sie aggregiert nur Zeilen mit
 * gleichem `list_id`, gleicher `name_normalized` und gleicher Einheiten-
 * Dimension (PLAN.md §4.3). Bei gleicher Dimension wird nach Möglichkeit in die
 * Einheit der vorhandenen Zeile umgerechnet; sonst entsteht eine neue Zeile.
 *
 * Ein wiederholter Aufruf mit derselben `request_id` ist ein No-op und liefert
 * `duplicate: true` (kein doppeltes Aufaddieren).
 */
export function addToList(
  rows: readonly ListItem[],
  request: AddToListRequest,
  context: AddToListContext,
): AddToListOutcome {
  validate(request);

  const applied = new Set(context.applied_request_ids);
  const normalizedName = normalizeName(request.name);

  if (applied.has(request.request_id)) {
    return {
      rows: [...rows],
      affected: findAggregationTarget(rows, request, normalizedName) ?? null,
      created: false,
      duplicate: true,
      applied_request_ids: applied,
    };
  }

  applied.add(request.request_id);
  const target = findAggregationTarget(rows, request, normalizedName);

  if (target !== undefined) {
    const converted = convertQuantity(request.quantity, request.unit, target.fields.unit);
    if (converted === null) {
      // Sollte durch findAggregationTarget ausgeschlossen sein; defensiv neu anlegen.
      return createRow(rows, request, normalizedName, context, applied);
    }
    const quantity = roundQuantity((target.fields.quantity ?? 0) + converted);
    const affected: ListItem = {
      ...target,
      updated_at: context.now,
      field_updated_at: { ...target.field_updated_at, quantity: context.now },
      fields: { ...target.fields, quantity },
    };
    return {
      rows: rows.map((row) => (row.id === target.id ? affected : row)),
      affected,
      created: false,
      duplicate: false,
      applied_request_ids: applied,
    };
  }

  return createRow(rows, request, normalizedName, context, applied);
}

function createRow(
  rows: readonly ListItem[],
  request: AddToListRequest,
  normalizedName: string,
  context: AddToListContext,
  applied: Set<string>,
): AddToListOutcome {
  const fields: ListItemFields = {
    list_id: request.list_id,
    name: request.name.trim(),
    name_normalized: normalizedName,
    quantity: request.quantity,
    unit: request.unit,
    category_id: null,
    checked: false,
    checked_by: null,
    source_recipe_id: null,
    note: null,
  };
  const fieldTimestamps: Record<string, IsoTimestamp> = {};
  for (const key of Object.keys(fields)) fieldTimestamps[key] = context.now;

  const affected: ListItem = {
    id: context.generate_id(),
    updated_at: context.now,
    deleted_at: null,
    field_updated_at: fieldTimestamps,
    fields,
  };

  return {
    rows: [...rows, affected],
    affected,
    created: true,
    duplicate: false,
    applied_request_ids: applied,
  };
}
