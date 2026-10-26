import Dexie, { type Table } from 'dexie';
import type {
  DeadLetterRow,
  LocalCategoryRuleRow,
  LocalListItemRow,
  LocalOutboxRow,
  LocalRecipeIngredientRow,
  LocalRecipeRow,
  MetaRow,
} from './types';

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
  category_rules!: Table<LocalCategoryRuleRow, string>;
  recipes!: Table<LocalRecipeRow, string>;
  recipe_ingredients!: Table<LocalRecipeIngredientRow, string>;
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
    // v2: Haushaltsregeln für die Auto-Kategorisierung (A-7). Globale
    // Seed-Regeln haben `household_id = null`, gelernte Regeln eine Haushalts-ID.
    this.version(2).stores({
      list_items: 'id, list_id, name_normalized, deleted_at, updated_at',
      category_rules: 'id, household_id, keyword, category_key, updated_at',
      outbox: 'id, client_ts, table, op',
      dead_letter: 'id, failed_at',
      meta: 'key',
    });
    // v3: Rezepte + Zutaten (T3.2). Beide laufen über dieselbe Outbox wie
    // list_items; `title_normalized` ist eine reine Offline-Suchspalte.
    this.version(3).stores({
      list_items: 'id, list_id, name_normalized, deleted_at, updated_at',
      category_rules: 'id, household_id, keyword, category_key, updated_at',
      recipes: 'id, household_id, title_normalized, deleted_at, updated_at',
      recipe_ingredients: 'id, recipe_id, sort_order, deleted_at, updated_at',
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
