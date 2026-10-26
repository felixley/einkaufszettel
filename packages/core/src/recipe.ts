import type { RecipeFields, RecipeIngredientFields, Unit, VersionedRow } from './types.js';
import { roundQuantity, unitBaseFactor, unitDimension } from './units.js';

/**
 * Rezept-Domäne (PLAN.md §4.3, T3.2/T3.3).
 *
 * Die Zeilenform entspricht der Sync-Schicht (`VersionedRow`); Rezepte und
 * Zutaten werden damit wie `list_items` über die Outbox synchronisiert, ohne
 * die Sync-Logik zu duplizieren.
 */
export type Recipe = VersionedRow<RecipeFields>;
export type RecipeIngredient = VersionedRow<RecipeIngredientFields>;

/** Rezept samt Zutaten — die Einheit, auf die der Portionsrechner wirkt. */
export interface RecipeWithIngredients {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
}

/** Zutat in der für Parser/Formatter/Skalierung gemeinsamen Form. */
export interface ScalableIngredient {
  name: string;
  quantity: number | null;
  unit: Unit | null;
}

/** Ergebnis einer skalierten Zutat (Menge gerundet, Rest unverändert). */
export type ScaledIngredient = ScalableIngredient;

/**
 * Skaliert eine Menge auf den Faktor.
 *
 * Masse/Volumen werden auf ganze g/ml gerundet (danach zurück in die
 * Ausgangseinheit), Stück- und unbestimmte Einheiten auf 0,5 Schritte
 * (PLAN.md §4.3/T3.3). `null`-Mengen bleiben `null`.
 */
export function scaleQuantity(
  quantity: number | null,
  unit: Unit | null,
  factor: number,
): number | null {
  if (quantity === null) return null;
  const dimension = unitDimension(unit);
  if (dimension === 'mass' || dimension === 'volume') {
    const baseFactor = unitBaseFactor(unit);
    const base = quantity * factor * baseFactor;
    return roundQuantity(Math.round(base) / baseFactor);
  }
  return Math.round(quantity * factor * 2) / 2;
}

/** Skalierungsfaktor `target / base`; validiert beide Portionsangaben. */
export function recipeScaleFactor(baseServings: number, targetServings: number): number {
  if (!Number.isFinite(baseServings) || baseServings <= 0) {
    throw new RangeError('baseServings muss eine endliche Zahl größer 0 sein');
  }
  if (!Number.isFinite(targetServings) || targetServings <= 0) {
    throw new RangeError('targetServings muss eine endliche Zahl größer 0 sein');
  }
  return targetServings / baseServings;
}

/**
 * Rechnet eine Zutatenliste auf die Zielportionen um (T3.3).
 *
 * @returns neue Liste; die Eingabe bleibt unverändert (reine Funktion).
 */
export function scaleRecipe(
  ingredients: readonly ScalableIngredient[],
  baseServings: number,
  targetServings: number,
): ScaledIngredient[] {
  const factor = recipeScaleFactor(baseServings, targetServings);
  return ingredients.map((ingredient) => ({
    name: ingredient.name,
    unit: ingredient.unit,
    quantity: scaleQuantity(ingredient.quantity, ingredient.unit, factor),
  }));
}
