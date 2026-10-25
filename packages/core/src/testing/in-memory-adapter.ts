import { addToList, type AddToListRequest } from '../add-to-list.js';
import type { SyncAdapter } from '../sync.js';
import type {
  FieldTimestamps,
  IsoTimestamp,
  ListItem,
  ListItemFields,
  ListItemRowData,
  RowId,
} from '../types.js';

export interface InMemoryAdapterOptions {
  /** Serveruhr; Standard ist eine deterministische, monotone Uhr. */
  now?: () => IsoTimestamp;
  generate_id?: () => RowId;
}

const DEFAULT_START = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

/**
 * Fake-Sync-Adapter ohne Netzwerk (für Unit-/Integrationstests).
 *
 * Modelliert den Server: Upserts stempeln die geänderten Felder mit Serverzeit,
 * Soft-Deletes setzen `deleted_at`, `add_to_list` aggregiert atomar und
 * dedupliziert über `request_id`. Löschen gewinnt gegen Bearbeiten — auch dann,
 * wenn der Edit zeitlich nach dem Delete eintrifft (Tombstone).
 */
export class InMemorySyncAdapter implements SyncAdapter {
  private readonly rowsByTable = new Map<string, Map<RowId, ListItem>>();
  private readonly tombstones = new Map<string, Set<RowId>>();
  private appliedRequests = new Set<string>();
  private readonly clock: () => IsoTimestamp;
  private readonly generateId: () => RowId;
  private sequence = 0;

  constructor(options: InMemoryAdapterOptions = {}) {
    this.clock =
      options.now ??
      (() => {
        this.sequence += 1;
        return new Date(DEFAULT_START + this.sequence).toISOString();
      });
    this.generateId = options.generate_id ?? (() => crypto.randomUUID());
  }

  upsert(table: string, row: ListItemRowData, changedFields: readonly string[]): void {
    const id = row.id;
    if (this.tombstones.get(table)?.has(id) === true) return; // Delete gewinnt.

    const tableRows = this.rowsByTable.get(table) ?? new Map<RowId, ListItem>();
    const existing = tableRows.get(id);
    if (existing?.deleted_at != null) return; // Delete gewinnt gegen Edit.

    const at = this.clock();
    if (existing === undefined) {
      const fields = fieldsFromRow(row);
      tableRows.set(id, {
        id,
        updated_at: at,
        deleted_at: null,
        field_updated_at: stampAll(fields, at),
        fields,
      });
      this.rowsByTable.set(table, tableRows);
      return;
    }

    const fields: ListItemFields = { ...existing.fields };
    const fieldTimestamps: FieldTimestamps<ListItemFields> = { ...existing.field_updated_at };
    const rowRecord = row as unknown as Record<string, unknown>;
    const fieldsRecord = fields as unknown as Record<string, unknown>;
    let changed = false;

    for (const field of changedFields) {
      if (!(field in fields)) continue;
      const nextValue = rowRecord[field];
      if (Object.is(fieldsRecord[field], nextValue)) continue;
      // Idempotentes Abhaken: Ist die Zeile bereits abgehakt, ändert ein
      // weiteres `checked=true` den `checked_by` nicht mehr. Dadurch bleibt
      // wiederholtes Replay derselben Check-Einträge zustandsstabil.
      if (
        field === 'checked_by' &&
        existing.fields.checked === true &&
        rowRecord['checked'] === true
      ) {
        continue;
      }
      fieldsRecord[field] = nextValue;
      fieldTimestamps[field as keyof ListItemFields] = at;
      changed = true;
    }

    if (!changed) return; // Idempotentes Replay: gleiche Werte → kein Schreibvorgang.

    tableRows.set(id, {
      ...existing,
      updated_at: at,
      field_updated_at: fieldTimestamps,
      fields,
    });
  }

  softDelete(table: string, id: RowId): void {
    const tableRows = this.rowsByTable.get(table);
    const existing = tableRows?.get(id);
    if (existing === undefined) {
      const tombstones = this.tombstones.get(table) ?? new Set<RowId>();
      tombstones.add(id);
      this.tombstones.set(table, tombstones);
      return;
    }
    if (existing.deleted_at !== null) return; // Idempotent.

    const at = this.clock();
    tableRows?.set(id, { ...existing, deleted_at: at, updated_at: at });
  }

  addToList(request: AddToListRequest): void {
    const active = this.activeRows('list_items');
    const outcome = addToList(active, request, {
      now: this.clock(),
      applied_request_ids: this.appliedRequests,
      generate_id: this.generateId,
    });
    this.appliedRequests = outcome.applied_request_ids;

    const tableRows = this.rowsByTable.get('list_items') ?? new Map<RowId, ListItem>();
    for (const row of outcome.rows) tableRows.set(row.id, row);
    this.rowsByTable.set('list_items', tableRows);
  }

  activeRows(table: string): ListItem[] {
    return [...(this.rowsByTable.get(table)?.values() ?? [])].filter(
      (row) => row.deleted_at === null,
    );
  }

  allRows(table: string): ListItem[] {
    return [...(this.rowsByTable.get(table)?.values() ?? [])];
  }

  row(table: string, id: RowId): ListItem | undefined {
    return this.rowsByTable.get(table)?.get(id);
  }

  tombstoneIds(table: string): RowId[] {
    return [...(this.tombstones.get(table) ?? [])];
  }

  appliedRequestIds(): string[] {
    return [...this.appliedRequests];
  }
}

function fieldsFromRow(row: ListItemRowData): ListItemFields {
  return {
    list_id: row.list_id,
    name: row.name,
    name_normalized: row.name_normalized,
    quantity: row.quantity,
    unit: row.unit,
    category_id: row.category_id,
    checked: row.checked,
    checked_by: row.checked_by,
    source_recipe_id: row.source_recipe_id,
    note: row.note,
  };
}

function stampAll(fields: ListItemFields, at: IsoTimestamp): FieldTimestamps<ListItemFields> {
  const timestamps: FieldTimestamps<ListItemFields> = {};
  for (const key of Object.keys(fields) as (keyof ListItemFields)[]) {
    timestamps[key] = at;
  }
  return timestamps;
}
