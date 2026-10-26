import type {
  AddToListOutcome,
  AddToListRequest,
  FieldTimestamps,
  ListItem,
  ListItemFields,
  ListItemRowData,
  RowId,
} from '@einkaufszettel/core';
import { addToList as aggregateAddToList } from '@einkaufszettel/core';

/**
 * In-Memory-Gegenstelle für den Dev-/E2E-Mock-Sync (T4.2a).
 *
 * Bewusst serverseitig gedacht: Der Zustand lebt im Dev-Server-Prozess, damit
 * zwei Browser-Kontexte („zwei Geräte“) gegen dieselbe Instanz konvergieren.
 * NICHTS wird persistiert; ein Neustart des Dev-Servers leert den Store.
 *
 * Feldweises LWW: Der Client schickt bei einem Upsert nur die geänderten
 * Felder mit (ohne Client-Zeitstempel — der Outbox-Vertrag in packages/core
 * trägt keine Zeitstempel in `row`). Der Server stempelt deshalb genau diese
 * Felder mit seiner monotonen Uhr. Treffen zwei Schreibvorgänge auf dasselbe
 * Feld, gewinnt der zuletzt eingetroffene; bei gleichem Zeitstempel bleibt der
 * bereits gespeicherte Serverstand stehen („Server-Zeit gewinnt bei
 * Gleichstand“). Löschen gewinnt gegen Bearbeiten (Tombstone bleibt).
 */

export interface MockRow {
  id: RowId;
  updated_at: string;
  deleted_at: string | null;
  field_updated_at: Record<string, string>;
  fields: Record<string, unknown>;
}

export interface MockRowsPage {
  rows: ListItem[];
  cursor: string;
}

interface MockScope {
  tables: Map<string, Map<RowId, MockRow>>;
  appliedRequests: Set<string>;
  lastWriteAt: string | null;
}

export interface MockStoreOptions {
  /** Testbare Uhr; Standard ist die echte Zeit. */
  now?: () => Date;
  /** Testbare ID-Erzeugung für `add_to_list`-Neuanlagen. */
  generateId?: () => string;
}

const EPOCH = '1970-01-01T00:00:00.000Z';

/** Zeilen-Metadaten gehoeren nicht in die Fachfelder-Map. */
const RESERVED_ROW_KEYS = new Set(['id', 'updated_at', 'deleted_at', 'field_updated_at']);

export class MockSyncStore {
  private readonly scopes = new Map<string, MockScope>();
  private readonly now: () => Date;
  private readonly generateId: () => string;
  private lastTimestamp = 0;

  constructor(options: MockStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
  }

  /** Setzt den kompletten Zustand zurück (Tests/Dev-Reset). */
  reset(): void {
    this.scopes.clear();
    this.lastTimestamp = 0;
  }

  resetScope(scope: string): void {
    this.scopes.delete(scope);
  }

  /**
   * Monotone Serverzeit. Zwei Schreibvorgänge in derselben Millisekunde
   * erhalten garantiert aufsteigende Zeitstempel, damit der `since`-Cursor
   * keine Zeile überspringt.
   */
  private nextTimestamp(): string {
    const base = this.now().getTime();
    const next = base > this.lastTimestamp ? base : this.lastTimestamp + 1;
    this.lastTimestamp = next;
    return new Date(next).toISOString();
  }

  private scope(scope: string): MockScope {
    let state = this.scopes.get(scope);
    if (state === undefined) {
      state = { tables: new Map(), appliedRequests: new Set(), lastWriteAt: null };
      this.scopes.set(scope, state);
    }
    return state;
  }

  private table(state: MockScope, table: string): Map<RowId, MockRow> {
    let rows = state.tables.get(table);
    if (rows === undefined) {
      rows = new Map();
      state.tables.set(table, rows);
    }
    return rows;
  }

  /** Alle Zeilen einer Tabelle (inkl. Tombstones). */
  allRows(scope: string, table: string): MockRow[] {
    const state = this.scopes.get(scope);
    if (state === undefined) return [];
    return [...(state.tables.get(table)?.values() ?? [])];
  }

  /** Nur aktive Zeilen einer Tabelle. */
  activeRows(scope: string, table: string): MockRow[] {
    return this.allRows(scope, table).filter((row) => row.deleted_at === null);
  }

  row(scope: string, table: string, id: RowId): MockRow | undefined {
    return this.scopes.get(scope)?.tables.get(table)?.get(id);
  }

  /**
   * Idempotenter Upsert mit feldweisem LWW.
   *
   * - Existiert die Zeile nicht, wird sie mit allen mitgeschickten Feldern
   *   angelegt und mit Serverzeit gestempelt.
   * - Ist die Zeile bereits soft-gelöscht, bleibt der Tombstone stehen
   *   (Löschen gewinnt gegen Bearbeiten).
   * - Sonst werden ausschließlich die in `changedFields` genannten Felder
   *   übernommen; identische Werte erzeugen keinen neuen Schreibvorgang.
   */
  upsert(
    scope: string,
    table: string,
    row: ListItemRowData,
    changedFields: readonly string[],
  ): MockRow {
    const state = this.scope(scope);
    const rows = this.table(state, table);
    const existing = rows.get(row.id);

    if (existing !== undefined && existing.deleted_at !== null) {
      // Tombstone bleibt; ein Edit belebt die Zeile nicht wieder.
      return existing;
    }

    const now = this.nextTimestamp();
    const incoming = row as unknown as Record<string, unknown>;
    const fields: Record<string, unknown> = existing === undefined ? {} : { ...existing.fields };
    const stamps: Record<string, string> =
      existing === undefined ? {} : { ...existing.field_updated_at };
    let changed = false;

    const fieldsToApply =
      existing === undefined
        ? Object.keys(incoming).filter((key) => !RESERVED_ROW_KEYS.has(key))
        : changedFields.filter((key) => !RESERVED_ROW_KEYS.has(key));

    for (const field of fieldsToApply) {
      if (!(field in incoming)) continue;
      if (existing !== undefined && Object.is(fields[field], incoming[field])) continue;
      fields[field] = incoming[field];
      stamps[field] = now;
      changed = true;
    }

    if (!changed && existing !== undefined) return existing;

    const stored: MockRow = {
      id: row.id,
      updated_at: now,
      deleted_at: null,
      field_updated_at: stamps,
      fields,
    };
    rows.set(row.id, stored);
    state.lastWriteAt = now;
    return stored;
  }

  /** Soft-Delete; idempotent und auch für unbekannte IDs (Tombstone). */
  softDelete(scope: string, table: string, id: RowId): MockRow {
    const state = this.scope(scope);
    const rows = this.table(state, table);
    const existing = rows.get(id);
    const now = this.nextTimestamp();

    if (existing === undefined) {
      const tombstone: MockRow = {
        id,
        updated_at: now,
        deleted_at: now,
        field_updated_at: {},
        fields: {},
      };
      rows.set(id, tombstone);
      state.lastWriteAt = now;
      return tombstone;
    }

    if (existing.deleted_at !== null) return existing;

    const next: MockRow = { ...existing, deleted_at: now, updated_at: now };
    rows.set(id, next);
    state.lastWriteAt = now;
    return next;
  }

  /**
   * Serverseitige `add_to_list`-RPC über den reinen Core-Aggregator.
   * Dedupliziert über `request_id` (keine doppelte Menge bei Replay).
   */
  addToList(scope: string, request: AddToListRequest): AddToListOutcome {
    const state = this.scope(scope);
    const rows = this.table(state, 'list_items');
    const active = [...rows.values()]
      .map((row) => toListItem(row))
      .filter((row) => row.deleted_at === null);

    const outcome = aggregateAddToList(active, request, {
      now: this.nextTimestamp(),
      applied_request_ids: state.appliedRequests,
      generate_id: this.generateId,
    });
    state.appliedRequests = outcome.applied_request_ids;

    for (const row of outcome.rows) {
      rows.set(row.id, fromListItem(row));
    }
    state.lastWriteAt = this.lastTimestamp > 0 ? new Date(this.lastTimestamp).toISOString() : null;
    return outcome;
  }

  /**
   * Änderungen seit einem Cursor. Der Cursor ist die jüngste Serverzeit des
   * Scopes; ein leerer Cursor liefert den kompletten Bestand.
   */
  listRowsSince(scope: string, table: string, since: string): MockRowsPage {
    const state = this.scopes.get(scope);
    if (state === undefined) return { rows: [], cursor: EPOCH };

    const cursor = state.lastWriteAt ?? EPOCH;
    const rows = [...(state.tables.get(table)?.values() ?? [])]
      .filter((row) => row.updated_at > since)
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
      .map((row) => toListItem(row));

    return { rows, cursor };
  }

  /** Aktueller Cursor des Scopes (ohne Schreibvorgang). */
  cursor(scope: string): string {
    return this.scopes.get(scope)?.lastWriteAt ?? EPOCH;
  }
}

function toListItem(row: MockRow): ListItem {
  return {
    id: row.id,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    field_updated_at: row.field_updated_at as FieldTimestamps<ListItemFields>,
    fields: row.fields as unknown as ListItemFields,
  };
}

function fromListItem(item: ListItem): MockRow {
  return {
    id: item.id,
    updated_at: item.updated_at,
    deleted_at: item.deleted_at,
    field_updated_at: { ...item.field_updated_at } as Record<string, string>,
    fields: { ...item.fields } as unknown as Record<string, unknown>,
  };
}

type GlobalWithMockSyncStore = typeof globalThis & {
  __ezMockSyncStore?: MockSyncStore;
};

const globalStore = globalThis as GlobalWithMockSyncStore;

/** Prozessweiter Singleton-Store für die Dev-Mock-Gegenstelle. */
export function getMockSyncStore(): MockSyncStore {
  return (globalStore.__ezMockSyncStore ??= new MockSyncStore());
}

/** Nur für Tests: Singleton zurücksetzen. */
export function resetMockSyncStore(): void {
  globalStore.__ezMockSyncStore = new MockSyncStore();
}
