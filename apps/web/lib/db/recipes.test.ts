import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OutboxEntry, UpsertEntry } from '@einkaufszettel/core';
import { EinkaufszettelDB } from './database';
import { readOutbox } from './repository';
import {
  createRecipeLocal,
  deleteRecipeLocal,
  filterRecipesByQuery,
  getRecipe,
  listActiveRecipes,
  listRecipeIngredients,
  normalizeSearchQuery,
  recipeMatchesNeedle,
  restoreRecipeLocal,
  saveRecipeWithIngredientsLocal,
  searchRecipes,
  updateRecipeLocal,
} from './recipes';
import { RecipeValidationError } from '@/lib/recipes/validation';

const T1 = '2026-02-01T00:00:01.000Z';
const T2 = '2026-02-01T00:00:02.000Z';
const T3 = '2026-02-01T00:00:03.000Z';

let db: EinkaufszettelDB;

beforeEach(async () => {
  db = new EinkaufszettelDB(`einkaufszettel-recipe-test-${crypto.randomUUID()}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

async function createSampleRecipe(title = 'Pasta Pomodoro') {
  return createRecipeLocal(
    db,
    {
      household_id: 'haushalt-1',
      title,
      base_servings: 4,
      tags: ['vegetarisch', 'italienisch'],
      instructions: 'Kochen.',
      ingredients: [
        { name: 'Spaghetti', quantity: 500, unit: 'g' },
        { name: 'Tomaten', quantity: 2, unit: 'Dose' },
      ],
    },
    T1,
  );
}

describe('Rezept-Repository (T3.2)', () => {
  it('legt Rezept und Zutaten lokal an und reiht je einen Upsert in die Outbox ein', async () => {
    const recipe = await createSampleRecipe();

    expect(recipe.fields.title).toBe('Pasta Pomodoro');
    expect(recipe.fields.tags).toEqual(['vegetarisch', 'italienisch']);
    expect(recipe.deleted_at).toBeNull();

    const active = await listActiveRecipes(db);
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(recipe.id);

    const ingredients = await listRecipeIngredients(db, recipe.id);
    expect(ingredients).toHaveLength(2);
    expect(ingredients.map((ingredient) => ingredient.fields.name)).toEqual([
      'Spaghetti',
      'Tomaten',
    ]);
    expect(ingredients[0]?.fields.sort_order).toBe(0);
    expect(ingredients[1]?.fields.sort_order).toBe(1);

    const outbox = await readOutbox(db);
    expect(outbox.entries).toHaveLength(3);
    expect(outbox.entries.every((entry: OutboxEntry) => entry.op === 'upsert')).toBe(true);
    const tables = outbox.entries.map((entry: OutboxEntry) => entry.table).sort();
    expect(tables).toEqual(['recipe_ingredients', 'recipe_ingredients', 'recipes']);
    const recipeEntry = outbox.entries.find(
      (entry: OutboxEntry) => entry.table === 'recipes',
    ) as UpsertEntry;
    const payload = recipeEntry.payload.row as unknown as { title?: string };
    expect(payload.title).toBe('Pasta Pomodoro');
  });

  it('sucht nach Titel und Tags (case-insensitiv, Teiltreffer)', async () => {
    await createSampleRecipe('Pasta Pomodoro');
    await createRecipeLocal(
      db,
      {
        household_id: 'haushalt-1',
        title: 'Gemüsecurry',
        tags: ['vegan'],
        ingredients: [{ name: 'Kokosmilch', quantity: 400, unit: 'ml' }],
      },
      T1,
    );

    expect(await searchRecipes(db, 'pasta')).toHaveLength(1);
    expect(await searchRecipes(db, 'VEGAN')).toHaveLength(1);
    expect(await searchRecipes(db, 'italien')).toHaveLength(1);
    expect(await searchRecipes(db, 'suppe')).toHaveLength(0);
    expect(await searchRecipes(db, '')).toHaveLength(2);
  });

  it('Suchhelfer und DB-Suche haben identische Semantik (Titel ODER Tags)', async () => {
    const pasta = await createSampleRecipe('Pasta Pomodoro');
    const curry = await createRecipeLocal(
      db,
      {
        household_id: 'haushalt-1',
        title: 'Gemüsecurry',
        tags: ['vegan'],
        ingredients: [{ name: 'Kokosmilch', quantity: 400, unit: 'ml' }],
      },
      T1,
    );

    expect(normalizeSearchQuery('  VEGAN  ')).toBe('vegan');

    const active = await listActiveRecipes(db);
    expect(filterRecipesByQuery(active, '')).toHaveLength(2);
    expect(filterRecipesByQuery(active, '   ')).toHaveLength(2);

    // Titel-Teiltreffer auch mitten im Wort, nicht nur als Präfix.
    const byTitle = await searchRecipes(db, '  MODORO ');
    expect(byTitle.map((recipe) => recipe.id)).toEqual([pasta.id]);

    // Tag-Teiltreffer case-insensitiv – 'VEGAN' trifft nur das Curry
    // ('vegetarisch' beim Pasta-Rezept enthält kein 'vegan').
    const byTag = await searchRecipes(db, '  vegan  ');
    expect(byTag.map((recipe) => recipe.id)).toEqual([curry.id]);

    // Zutatennamen sind (bewusst) keine Suchfelder.
    expect(await searchRecipes(db, 'Kokosmilch')).toHaveLength(0);

    // Helfer und DB-Suche liefern dasselbe Ergebnis – keine Doppellogik.
    expect(filterRecipesByQuery(active, ' vegan ').map((recipe) => recipe.id)).toEqual(
      byTag.map((recipe) => recipe.id),
    );
    expect(recipeMatchesNeedle(pasta, 'italien')).toBe(true);
    expect(recipeMatchesNeedle(pasta, 'suppe')).toBe(false);
  });

  it('getRecipe liefert null für unbekannte und soft-gelöschte Rezepte', async () => {
    const recipe = await createSampleRecipe();
    expect((await getRecipe(db, recipe.id))?.id).toBe(recipe.id);
    expect(await getRecipe(db, 'unbekannt')).toBeNull();

    await deleteRecipeLocal(db, recipe.id, T2);
    expect(await getRecipe(db, recipe.id)).toBeNull();
    expect(await listActiveRecipes(db)).toHaveLength(0);
    expect(await listRecipeIngredients(db, recipe.id)).toHaveLength(0);
  });

  it('Soft-Delete markiert Rezept und Zutaten und reiht Delete-Einträge ein', async () => {
    const recipe = await createSampleRecipe();
    // Outbox leeren, damit nur die Delete-Einträge gezählt werden.
    await db.outbox.clear();

    expect(await deleteRecipeLocal(db, recipe.id, T2)).toBe(true);
    // Zweiter Aufruf ist idempotent und erzeugt keinen weiteren Eintrag.
    expect(await deleteRecipeLocal(db, recipe.id, T3)).toBe(true);

    const row = await db.recipes.get(recipe.id);
    expect(row?.deleted_at).toBe(T2);

    const ingredientRows = await db.recipe_ingredients
      .where('recipe_id')
      .equals(recipe.id)
      .toArray();
    expect(ingredientRows.every((ingredient) => ingredient.deleted_at === T2)).toBe(true);

    const outbox = await readOutbox(db);
    expect(outbox.entries).toHaveLength(3);
    expect(outbox.entries.every((entry) => entry.op === 'delete')).toBe(true);
  });

  it('Undo stellt Rezept und Zutaten wieder her und räumt Delete-Einträge auf', async () => {
    const recipe = await createSampleRecipe();
    await deleteRecipeLocal(db, recipe.id, T2);

    const restored = await restoreRecipeLocal(db, recipe.id, T3);
    expect(restored?.deleted_at).toBeNull();

    const row = await db.recipes.get(recipe.id);
    expect(row?.deleted_at).toBeNull();
    const ingredients = await listRecipeIngredients(db, recipe.id);
    expect(ingredients).toHaveLength(2);

    const outbox = await readOutbox(db);
    expect(outbox.entries.some((entry) => entry.op === 'delete')).toBe(false);
    const recipeUpsert = outbox.entries.find(
      (entry) => entry.table === 'recipes' && entry.op === 'upsert',
    ) as UpsertEntry;
    expect(recipeUpsert.payload.changed_fields).toContain('deleted_at');
  });

  it('Update ohne Änderung erzeugt keinen Outbox-Eintrag', async () => {
    const recipe = await createSampleRecipe();
    await db.outbox.clear();

    const unchanged = await updateRecipeLocal(db, recipe.id, { title: 'Pasta Pomodoro' }, T2);
    expect(unchanged?.id).toBe(recipe.id);
    expect((await readOutbox(db)).entries).toHaveLength(0);
  });

  it('Update ändert nur geänderte Felder und reiht einen Upsert ein', async () => {
    const recipe = await createSampleRecipe();
    await db.outbox.clear();

    const updated = await updateRecipeLocal(db, recipe.id, { title: 'Pasta Deluxe' }, T2);
    expect(updated?.fields.title).toBe('Pasta Deluxe');

    const outbox = await readOutbox(db);
    expect(outbox.entries).toHaveLength(1);
    const entry = outbox.entries[0] as UpsertEntry;
    expect(entry.payload.changed_fields).toEqual(['title']);
  });

  it('saveRecipeWithIngredientsLocal diffed Zutaten (ändern, neu, entfernen)', async () => {
    const recipe = await createSampleRecipe();
    const [first, second] = await listRecipeIngredients(db, recipe.id);
    if (first === undefined || second === undefined) throw new Error('Zutaten fehlen');
    await db.outbox.clear();

    const saved = await saveRecipeWithIngredientsLocal(
      db,
      recipe.id,
      { title: 'Pasta Pomodoro' },
      [
        { id: first.id, name: 'Spaghetti', quantity: 600, unit: 'g' },
        { name: 'Basilikum', quantity: 1, unit: 'Bund' },
      ],
      T2,
    );
    expect(saved?.id).toBe(recipe.id);

    const ingredients = await listRecipeIngredients(db, recipe.id);
    expect(ingredients).toHaveLength(2);
    expect(ingredients.find((ingredient) => ingredient.id === first.id)?.fields.quantity).toBe(600);
    expect(ingredients.some((ingredient) => ingredient.id === second.id)).toBe(false);
    expect(ingredients.some((ingredient) => ingredient.fields.name === 'Basilikum')).toBe(true);

    const outbox = await readOutbox(db);
    // 1 Update (Spaghetti), 1 Neuanlage (Basilikum), 1 Delete (Tomaten)
    expect(outbox.entries).toHaveLength(3);
    expect(outbox.entries.filter((entry) => entry.op === 'delete')).toHaveLength(1);
  });

  it('validiert Eingaben: leerer Titel und ungültige Portionen werfen', async () => {
    await expect(
      createRecipeLocal(db, { household_id: 'haushalt-1', title: '   ' }, T1),
    ).rejects.toBeInstanceOf(RecipeValidationError);
    await expect(
      createRecipeLocal(db, { household_id: 'haushalt-1', title: 'Test', base_servings: -2 }, T1),
    ).rejects.toBeInstanceOf(RecipeValidationError);
  });
});
