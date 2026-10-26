/**
 * Framework-freie Domänentypen für die Sync-Schicht (PLAN.md §4.1/§4.2).
 *
 * `VersionedRow` trägt neben den Fachfeldern die Zeitstempel, die für
 * feldweises Last-Write-Wins nötig sind. Die Datenbank speichert die
 * Feld-Zeitstempel zusätzlich zu `updated_at`; `updated_at` bleibt die
 * gröbste, zeilenweite Zusammenfassung.
 */

export type IsoTimestamp = string;
export type RowId = string;

/** Einheiten aus PLAN.md §4.3. */
export type Unit =
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'
  | 'TL'
  | 'EL'
  | 'Stk'
  | 'Bund'
  | 'Dose'
  | 'Packung'
  | 'Zehe'
  | 'Prise'
  | 'n. B.';

/** Dimensionen aus PLAN.md §4.3; `unspecified` umfasst Prise/n. B./ohne Einheit. */
export type UnitDimension = 'mass' | 'volume' | 'piece' | 'unspecified';

export type ListItemFields = {
  list_id: string;
  name: string;
  name_normalized: string;
  quantity: number | null;
  unit: Unit | null;
  category_id: string | null;
  checked: boolean;
  checked_by: string | null;
  source_recipe_id: string | null;
  note: string | null;
};

/** Zeilenform, wie sie in der Outbox und im Fake-Adapter transportiert wird. */
export type ListItemRowData = ListItemFields & { id: RowId };

export type FieldTimestamps<T extends object> = Partial<
  Record<Extract<keyof T, string>, IsoTimestamp>
>;

export type VersionedRow<T extends object> = {
  id: RowId;
  updated_at: IsoTimestamp;
  deleted_at: IsoTimestamp | null;
  field_updated_at: FieldTimestamps<T>;
  fields: T;
};

export type ListItem = VersionedRow<ListItemFields>;

/** Fachfelder eines Rezepts (public.recipes, PLAN.md §4.3/T3.2). */
export type RecipeFields = {
  household_id: string;
  title: string;
  base_servings: number | null;
  tags: string[];
  instructions: string | null;
};

export type RecipeRowData = RecipeFields & { id: RowId };

/** Fachfelder einer Rezeptzutat (public.recipe_ingredients, PLAN.md §4.3). */
export type RecipeIngredientFields = {
  recipe_id: string;
  name: string;
  quantity: number | null;
  unit: Unit | null;
  sort_order: number;
};

export type RecipeIngredientRowData = RecipeIngredientFields & { id: RowId };

/**
 * Tabellen der Sync-Schicht. `list_items` bleibt die einzige Tabelle mit
 * eigener `add_to_list`-RPC; `recipes`/`recipe_ingredients` laufen als
 * generische Outbox-Tabellen über dieselbe Upsert-/Delete-Mechanik.
 */
export type ListTable = 'list_items' | 'recipes' | 'recipe_ingredients';

/** Alias für Code, der über alle synchronisierten Tabellen spricht. */
export type SyncTable = ListTable;

/** Zeilenform, die in der Outbox einer der Sync-Tabellen liegen kann. */
export type SyncRowData = ListItemRowData | RecipeRowData | RecipeIngredientRowData;
