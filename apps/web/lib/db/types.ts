import type { FieldTimestamps, ListItemFields, Unit } from '@einkaufszettel/core';

/**
 * Zeilenform der Dexie-Tabelle `list_items`.
 *
 * `VersionedRow` aus packages/core verschachtelt die Fachfelder unter `fields`.
 * Dexie kann nur Top-Level-Properties indizieren, deshalb wird die Zeile flach
 * gespeichert und erst an der Repository-Grenze in `ListItem` übersetzt.
 */
export type LocalListItemRow = ListItemFields & {
  id: string;
  updated_at: string;
  deleted_at: string | null;
  field_updated_at: FieldTimestamps<ListItemFields>;
};

export type LocalOutboxOp = 'upsert' | 'delete' | 'add_to_list';

/** Outbox-Eintrag als Dexie-Zeile; `payload` entspricht packages/core. */
export interface LocalOutboxRow {
  id: string;
  table: string;
  op: LocalOutboxOp;
  client_ts: string;
  attempts: number;
  payload: unknown;
}

/** Dauerhaft fehlgeschlagene Outbox-Einträge (T4.3-Vorbereitung). */
export interface DeadLetterRow {
  id: string;
  entry: LocalOutboxRow;
  failed_at: string;
  error: string;
}

export interface MetaRow {
  key: string;
  value: string;
}

/** Eingabe zum Anlegen eines Artikels. Fehlende Felder werden neutral belegt. */
export interface NewListItemInput {
  id?: string;
  list_id: string;
  name: string;
  name_normalized?: string;
  quantity?: number | null;
  unit?: Unit | null;
  category_id?: string | null;
  checked?: boolean;
  checked_by?: string | null;
  source_recipe_id?: string | null;
  note?: string | null;
}
