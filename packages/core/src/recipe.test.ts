import { describe, expect, it } from 'vitest';

import {
  recipeScaleFactor,
  scaleQuantity,
  scaleRecipe,
  type Recipe,
  type RecipeIngredient,
  type RecipeWithIngredients,
} from './recipe.js';

describe('scaleQuantity', () => {
  it('skaliert Masse auf ganze Gramm', () => {
    expect(scaleQuantity(200, 'g', 1.5)).toBe(300);
    expect(scaleQuantity(1, 'kg', 1.5)).toBe(1.5);
    expect(scaleQuantity(1, 'kg', 1 / 3)).toBe(0.333);
  });

  it('skaliert Volumen auf ganze Milliliter', () => {
    expect(scaleQuantity(250, 'ml', 1.5)).toBe(375);
    expect(scaleQuantity(1, 'l', 1.5)).toBe(1.5);
    expect(scaleQuantity(250, 'ml', 1 / 3)).toBe(83);
    expect(scaleQuantity(2, 'EL', 1.5)).toBe(3);
  });

  it('rundet Stück- und unbestimmte Einheiten auf 0,5 Schritte', () => {
    expect(scaleQuantity(1, 'Stk', 1.5)).toBe(1.5);
    expect(scaleQuantity(2, 'Stk', 1.5)).toBe(3);
    expect(scaleQuantity(1, 'Stk', 1.25)).toBe(1.5);
    expect(scaleQuantity(3, 'Prise', 0.5)).toBe(1.5);
  });

  it('lässt null-Mengen null', () => {
    expect(scaleQuantity(null, 'n. B.', 1.5)).toBeNull();
    expect(scaleQuantity(null, null, 2)).toBeNull();
  });
});

describe('recipeScaleFactor', () => {
  it('berechnet target/base', () => {
    expect(recipeScaleFactor(4, 6)).toBe(1.5);
    expect(recipeScaleFactor(2, 1)).toBe(0.5);
  });

  it('wirft bei ungültigen Portionsangaben', () => {
    expect(() => recipeScaleFactor(0, 4)).toThrow(RangeError);
    expect(() => recipeScaleFactor(4, 0)).toThrow(RangeError);
    expect(() => recipeScaleFactor(-1, 4)).toThrow(RangeError);
    expect(() => recipeScaleFactor(Number.NaN, 4)).toThrow(RangeError);
    expect(() => recipeScaleFactor(4, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('scaleRecipe', () => {
  it('skaliert ein 4-Portionen-Rezept auf 6 Portionen korrekt', () => {
    const ingredients = [
      { name: 'Mehl', quantity: 200, unit: 'g' as const },
      { name: 'Eier', quantity: 2, unit: 'Stk' as const },
      { name: 'Milch', quantity: 1, unit: 'l' as const },
      { name: 'Salz', quantity: null, unit: 'n. B.' as const },
    ];

    expect(scaleRecipe(ingredients, 4, 6)).toEqual([
      { name: 'Mehl', quantity: 300, unit: 'g' },
      { name: 'Eier', quantity: 3, unit: 'Stk' },
      { name: 'Milch', quantity: 1.5, unit: 'l' },
      { name: 'Salz', quantity: null, unit: 'n. B.' },
    ]);
  });

  it('verändert die Eingabe nicht (reine Funktion)', () => {
    const ingredients = [{ name: 'Mehl', quantity: 200, unit: 'g' as const }];
    scaleRecipe(ingredients, 4, 6);
    expect(ingredients[0]?.quantity).toBe(200);
  });

  it('validiert die Portionsangaben', () => {
    expect(() => scaleRecipe([], 4, 0)).toThrow(RangeError);
    expect(() => scaleRecipe([], 0, 4)).toThrow(RangeError);
  });
});

describe('Recipe-Entität', () => {
  it('bildet ein Rezept samt Zutaten als sync-fähige Zeilen ab', () => {
    const recipe: Recipe = {
      id: 'recipe-1',
      updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
      field_updated_at: {},
      fields: {
        household_id: 'household-1',
        title: 'Pfannkuchen',
        base_servings: 4,
        tags: ['frühstück'],
        instructions: 'Alles verrühren.',
      },
    };
    const ingredient: RecipeIngredient = {
      id: 'ingredient-1',
      updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
      field_updated_at: {},
      fields: {
        recipe_id: 'recipe-1',
        name: 'Mehl',
        quantity: 200,
        unit: 'g',
        sort_order: 0,
      },
    };
    const withIngredients: RecipeWithIngredients = { recipe, ingredients: [ingredient] };

    expect(withIngredients.recipe.fields.title).toBe('Pfannkuchen');
    expect(withIngredients.ingredients[0]?.fields.unit).toBe('g');
  });
});
