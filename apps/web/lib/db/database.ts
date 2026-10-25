import Dexie, { type Table } from 'dexie';
import type { DeadLetterRow, LocalListItemRow, LocalOutboxRow, MetaRow } from './types';

/**
 * Lokale Datenbank. Die UI liest ausschließlich hieraus (PLAN.md §4.2).
 *
 * Drei Stores:
 * - `list_items`: letzter bekannter Stand je Artikel inkl. Feld-Zeitstempeln,
 * - `outbox`: noch nicht bestätigte Schreibvorgänge (core-Vertrag),
 * - `dead_letter`: dauerhaft fehlgeschlagene Einträge für die Fehleranzeige.
 */
export class EinkaufszettelDB extends Dexie {
  list_items!: Table<LocalListItemRow, string>;
  outbox!: Table<LocalOutboxRow, string>;
  dead_letter!: Table<DeadLetterRow, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'einkaufszettel') {
    super(name);
    this.version(1).stores({
      list_items: 'id, list_id, name_normalized, deleted_at, updated_at',
      outbox: 'id, client_ts, table, op',
      dead_letter: 'id, failed_at',
      meta: 'key',
    });
  }
}

let instance: EinkaufszettelDB | null = null;

/** IndexedDB ist in SSR/Node ohne Shim nicht verfügbar. */
export function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** Singleton der Browser-Datenbank; wirft außerhalb des Browsers. */
export function getDb(): EinkaufszettelDB {
  if (!indexedDbAvailable()) {
    throw new Error('Dexie benötigt IndexedDB – verfügbar nur im Browser.');
  }
  instance ??= new EinkaufszettelDB();
  return instance;
}

/** Nur für Tests: Singleton zurücksetzen, damit jeder Test eine frische DB erhält. */
export function resetDbSingleton(): void {
  instance = null;
}
