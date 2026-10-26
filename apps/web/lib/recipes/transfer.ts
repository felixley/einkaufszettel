import {
  addToList,
  formatIngredient,
  formatQuantity,
  normalizeName,
  scaleRecipe,
  type AddToListRequest,
  type ListItem,
  type Recipe,
  type RecipeIngredient,
  type ScalableIngredient,
  type ScaledIngredient,
  type Unit,
} from '@einkaufszettel/core';
import type { EinkaufszettelDB } from '@/lib/db/database';
import { enqueueAddToListLocal, listItemToRow } from '@/lib/db/repository';
import { uuidv7 } from '@/lib/db/uuid';

/**
 * Vorschau- und Transfer-Logik für „Auf die Einkaufsliste“ (T3.4).
 *
 * Die Funktionen sind bewusst frei von React/Dexie-Zugriffen, damit sie in
 * Vitest ohne Browser laufen. Nur `applyTransferRequests` schreibt lokal bzw.
 * in die Outbox. Einheiten-/Skalierungslogik kommt ausschließlich aus
 * `packages/core` (PLAN.md §4.3, kein Nachbau in der UI).
 */

export type TransferConflict = 'new' | 'aggregate' | 'incompatible' | 'missing-quantity';

/** Eine Zutat in der Vorschau des Dialogs. */
export interface TransferPreview {
  ingredientId: string;
  name: string;
  unit: Unit | null;
  scaledQuantity: number | null;
  /** Fertig formatierte Zeile, z. B. „750 g Spaghetti“. */
  display: string;
  /** RPC-Payload; `null`, wenn die Zutat keine übertragbare Menge hat. */
  request: AddToListRequest | null;
  conflict: TransferConflict;
  existingQuantity: number | null;
  existingUnit: Unit | null;
  resultingQuantity: number | null;
  /** Hinweis für die UI, z. B. „Bereits auf Liste (500 g) – wird zu 1,25 kg“. */
  hint: string | null;
}

export interface BuildTransferOptions {
  /** Nur für Tests: deterministische request_id-Erzeugung. */
  requestId?: () => string;
}

export interface BuildTransferResult {
  previews: TransferPreview[];
  requests: AddToListRequest[];
}

/** Minimale Rezeptform, die der Dialog benötigt (kompatibel zu Core-Recipe). */
export type TransferRecipe = Pick<Recipe, 'id' | 'fields'>;

const PREVIEW_NOW = '1970-01-01T00:00:00.000Z';

function scalableIngredients(ingredients: readonly RecipeIngredient[]): ScalableIngredient[] {
  return ingredients.map((ingredient) => ({
    name: ingredient.fields.name,
    quantity: ingredient.fields.quantity,
    unit: ingredient.fields.unit,
  }));
}

/**
 * Skaliert die Zutaten auf die Zielportionen. Ohne gültige Basisportionen
 * (z. B. „Portionen offen“) bleibt die Menge unverändert – dann gibt es nichts
 * zu rechnen.
 */
function scaledIngredients(
  recipe: TransferRecipe,
  ingredients: readonly RecipeIngredient[],
  targetServings: number | null,
): ScaledIngredient[] {
  const base = recipe.fields.base_servings;
  const scalable = scalableIngredients(ingredients);
  if (
    base === null ||
    !Number.isFinite(base) ||
    base <= 0 ||
    targetServings === null ||
    !Number.isFinite(targetServings) ||
    targetServings <= 0
  ) {
    return scalable;
  }
  return scaleRecipe(scalable, base, targetServings);
}

function activeRows(existingItems: readonly ListItem[], listId: string): ListItem[] {
  return existingItems.filter((item) => item.deleted_at === null && item.fields.list_id === listId);
}

function hintForAggregate(
  previousQuantity: number | null,
  previousUnit: Unit | null,
  resultingQuantity: number | null,
  resultingUnit: Unit | null,
): string {
  const unit = resultingUnit ?? previousUnit;
  if (previousQuantity === null) {
    return `Bereits auf Liste – wird zu ${formatQuantity(resultingQuantity, unit)}`;
  }
  return `Bereits auf Liste (${formatQuantity(previousQuantity, previousUnit)}) – wird zu ${formatQuantity(
    resultingQuantity,
    unit,
  )}`;
}

/**
 * Baut Vorschauzeilen ohne echte Idempotenzschlüssel. Die Vorschau ist rein
 * darstellend; `request_id` ist nur ein Platzhalter und wird erst beim
 * Bestätigen durch `buildTransferRequests` ersetzt.
 */
export function buildTransferPreviews(
  recipe: TransferRecipe,
  ingredients: readonly RecipeIngredient[],
  targetServings: number | null,
  existingItems: readonly ListItem[],
  listId: string,
): TransferPreview[] {
  const scaled = scaledIngredients(recipe, ingredients, targetServings);
  let working = activeRows(existingItems, listId);
  const previews: TransferPreview[] = [];

  for (let index = 0; index < ingredients.length; index += 1) {
    const ingredient = ingredients[index];
    const scaledIngredient = scaled[index];
    if (ingredient === undefined || scaledIngredient === undefined) continue;

    const name = scaledIngredient.name;
    const unit = scaledIngredient.unit;
    const quantity = scaledIngredient.quantity;
    const ingredientId = ingredient.id;

    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
      previews.push({
        ingredientId,
        name,
        unit,
        scaledQuantity: quantity,
        display: formatIngredient({ name, quantity, unit }),
        request: null,
        conflict: 'missing-quantity',
        existingQuantity: null,
        existingUnit: null,
        resultingQuantity: null,
        hint: 'Ohne Mengenangabe – bitte manuell ergänzen.',
      });
      continue;
    }

    const request: AddToListRequest = {
      request_id: `preview-${ingredientId}`,
      list_id: listId,
      name: name.trim(),
      quantity,
      unit,
      source_recipe_id: recipe.id,
    };

    const sameNameRow = working.find((row) => row.fields.name_normalized === normalizeName(name));
    const outcome = addToList(working, request, {
      now: PREVIEW_NOW,
      applied_request_ids: new Set<string>(),
      generate_id: uuidv7,
    });
    const affectedId = outcome.affected?.id;
    const previous = affectedId ? working.find((row) => row.id === affectedId) : undefined;
    working = outcome.rows;

    if (outcome.created) {
      const incompatible = sameNameRow !== undefined;
      previews.push({
        ingredientId,
        name,
        unit,
        scaledQuantity: quantity,
        display: formatIngredient({ name, quantity, unit }),
        request,
        conflict: incompatible ? 'incompatible' : 'new',
        existingQuantity: sameNameRow?.fields.quantity ?? null,
        existingUnit: sameNameRow?.fields.unit ?? null,
        resultingQuantity: quantity,
        hint: incompatible
          ? 'Eigene Zeile – eine Zutat mit gleichem Namen, aber anderer Einheit steht bereits auf der Liste.'
          : null,
      });
      continue;
    }

    const affected = outcome.affected;
    previews.push({
      ingredientId,
      name,
      unit,
      scaledQuantity: quantity,
      display: formatIngredient({ name, quantity, unit }),
      request,
      conflict: 'aggregate',
      existingQuantity: previous?.fields.quantity ?? null,
      existingUnit: previous?.fields.unit ?? null,
      resultingQuantity: affected?.fields.quantity ?? quantity,
      hint: hintForAggregate(
        previous?.fields.quantity ?? null,
        previous?.fields.unit ?? null,
        affected?.fields.quantity ?? quantity,
        affected?.fields.unit ?? unit,
      ),
    });
  }

  return previews;
}

/**
 * Baut die RPC-Payloads für die ausgewählten Zutaten. `request_id` wird genau
 * einmal pro Zutat und Bestätigung erzeugt: Ein Outbox-Replay mit derselben ID
 * addiert die Menge nicht erneut; eine bewusste zweite Übertragung erzeugt neue
 * IDs und addiert die Menge (PLAN.md §4.2, T3.4).
 */
export function buildTransferRequests(
  recipe: TransferRecipe,
  ingredients: readonly RecipeIngredient[],
  targetServings: number | null,
  selection: ReadonlySet<string>,
  existingItems: readonly ListItem[],
  listId: string,
  options: BuildTransferOptions = {},
): BuildTransferResult {
  const previews = buildTransferPreviews(
    recipe,
    ingredients,
    targetServings,
    existingItems,
    listId,
  );
  const nextId = options.requestId ?? uuidv7;
  const requests: AddToListRequest[] = [];

  for (const preview of previews) {
    if (!selection.has(preview.ingredientId)) continue;
    if (preview.request === null) continue;
    const request: AddToListRequest = { ...preview.request, request_id: nextId() };
    requests.push(request);
  }

  return { previews, requests };
}

export type TransferMode = 'mock' | 'supabase';

export interface ApplyTransferOptions {
  mode: TransferMode;
  now: string;
  /** Aktive Zeilen der Liste; im Mock-Modus wird dagegen aggregiert. */
  existingItems: readonly ListItem[];
}

/**
 * Wendet die Übertragung an.
 *
 * - `mock`: Es gibt keinen Server; die Core-Funktion `addToList` aggregiert
 *   gegen die vorhandenen Dexie-Zeilen und schreibt das Ergebnis lokal.
 * - `supabase`: Jede Zutat landet als `add_to_list`-Eintrag in der Outbox und
 *   wird vom Sync-Worker per RPC übertragen (offline-fähig, idempotent).
 */
export async function applyTransferRequests(
  db: EinkaufszettelDB,
  requests: readonly AddToListRequest[],
  options: ApplyTransferOptions,
): Promise<number> {
  if (requests.length === 0) return 0;

  if (options.mode === 'mock') {
    let rows = options.existingItems.filter((item) => item.deleted_at === null);
    const changed = new Map<string, ListItem>();
    for (const request of requests) {
      const outcome = addToList(rows, request, {
        now: options.now,
        applied_request_ids: new Set<string>(),
        generate_id: uuidv7,
      });
      rows = outcome.rows;
      if (outcome.affected !== null) changed.set(outcome.affected.id, outcome.affected);
    }
    await db.transaction('rw', db.list_items, async () => {
      for (const row of changed.values()) await db.list_items.put(listItemToRow(row));
    });
    return requests.length;
  }

  for (const request of requests) {
    await enqueueAddToListLocal(db, request, options.now);
  }
  return requests.length;
}
