import type {
  CategoryKey,
  FieldTimestamps,
  ListItemFields,
  RecipeFields,
  RecipeIngredientFields,
  Unit,
} from '@einkaufszettel/core';

// Re-Export der Core-Domänentypen: Die Web-Schicht arbeitet mit denselben
// Formen wie die Sync-Schicht in packages/core (keine Duplikate).
export type {
  Recipe,
  RecipeFields,
  RecipeIngredient,
  RecipeIngredientFields,
} from '@einkaufszettel/core';

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

/**
 * Zeilenform der Dexie-Tabelle `category_rules`.
 *
 * `category_key` ist der lokale, sprechende Schlüssel (z. B. `milch_eier`),
 * `category_id` die stabile Server-UUID für den Outbox-Upsert. Beide werden
 * gespeichert, damit die UI offline ohne Server-Mapping auskommt und der
 * Sync-Payload dennoch die FK-Spalte `category_rules.category_id` bedient.
 *
 * `household_id === null` markiert eine globale Seed-Regel.
 */
export interface LocalCategoryRuleRow {
  id: string;
  household_id: string | null;
  keyword: string;
  category_key: CategoryKey;
  category_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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

// ---------------------------------------------------------------------------
// Rezepte (T3.2)
// ---------------------------------------------------------------------------

/**
 * Dexie-Zeile für `recipes`. Zusätzlich zu den Fachfeldern wird
 * `title_normalized` für die Offline-Suche indiziert (Server hat die Spalte
 * nicht, der Outbox-Payload lässt sie deshalb weg).
 */
export type LocalRecipeRow = RecipeFields & {
  id: string;
  title_normalized: string;
  updated_at: string;
  deleted_at: string | null;
  field_updated_at: FieldTimestamps<RecipeFields>;
};

export type LocalRecipeIngredientRow = RecipeIngredientFields & {
  id: string;
  updated_at: string;
  deleted_at: string | null;
  field_updated_at: FieldTimestamps<RecipeIngredientFields>;
};

/** Zutat, wie sie das Formular liefert (ohne Rezept-ID/Sortierung). */
export interface RecipeIngredientDraft {
  id?: string;
  name: string;
  quantity: number | null;
  unit: Unit | null;
}

export interface NewRecipeInput {
  id?: string;
  household_id: string;
  title: string;
  base_servings?: number | null;
  tags?: string[];
  instructions?: string | null;
  ingredients?: RecipeIngredientDraft[];
}

export type RecipePatch = Partial<
  Pick<RecipeFields, 'title' | 'base_servings' | 'tags' | 'instructions'>
>;

export type RecipeIngredientPatch = Partial<
  Pick<RecipeIngredientFields, 'name' | 'quantity' | 'unit' | 'sort_order'>
>;
