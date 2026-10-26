'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import type { ListItem } from '@einkaufszettel/core';
import { getDb, indexedDbAvailable } from './database';
import { rowToListItem } from './repository';
import {
  getRecipe,
  listActiveRecipes,
  listRecipeIngredients,
  rowToRecipe,
  type Recipe,
  type RecipeIngredient,
} from './recipes';

/**
 * Reaktiver Lesezugriff auf Dexie. Die UI liest ausschließlich hieraus
 * (PLAN.md §4.2); Schreibvorgänge laufen über das Repository.
 */
export function useActiveListItems(listId?: string): ListItem[] {
  const items = useLiveQuery(async () => {
    if (!indexedDbAvailable()) return [];
    const db = getDb();
    const rows =
      listId === undefined
        ? await db.list_items.toArray()
        : await db.list_items.where('list_id').equals(listId).toArray();
    return rows
      .filter((row) => row.deleted_at === null)
      .map(rowToListItem)
      .sort((a, b) => a.fields.name.localeCompare(b.fields.name, 'de'));
  }, [listId]);

  return items ?? [];
}

export function useActiveItemCount(): number {
  const count = useLiveQuery(async () => {
    if (!indexedDbAvailable()) return 0;
    return getDb()
      .list_items.filter((row) => row.deleted_at === null)
      .count();
  }, []);
  return count ?? 0;
}

export function usePendingOutboxCount(): number {
  const count = useLiveQuery(async () => {
    if (!indexedDbAvailable()) return 0;
    return getDb().outbox.count();
  }, []);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Rezepte (T3.2)
// ---------------------------------------------------------------------------

export interface RecipeListEntry {
  recipe: Recipe;
  ingredientCount: number;
}

/** Reaktive Rezeptliste inkl. Zutatenanzahl (für Karten/Übersicht). */
export function useRecipeListData(): RecipeListEntry[] {
  const data = useLiveQuery(async () => {
    if (!indexedDbAvailable()) return [];
    const db = getDb();
    const [recipeRows, ingredientRows] = await Promise.all([
      db.recipes.toArray(),
      db.recipe_ingredients.toArray(),
    ]);
    const counts = new Map<string, number>();
    for (const row of ingredientRows) {
      if (row.deleted_at !== null) continue;
      counts.set(row.recipe_id, (counts.get(row.recipe_id) ?? 0) + 1);
    }
    return recipeRows
      .filter((row) => row.deleted_at === null)
      .map((row) => ({ recipe: rowToRecipe(row), ingredientCount: counts.get(row.id) ?? 0 }))
      .sort((a, b) => a.recipe.fields.title.localeCompare(b.recipe.fields.title, 'de'));
  }, []);
  return data ?? [];
}

/**
 * Reaktives Einzelrezept. `undefined` = noch nicht geladen, `null` = gelöscht
 * oder nicht vorhanden. So kann die Detailseite Lade- und Fehlerzustand
 * unterscheiden.
 */
export function useRecipe(recipeId: string | null): Recipe | null | undefined {
  return useLiveQuery(async () => {
    if (!indexedDbAvailable() || recipeId === null) return null;
    return getRecipe(getDb(), recipeId);
  }, [recipeId]);
}

/** Reaktive Zutatenliste eines Rezepts. */
export function useRecipeIngredients(recipeId: string | null): RecipeIngredient[] {
  const ingredients = useLiveQuery(async () => {
    if (!indexedDbAvailable() || recipeId === null) return [];
    return listRecipeIngredients(getDb(), recipeId);
  }, [recipeId]);
  return ingredients ?? [];
}

/** Nur für Tests/Diagnose: Anzahl der aktiven Rezepte. */
export async function countActiveRecipes(): Promise<number> {
  if (!indexedDbAvailable()) return 0;
  return (await listActiveRecipes(getDb())).length;
}
