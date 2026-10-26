import type {
  DeleteEntry,
  FieldTimestamps,
  ListItemRowData,
  Outbox,
  OutboxEntry,
  RowId,
  Unit,
  UpsertEntry,
} from '@einkaufszettel/core';
import type { EinkaufszettelDB } from './database';
import { enqueueOutbox, OUTBOX_CHANGED_EVENT, readOutbox, writeOutbox } from './repository';
import type {
  LocalRecipeIngredientRow,
  LocalRecipeRow,
  NewRecipeInput,
  Recipe,
  RecipeFields,
  RecipeIngredient,
  RecipeIngredientDraft,
  RecipeIngredientFields,
  RecipeIngredientPatch,
  RecipePatch,
} from './types';
import { uuidv7 } from './uuid';
import {
  parseIngredientDrafts,
  parseRecipeInput,
  RecipeValidationError,
  type ValidatedIngredientDraft,
} from '@/lib/recipes/validation';

// Re-Exporte, damit UI/Adapter nur aus einem Modul importieren müssen.
export type { Recipe, RecipeFields, RecipeIngredient, RecipeIngredientFields };

/** Ereignis für den Sync-Worker; identisch zum Listen-Pfad. */
export { OUTBOX_CHANGED_EVENT };

function notifyOutboxChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
}

export function normalizeRecipeTitle(title: string): string {
  return title.trim().toLocaleLowerCase('de-DE');
}

/** Trimmt, entdoppelt (case-insensitiv) und verwirft leere Tags. */
export function sanitizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag === '') continue;
    const key = tag.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

function stampFields<T extends object>(fields: T, at: string): FieldTimestamps<T> {
  const stamps: FieldTimestamps<T> = {};
  for (const key of Object.keys(fields) as Extract<keyof T, string>[]) stamps[key] = at;
  return stamps;
}

// ---------------------------------------------------------------------------
// Abbildung Dexie-Zeile ↔ Domäne
// ---------------------------------------------------------------------------

export function rowToRecipe(row: LocalRecipeRow): Recipe {
  return {
    id: row.id,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    field_updated_at: row.field_updated_at,
    fields: {
      household_id: row.household_id,
      title: row.title,
      base_servings: row.base_servings,
      tags: [...row.tags],
      instructions: row.instructions,
    },
  };
}

export function recipeToRow(recipe: Recipe): LocalRecipeRow {
  return {
    ...recipe.fields,
    id: recipe.id,
    title_normalized: normalizeRecipeTitle(recipe.fields.title),
    updated_at: recipe.updated_at,
    deleted_at: recipe.deleted_at,
    field_updated_at: recipe.field_updated_at,
  };
}

export function rowToRecipeIngredient(row: LocalRecipeIngredientRow): RecipeIngredient {
  return {
    id: row.id,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    field_updated_at: row.field_updated_at,
    fields: {
      recipe_id: row.recipe_id,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      sort_order: row.sort_order,
    },
  };
}

export function recipeIngredientToRow(ingredient: RecipeIngredient): LocalRecipeIngredientRow {
  return {
    ...ingredient.fields,
    id: ingredient.id,
    updated_at: ingredient.updated_at,
    deleted_at: ingredient.deleted_at,
    field_updated_at: ingredient.field_updated_at,
  };
}

// ---------------------------------------------------------------------------
// Outbox-Payloads (Server-Spalten, ohne lokale Suchspalten)
// ---------------------------------------------------------------------------

function recipeServerRow(row: LocalRecipeRow, includeDeletedAt = false): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: row.id,
    household_id: row.household_id,
    title: row.title,
    base_servings: row.base_servings,
    tags: row.tags,
    instructions: row.instructions,
    updated_at: row.updated_at,
  };
  if (includeDeletedAt) payload.deleted_at = row.deleted_at;
  return payload;
}

function ingredientServerRow(
  row: LocalRecipeIngredientRow,
  includeDeletedAt = false,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: row.id,
    recipe_id: row.recipe_id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    sort_order: row.sort_order,
    updated_at: row.updated_at,
  };
  if (includeDeletedAt) payload.deleted_at = row.deleted_at;
  return payload;
}

function upsertEntry(
  table: string,
  row: Record<string, unknown>,
  changedFields: readonly string[],
  now: string,
): UpsertEntry {
  return {
    id: uuidv7(),
    table,
    op: 'upsert',
    client_ts: now,
    attempts: 0,
    payload: { row: row as unknown as ListItemRowData, changed_fields: [...changedFields] },
  };
}

function deleteEntry(table: string, id: RowId, now: string): DeleteEntry {
  return {
    id: uuidv7(),
    table,
    op: 'delete',
    client_ts: now,
    attempts: 0,
    payload: { id },
  };
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

export async function listActiveRecipes(db: EinkaufszettelDB): Promise<Recipe[]> {
  const rows = await db.recipes.toArray();
  return rows
    .filter((row) => row.deleted_at === null)
    .map(rowToRecipe)
    .sort((a, b) => a.fields.title.localeCompare(b.fields.title, 'de'));
}

export async function getRecipe(db: EinkaufszettelDB, id: string): Promise<Recipe | null> {
  const row = await db.recipes.get(id);
  if (row === undefined || row.deleted_at !== null) return null;
  return rowToRecipe(row);
}

/** Normalisiert eine Suchanfrage (trimmen, Kleinschreibung, de-DE). */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase('de-DE');
}

/**
 * Prüft ein Rezept gegen eine bereits normalisierte Suchanfrage.
 * Teiltreffer in Titel ODER Tags, case-insensitiv. Leere Anfrage passt immer.
 * Wird von der DB-Suche und der Rezeptseite gemeinsam genutzt, damit beide
 * dieselbe Semantik haben.
 */
export function recipeMatchesNeedle(recipe: Recipe, needle: string): boolean {
  if (needle === '') return true;
  const title = recipe.fields.title.toLocaleLowerCase('de-DE');
  if (title.includes(needle)) return true;
  return recipe.fields.tags.some((tag) => tag.toLocaleLowerCase('de-DE').includes(needle));
}

/** Filtert eine Rezeptliste nach Titel und Tags (case-insensitiv, Teiltreffer). */
export function filterRecipesByQuery(recipes: readonly Recipe[], query: string): Recipe[] {
  const needle = normalizeSearchQuery(query);
  if (needle === '') return [...recipes];
  return recipes.filter((recipe) => recipeMatchesNeedle(recipe, needle));
}

/** Offline-Suche über Titel und Tags (case-insensitiv, Teiltreffer). */
export async function searchRecipes(db: EinkaufszettelDB, query: string): Promise<Recipe[]> {
  const all = await listActiveRecipes(db);
  return filterRecipesByQuery(all, query);
}

export async function listRecipeIngredients(
  db: EinkaufszettelDB,
  recipeId: string,
): Promise<RecipeIngredient[]> {
  const rows = await db.recipe_ingredients.where('recipe_id').equals(recipeId).toArray();
  return rows
    .filter((row) => row.deleted_at === null)
    .map(rowToRecipeIngredient)
    .sort(
      (a, b) =>
        a.fields.sort_order - b.fields.sort_order ||
        a.fields.name.localeCompare(b.fields.name, 'de'),
    );
}

// ---------------------------------------------------------------------------
// Zutaten-Helfer
// ---------------------------------------------------------------------------

function buildIngredient(
  draft: ValidatedIngredientDraft,
  recipeId: string,
  sortOrder: number,
  now: string,
): RecipeIngredient {
  const fields: RecipeIngredientFields = {
    recipe_id: recipeId,
    name: draft.name.trim(),
    quantity: draft.quantity,
    unit: draft.unit,
    sort_order: sortOrder,
  };
  return {
    id: draft.id ?? uuidv7(),
    updated_at: now,
    deleted_at: null,
    field_updated_at: stampFields(fields, now),
    fields,
  };
}

function changedIngredientFields(
  current: RecipeIngredientFields,
  next: RecipeIngredientFields,
): Array<keyof RecipeIngredientFields> {
  const changed: Array<keyof RecipeIngredientFields> = [];
  if (current.name !== next.name) changed.push('name');
  if (current.quantity !== next.quantity) changed.push('quantity');
  if (current.unit !== next.unit) changed.push('unit');
  if (current.sort_order !== next.sort_order) changed.push('sort_order');
  if (current.recipe_id !== next.recipe_id) changed.push('recipe_id');
  return changed;
}

function changedRecipeFields(current: RecipeFields, next: RecipeFields): Array<keyof RecipeFields> {
  const changed: Array<keyof RecipeFields> = [];
  if (current.household_id !== next.household_id) changed.push('household_id');
  if (current.title !== next.title) changed.push('title');
  if (current.base_servings !== next.base_servings) changed.push('base_servings');
  if (JSON.stringify(current.tags) !== JSON.stringify(next.tags)) changed.push('tags');
  if (current.instructions !== next.instructions) changed.push('instructions');
  return changed;
}

// ---------------------------------------------------------------------------
// Rezepte schreiben
// ---------------------------------------------------------------------------

/**
 * Legt ein Rezept inkl. Zutaten lokal an und reiht Rezept + jede Zutat als
 * UUID-Upsert in die Outbox ein. UI-Pfad: erst Dexie, dann Outbox.
 */
export async function createRecipeLocal(
  db: EinkaufszettelDB,
  input: NewRecipeInput,
  now: string,
): Promise<Recipe> {
  if (input.household_id.trim() === '') {
    throw new RecipeValidationError(['Haushalt fehlt – Rezept kann nicht angelegt werden.']);
  }
  const validated = parseRecipeInput(input);
  const drafts = parseIngredientDrafts(input.ingredients ?? []);

  const fields: RecipeFields = {
    household_id: input.household_id,
    title: validated.title.trim(),
    base_servings: validated.base_servings,
    tags: sanitizeTags(validated.tags),
    instructions: validated.instructions,
  };
  const recipe: Recipe = {
    id: input.id ?? uuidv7(),
    updated_at: now,
    deleted_at: null,
    field_updated_at: stampFields(fields, now),
    fields,
  };
  const row = recipeToRow(recipe);

  await db.transaction('rw', db.recipes, db.recipe_ingredients, db.outbox, async () => {
    await db.recipes.put(row);
    await enqueueOutbox(db, upsertEntry('recipes', recipeServerRow(row), Object.keys(fields), now));

    let sortOrder = 0;
    for (const draft of drafts) {
      const ingredient = buildIngredient(draft, recipe.id, sortOrder, now);
      const ingredientRow = recipeIngredientToRow(ingredient);
      await db.recipe_ingredients.put(ingredientRow);
      await enqueueOutbox(
        db,
        upsertEntry(
          'recipe_ingredients',
          ingredientServerRow(ingredientRow),
          Object.keys(ingredient.fields),
          now,
        ),
      );
      sortOrder += 1;
    }
  });

  notifyOutboxChanged();
  return recipe;
}

/** Ändert Rezept-Metadaten; identische Werte erzeugen keinen Outbox-Eintrag. */
export async function updateRecipeLocal(
  db: EinkaufszettelDB,
  id: string,
  patch: RecipePatch,
  now: string,
): Promise<Recipe | null> {
  const result = await db.transaction('rw', db.recipes, db.outbox, async () => {
    const row = await db.recipes.get(id);
    if (row === undefined || row.deleted_at !== null) return null;

    const current = rowToRecipe(row);
    const merged: RecipeFields = {
      ...current.fields,
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.base_servings === undefined ? {} : { base_servings: patch.base_servings }),
      ...(patch.tags === undefined ? {} : { tags: patch.tags }),
      ...(patch.instructions === undefined ? {} : { instructions: patch.instructions }),
    };
    const validated = parseRecipeInput(merged);
    const fields: RecipeFields = {
      ...merged,
      title: validated.title.trim(),
      base_servings: validated.base_servings,
      tags: sanitizeTags(validated.tags),
      instructions: validated.instructions,
    };

    const changed = changedRecipeFields(current.fields, fields);
    if (changed.length === 0) return current;

    const stamps: FieldTimestamps<RecipeFields> = { ...current.field_updated_at };
    for (const key of changed) stamps[key] = now;
    const updated: Recipe = { ...current, fields, updated_at: now, field_updated_at: stamps };
    const nextRow = recipeToRow(updated);
    await db.recipes.put(nextRow);
    await enqueueOutbox(db, upsertEntry('recipes', recipeServerRow(nextRow), changed, now));
    return updated;
  });

  if (result !== null) notifyOutboxChanged();
  return result;
}

/**
 * Soft-Delete eines Rezepts inkl. aller Zutaten. Kein Bestätigungsdialog:
 * die UI zeigt anschließend einen Undo-Toast (B4).
 */
export async function deleteRecipeLocal(
  db: EinkaufszettelDB,
  id: string,
  now: string,
): Promise<boolean> {
  const deleted = await db.transaction(
    'rw',
    db.recipes,
    db.recipe_ingredients,
    db.outbox,
    async () => {
      const row = await db.recipes.get(id);
      if (row === undefined) return false;
      if (row.deleted_at !== null) return true;

      const ingredients = await db.recipe_ingredients.where('recipe_id').equals(id).toArray();
      for (const ingredient of ingredients) {
        if (ingredient.deleted_at !== null) continue;
        await db.recipe_ingredients.put({ ...ingredient, deleted_at: now, updated_at: now });
        await enqueueOutbox(db, deleteEntry('recipe_ingredients', ingredient.id, now));
      }

      await db.recipes.put({ ...row, deleted_at: now, updated_at: now });
      await enqueueOutbox(db, deleteEntry('recipes', id, now));
      return true;
    },
  );

  if (deleted) notifyOutboxChanged();
  return deleted;
}

/**
 * Macht einen Soft-Delete rückgängig. Entfernt noch nicht abgespielte
 * Delete-Einträge und reiht einen Upsert mit `deleted_at = null` ein, damit
 * auch ein bereits serverseitig gelöschter Datensatz wieder sichtbar wird.
 */
export async function restoreRecipeLocal(
  db: EinkaufszettelDB,
  id: string,
  now: string,
): Promise<Recipe | null> {
  const restored = await db.transaction(
    'rw',
    db.recipes,
    db.recipe_ingredients,
    db.outbox,
    async () => {
      const row = await db.recipes.get(id);
      if (row === undefined) return null;
      if (row.deleted_at === null) return rowToRecipe(row);

      const previousDeletedAt = row.deleted_at;
      const ingredients = await db.recipe_ingredients.where('recipe_id').equals(id).toArray();
      const restoreIds = new Set(
        ingredients
          .filter((ingredient) => ingredient.deleted_at === previousDeletedAt)
          .map((i) => i.id),
      );

      const outbox = await readOutbox(db);
      const remaining: OutboxEntry[] = outbox.entries.filter((entry) => {
        if (entry.op !== 'delete') return true;
        if (entry.table === 'recipes' && entry.payload.id === id) return false;
        return !(entry.table === 'recipe_ingredients' && restoreIds.has(entry.payload.id));
      });
      const nextOutbox: Outbox = { entries: remaining };
      await writeOutbox(db, nextOutbox);

      const nextRow: LocalRecipeRow = { ...row, deleted_at: null, updated_at: now };
      await db.recipes.put(nextRow);
      await enqueueOutbox(
        db,
        upsertEntry('recipes', recipeServerRow(nextRow, true), ['deleted_at', 'updated_at'], now),
      );

      for (const ingredient of ingredients) {
        if (!restoreIds.has(ingredient.id)) continue;
        const nextIngredient: LocalRecipeIngredientRow = {
          ...ingredient,
          deleted_at: null,
          updated_at: now,
        };
        await db.recipe_ingredients.put(nextIngredient);
        await enqueueOutbox(
          db,
          upsertEntry(
            'recipe_ingredients',
            ingredientServerRow(nextIngredient, true),
            ['deleted_at', 'updated_at'],
            now,
          ),
        );
      }

      return rowToRecipe(nextRow);
    },
  );

  if (restored !== null) notifyOutboxChanged();
  return restored;
}

// ---------------------------------------------------------------------------
// Zutaten schreiben
// ---------------------------------------------------------------------------

export interface NewRecipeIngredientInput {
  recipe_id: string;
  name: string;
  quantity?: number | null;
  unit?: Unit | null;
  sort_order?: number;
}

export async function createRecipeIngredientLocal(
  db: EinkaufszettelDB,
  input: NewRecipeIngredientInput,
  now: string,
): Promise<RecipeIngredient | null> {
  const [draft] = parseIngredientDrafts([input]);
  if (draft === undefined) {
    throw new RecipeValidationError(['Zutat konnte nicht gelesen werden.']);
  }

  const created = await db.transaction(
    'rw',
    db.recipes,
    db.recipe_ingredients,
    db.outbox,
    async () => {
      const recipe = await db.recipes.get(input.recipe_id);
      if (recipe === undefined || recipe.deleted_at !== null) return null;

      const existing = await db.recipe_ingredients
        .where('recipe_id')
        .equals(input.recipe_id)
        .toArray();
      const sortOrder =
        input.sort_order ?? existing.filter((row) => row.deleted_at === null).length;
      const ingredient = buildIngredient(draft, input.recipe_id, sortOrder, now);
      const row = recipeIngredientToRow(ingredient);
      await db.recipe_ingredients.put(row);
      await enqueueOutbox(
        db,
        upsertEntry(
          'recipe_ingredients',
          ingredientServerRow(row),
          Object.keys(ingredient.fields),
          now,
        ),
      );
      return ingredient;
    },
  );

  if (created !== null) notifyOutboxChanged();
  return created;
}

export async function updateRecipeIngredientLocal(
  db: EinkaufszettelDB,
  id: string,
  patch: RecipeIngredientPatch,
  now: string,
): Promise<RecipeIngredient | null> {
  const result = await db.transaction('rw', db.recipe_ingredients, db.outbox, async () => {
    const row = await db.recipe_ingredients.get(id);
    if (row === undefined || row.deleted_at !== null) return null;

    const current = rowToRecipeIngredient(row);
    const merged: RecipeIngredientFields = {
      ...current.fields,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.quantity === undefined ? {} : { quantity: patch.quantity }),
      ...(patch.unit === undefined ? {} : { unit: patch.unit }),
      ...(patch.sort_order === undefined ? {} : { sort_order: patch.sort_order }),
    };
    const [validated] = parseIngredientDrafts([merged]);
    if (validated === undefined)
      throw new RecipeValidationError(['Zutat konnte nicht gelesen werden.']);
    const fields: RecipeIngredientFields = {
      ...merged,
      name: validated.name.trim(),
      quantity: validated.quantity,
      unit: validated.unit,
    };

    const changed = changedIngredientFields(current.fields, fields);
    if (changed.length === 0) return current;

    const stamps: FieldTimestamps<RecipeIngredientFields> = { ...current.field_updated_at };
    for (const key of changed) stamps[key] = now;
    const updated: RecipeIngredient = {
      ...current,
      fields,
      updated_at: now,
      field_updated_at: stamps,
    };
    const nextRow = recipeIngredientToRow(updated);
    await db.recipe_ingredients.put(nextRow);
    await enqueueOutbox(
      db,
      upsertEntry('recipe_ingredients', ingredientServerRow(nextRow), changed, now),
    );
    return updated;
  });

  if (result !== null) notifyOutboxChanged();
  return result;
}

export async function deleteRecipeIngredientLocal(
  db: EinkaufszettelDB,
  id: string,
  now: string,
): Promise<boolean> {
  const deleted = await db.transaction('rw', db.recipe_ingredients, db.outbox, async () => {
    const row = await db.recipe_ingredients.get(id);
    if (row === undefined) return false;
    if (row.deleted_at !== null) return true;
    await db.recipe_ingredients.put({ ...row, deleted_at: now, updated_at: now });
    await enqueueOutbox(db, deleteEntry('recipe_ingredients', id, now));
    return true;
  });

  if (deleted) notifyOutboxChanged();
  return deleted;
}

/**
 * Speichert das Rezeptformular atomar: Metadaten patchen und Zutaten diffen
 * (aktualisieren, neu anlegen, entfernen, neu sortieren). Ein einziger
 * Dexie-Transaktionsblock, damit ein Abbruch keinen halben Stand hinterlässt.
 */
export async function saveRecipeWithIngredientsLocal(
  db: EinkaufszettelDB,
  recipeId: string,
  patch: RecipePatch,
  drafts: RecipeIngredientDraft[],
  now: string,
): Promise<Recipe | null> {
  const validatedDrafts = parseIngredientDrafts(drafts);
  const draftIds = validatedDrafts
    .map((draft) => draft.id)
    .filter((value): value is string => value !== undefined);
  if (new Set(draftIds).size !== draftIds.length) {
    throw new RecipeValidationError(['Doppelte Zutaten im Formular.']);
  }

  const result = await db.transaction(
    'rw',
    db.recipes,
    db.recipe_ingredients,
    db.outbox,
    async () => {
      const row = await db.recipes.get(recipeId);
      if (row === undefined || row.deleted_at !== null) return null;

      const current = rowToRecipe(row);
      const merged: RecipeFields = {
        ...current.fields,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.base_servings === undefined ? {} : { base_servings: patch.base_servings }),
        ...(patch.tags === undefined ? {} : { tags: patch.tags }),
        ...(patch.instructions === undefined ? {} : { instructions: patch.instructions }),
      };
      const validated = parseRecipeInput(merged);
      const fields: RecipeFields = {
        ...merged,
        title: validated.title.trim(),
        base_servings: validated.base_servings,
        tags: sanitizeTags(validated.tags),
        instructions: validated.instructions,
      };

      let updated = current;
      const changed = changedRecipeFields(current.fields, fields);
      if (changed.length > 0) {
        const stamps: FieldTimestamps<RecipeFields> = { ...current.field_updated_at };
        for (const key of changed) stamps[key] = now;
        updated = { ...current, fields, updated_at: now, field_updated_at: stamps };
        const nextRow = recipeToRow(updated);
        await db.recipes.put(nextRow);
        await enqueueOutbox(db, upsertEntry('recipes', recipeServerRow(nextRow), changed, now));
      }

      const existingRows = await db.recipe_ingredients
        .where('recipe_id')
        .equals(recipeId)
        .toArray();
      const activeRows = existingRows.filter((candidate) => candidate.deleted_at === null);
      const byId = new Map(activeRows.map((candidate) => [candidate.id, candidate]));
      const seen = new Set<string>();

      for (let index = 0; index < validatedDrafts.length; index += 1) {
        const draft = validatedDrafts[index];
        if (draft === undefined) continue;

        const existing = draft.id === undefined ? undefined : byId.get(draft.id);
        if (existing !== undefined && draft.id !== undefined) {
          seen.add(draft.id);
          const mergedIngredient: RecipeIngredientFields = {
            recipe_id: recipeId,
            name: draft.name.trim(),
            quantity: draft.quantity,
            unit: draft.unit,
            sort_order: index,
          };
          const ingredientChanged = changedIngredientFields(
            {
              recipe_id: existing.recipe_id,
              name: existing.name,
              quantity: existing.quantity,
              unit: existing.unit,
              sort_order: existing.sort_order,
            },
            mergedIngredient,
          );
          if (ingredientChanged.length === 0) continue;

          const stamps: FieldTimestamps<RecipeIngredientFields> = { ...existing.field_updated_at };
          for (const key of ingredientChanged) stamps[key] = now;
          const nextRow: LocalRecipeIngredientRow = {
            ...existing,
            ...mergedIngredient,
            updated_at: now,
            field_updated_at: stamps,
          };
          await db.recipe_ingredients.put(nextRow);
          await enqueueOutbox(
            db,
            upsertEntry('recipe_ingredients', ingredientServerRow(nextRow), ingredientChanged, now),
          );
          continue;
        }

        const ingredient = buildIngredient(draft, recipeId, index, now);
        const nextRow = recipeIngredientToRow(ingredient);
        await db.recipe_ingredients.put(nextRow);
        await enqueueOutbox(
          db,
          upsertEntry(
            'recipe_ingredients',
            ingredientServerRow(nextRow),
            Object.keys(ingredient.fields),
            now,
          ),
        );
      }

      for (const candidate of activeRows) {
        if (seen.has(candidate.id)) continue;
        await db.recipe_ingredients.put({ ...candidate, deleted_at: now, updated_at: now });
        await enqueueOutbox(db, deleteEntry('recipe_ingredients', candidate.id, now));
      }

      return updated;
    },
  );

  if (result !== null) notifyOutboxChanged();
  return result;
}
