import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ListItem,
  Recipe,
  RecipeIngredient,
  RecipeIngredientFields,
  RecipeFields,
  Unit,
  VersionedRow,
} from '@einkaufszettel/core';
import { normalizeName } from '@einkaufszettel/core';
import { EinkaufszettelDB } from '@/lib/db/database';
import { listItemToRow, readOutbox, rowToListItem } from '@/lib/db/repository';
import {
  applyTransferRequests,
  buildTransferPreviews,
  buildTransferRequests,
} from '@/lib/recipes/transfer';

const T1 = '2026-03-01T10:00:00.000Z';
const T2 = '2026-03-01T10:05:00.000Z';
const LIST = 'list-1';

function makeRecipe(baseServings: number | null): Recipe {
  const fields: RecipeFields = {
    household_id: 'household-1',
    title: 'Pasta Pomodoro',
    base_servings: baseServings,
    tags: [],
    instructions: null,
  };
  const recipe: VersionedRow<RecipeFields> = {
    id: 'recipe-1',
    updated_at: T1,
    deleted_at: null,
    field_updated_at: {},
    fields,
  };
  return recipe;
}

function makeIngredient(
  id: string,
  name: string,
  quantity: number | null,
  unit: Unit | null,
  sortOrder: number,
): RecipeIngredient {
  const fields: RecipeIngredientFields = {
    recipe_id: 'recipe-1',
    name,
    quantity,
    unit,
    sort_order: sortOrder,
  };
  return {
    id,
    updated_at: T1,
    deleted_at: null,
    field_updated_at: {},
    fields,
  };
}

function makeListItem(
  id: string,
  name: string,
  quantity: number | null,
  unit: Unit | null,
  sourceRecipeId: string | null = null,
): ListItem {
  return {
    id,
    updated_at: T1,
    deleted_at: null,
    field_updated_at: {},
    fields: {
      list_id: LIST,
      name,
      name_normalized: normalizeName(name),
      quantity,
      unit,
      category_id: null,
      checked: false,
      checked_by: null,
      source_recipe_id: sourceRecipeId,
      note: null,
    },
  };
}

let db: EinkaufszettelDB;

beforeEach(async () => {
  db = new EinkaufszettelDB(`einkaufszettel-transfer-test-${crypto.randomUUID()}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('buildTransferPreviews', () => {
  it('skaliert Zutaten von Basis 4 auf 6 Portionen', () => {
    const recipe = makeRecipe(4);
    const ingredients = [
      makeIngredient('ing-1', 'Spaghetti', 500, 'g', 1),
      makeIngredient('ing-2', 'Tomaten', 2, 'Dose', 2),
    ];

    const previews = buildTransferPreviews(recipe, ingredients, 6, [], LIST);

    expect(previews[0]?.display).toBe('750 g Spaghetti');
    expect(previews[0]?.scaledQuantity).toBe(750);
    expect(previews[0]?.conflict).toBe('new');
    expect(previews[0]?.hint).toBeNull();
    expect(previews[1]?.display).toBe('3 Dosen Tomaten');
    expect(previews[1]?.conflict).toBe('new');
  });

  it('zeigt „Bereits auf Liste“ und die aggregierte Zielmenge', () => {
    const recipe = makeRecipe(4);
    const ingredients = [makeIngredient('ing-1', 'Spaghetti', 500, 'g', 1)];
    const existing = [makeListItem('item-1', 'Spaghetti', 500, 'g')];

    const previews = buildTransferPreviews(recipe, ingredients, 6, existing, LIST);

    expect(previews[0]?.conflict).toBe('aggregate');
    expect(previews[0]?.existingQuantity).toBe(500);
    expect(previews[0]?.existingUnit).toBe('g');
    expect(previews[0]?.resultingQuantity).toBe(1250);
    expect(previews[0]?.hint).toContain('Bereits auf Liste (500 g)');
    expect(previews[0]?.hint).toContain('wird zu 1,25 kg');
  });

  it('markiert eine inkompatible Einheit als eigene Zeile', () => {
    const recipe = makeRecipe(4);
    const ingredients = [makeIngredient('ing-1', 'Spaghetti', 500, 'g', 1)];
    const existing = [makeListItem('item-1', 'Spaghetti', 2, 'Stk')];

    const previews = buildTransferPreviews(recipe, ingredients, 4, existing, LIST);

    expect(previews[0]?.conflict).toBe('incompatible');
    expect(previews[0]?.existingQuantity).toBe(2);
    expect(previews[0]?.existingUnit).toBe('Stk');
    expect(previews[0]?.hint).toContain('Eigene Zeile');
  });

  it('behandelt Zutaten ohne Menge als nicht übertragbar', () => {
    const recipe = makeRecipe(4);
    const ingredients = [makeIngredient('ing-1', 'Salz', null, 'Prise', 1)];

    const previews = buildTransferPreviews(recipe, ingredients, 6, [], LIST);

    expect(previews[0]?.conflict).toBe('missing-quantity');
    expect(previews[0]?.request).toBeNull();
    expect(previews[0]?.hint).toContain('Ohne Mengenangabe');
  });

  it('skaliert nicht, wenn die Basisportionen offen sind', () => {
    const recipe = makeRecipe(null);
    const ingredients = [makeIngredient('ing-1', 'Spaghetti', 500, 'g', 1)];

    const previews = buildTransferPreviews(recipe, ingredients, 6, [], LIST);

    expect(previews[0]?.display).toBe('500 g Spaghetti');
    expect(previews[0]?.scaledQuantity).toBe(500);
  });

  it('aggregiert mehrere Zutaten mit gleichem Namen innerhalb eines Entwurfs', () => {
    const recipe = makeRecipe(4);
    const ingredients = [
      makeIngredient('ing-1', 'Mehl', 250, 'g', 1),
      makeIngredient('ing-2', 'Mehl', 250, 'g', 2),
    ];

    const previews = buildTransferPreviews(recipe, ingredients, 4, [], LIST);

    expect(previews[0]?.conflict).toBe('new');
    expect(previews[0]?.resultingQuantity).toBe(250);
    expect(previews[1]?.conflict).toBe('aggregate');
    expect(previews[1]?.resultingQuantity).toBe(500);
    expect(previews[1]?.hint).toContain('Bereits auf Liste');
  });
});

describe('buildTransferRequests', () => {
  it('erzeugt nur für ausgewählte Zutaten Requests mit stabiler request_id', () => {
    const recipe = makeRecipe(4);
    const ingredients = [
      makeIngredient('ing-1', 'Spaghetti', 500, 'g', 1),
      makeIngredient('ing-2', 'Tomaten', 2, 'Dose', 2),
    ];
    let next = 0;
    const requestId = () => `req-${(next += 1)}`;

    const result = buildTransferRequests(recipe, ingredients, 6, new Set(['ing-1']), [], LIST, {
      requestId,
    });

    expect(result.previews).toHaveLength(2);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.request_id).toBe('req-1');
    expect(result.requests[0]?.quantity).toBe(750);
    expect(result.requests[0]?.unit).toBe('g');
    expect(result.requests[0]?.list_id).toBe(LIST);
    expect(result.requests[0]?.source_recipe_id).toBe('recipe-1');
    expect(result.requests[0]?.name).toBe('Spaghetti');
  });

  it('überspringt ausgewählte Zutaten ohne Menge', () => {
    const recipe = makeRecipe(4);
    const ingredients = [makeIngredient('ing-1', 'Salz', null, 'Prise', 1)];
    const result = buildTransferRequests(recipe, ingredients, 4, new Set(['ing-1']), [], LIST, {
      requestId: () => 'req-x',
    });
    expect(result.requests).toHaveLength(0);
  });

  it('erzeugt bei jedem Aufruf neue request_ids (zweite Übertragung addiert)', () => {
    const recipe = makeRecipe(4);
    const ingredients = [makeIngredient('ing-1', 'Spaghetti', 500, 'g', 1)];
    let next = 0;
    const requestId = () => `req-${(next += 1)}`;
    const first = buildTransferRequests(recipe, ingredients, 4, new Set(['ing-1']), [], LIST, {
      requestId,
    });
    const second = buildTransferRequests(recipe, ingredients, 4, new Set(['ing-1']), [], LIST, {
      requestId,
    });
    expect(first.requests[0]?.request_id).toBe('req-1');
    expect(second.requests[0]?.request_id).toBe('req-2');
  });
});

describe('applyTransferRequests', () => {
  it('wendet im Mock-Modus Core-addToList lokal an (Aggregation, source_recipe_id)', async () => {
    const existing = makeListItem('item-1', 'Spaghetti', 500, 'g');
    await db.list_items.put(listItemToRow(existing));

    const recipe = makeRecipe(4);
    const ingredients = [makeIngredient('ing-1', 'Spaghetti', 500, 'g', 1)];
    const { requests } = buildTransferRequests(
      recipe,
      ingredients,
      6,
      new Set(['ing-1']),
      [existing],
      LIST,
      { requestId: () => 'req-mock-1' },
    );

    const count = await applyTransferRequests(db, requests, {
      mode: 'mock',
      now: T2,
      existingItems: [existing],
    });

    expect(count).toBe(1);
    const row = await db.list_items.get('item-1');
    expect(row?.quantity).toBe(1250);
    expect(row?.source_recipe_id).toBe('recipe-1');
    expect(await db.list_items.count()).toBe(1);
  });

  it('addiert bei zweimaliger Übertragung die Menge, statt zu duplizieren', async () => {
    const recipe = makeRecipe(4);
    const ingredients = [makeIngredient('ing-1', 'Spaghetti', 500, 'g', 1)];

    const first = buildTransferRequests(recipe, ingredients, 4, new Set(['ing-1']), [], LIST, {
      requestId: () => 'req-a',
    });
    await applyTransferRequests(db, first.requests, {
      mode: 'mock',
      now: T1,
      existingItems: [],
    });

    const firstRow = await db.list_items.get(
      await db.list_items
        .orderBy('id')
        .first()
        .then((r) => r?.id ?? ''),
    );
    expect(firstRow).toBeDefined();
    const firstItem = rowToListItem(firstRow as NonNullable<typeof firstRow>);
    expect(firstItem.fields.quantity).toBe(500);
    expect(firstItem.fields.source_recipe_id).toBe('recipe-1');

    const second = buildTransferRequests(
      recipe,
      ingredients,
      4,
      new Set(['ing-1']),
      [firstItem],
      LIST,
      { requestId: () => 'req-b' },
    );
    await applyTransferRequests(db, second.requests, {
      mode: 'mock',
      now: T2,
      existingItems: [firstItem],
    });

    expect(await db.list_items.count()).toBe(1);
    const updated = await db.list_items.get(firstItem.id);
    expect(updated?.quantity).toBe(1000);
  });

  it('legt im Supabase-Modus Outbox-Einträge an, ohne lokal zu schreiben', async () => {
    const recipe = makeRecipe(4);
    const ingredients = [
      makeIngredient('ing-1', 'Spaghetti', 500, 'g', 1),
      makeIngredient('ing-2', 'Tomaten', 2, 'Dose', 2),
    ];
    const { requests } = buildTransferRequests(
      recipe,
      ingredients,
      4,
      new Set(['ing-1', 'ing-2']),
      [],
      LIST,
      {
        requestId: (() => {
          let n = 0;
          return () => `req-outbox-${(n += 1)}`;
        })(),
      },
    );

    const count = await applyTransferRequests(db, requests, {
      mode: 'supabase',
      now: T2,
      existingItems: [],
    });

    expect(count).toBe(2);
    expect(await db.list_items.count()).toBe(0);
    const outbox = await readOutbox(db);
    expect(outbox.entries).toHaveLength(2);
    const ops = outbox.entries.map((entry) => entry.op);
    expect(ops).toEqual(['add_to_list', 'add_to_list']);
    const payloads = outbox.entries.map((entry) =>
      entry.op === 'add_to_list' ? entry.payload.request_id : null,
    );
    expect(payloads).toEqual(['req-outbox-1', 'req-outbox-2']);
  });
});
