import {
  formatIngredient,
  parseIngredientLine as parseCoreIngredientLine,
  scaleRecipe,
  type Unit,
} from '@einkaufszettel/core';

/**
 * Dünne UI-Adapter um die Core-Einheitenlogik (T3.1/T3.3).
 *
 * Die eigentliche Arbeit — Parser, Formatter, Rundung, Portionsskalierung —
 * liegt in `packages/core` (`units.ts`, `recipe.ts`). Hier werden nur die
 * Signaturen an die Formular-Bedürfnisse angepasst, damit die Regeln nicht
 * doppelt gepflegt werden.
 */

export interface ParsedIngredientLine {
  quantity: number | null;
  unit: Unit | null;
  name: string;
}

/** Zerlegt eine freie Zutatenzeile; `name` ist immer ein String. */
export function parseIngredientLine(line: string): ParsedIngredientLine {
  const parsed = parseCoreIngredientLine(line);
  return {
    quantity: parsed.quantity,
    unit: parsed.unit,
    name: parsed.name ?? '',
  };
}

/** Formatiert eine Menge in de-DE-Schreibweise („1,5 kg“, „250 ml“, „2 Stk“). */
export function formatQuantity(quantity: number | null, unit: Unit | null): string {
  return formatIngredient({ name: '', quantity, unit }).trim();
}

/** Formatiert eine komplette Zutatenzeile für Formularfelder. */
export function formatIngredientLine(
  quantity: number | null,
  unit: Unit | null,
  name: string,
): string {
  return formatIngredient({ name: name.trim(), quantity, unit }).trim();
}

export interface ScalableIngredient {
  quantity: number | null;
  unit: Unit | null;
}

/** Skaliert eine einzelne Menge auf einen Faktor (Core-Rundungsregeln). */
export function scaleQuantity(
  quantity: number | null,
  unit: Unit | null,
  factor: number,
): number | null {
  if (quantity === null || !Number.isFinite(quantity)) return null;
  if (!Number.isFinite(factor) || factor <= 0) return quantity;
  const [scaled] = scaleRecipe([{ name: '', quantity, unit }], 1, factor);
  return scaled?.quantity ?? null;
}

/** Skaliert alle Zutaten eines Rezepts auf die Zielportionen. */
export function scaleRecipeIngredients<T extends ScalableIngredient>(
  ingredients: readonly T[],
  baseServings: number | null,
  targetServings: number,
): T[] {
  if (baseServings === null || baseServings <= 0 || targetServings <= 0) {
    return ingredients.map((ingredient) => ({ ...ingredient }));
  }
  const scaled = scaleRecipe(
    ingredients.map((ingredient) => ({
      name: '',
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    })),
    baseServings,
    targetServings,
  );
  return ingredients.map((ingredient, index) => ({
    ...ingredient,
    quantity: scaled[index]?.quantity ?? ingredient.quantity,
  }));
}
