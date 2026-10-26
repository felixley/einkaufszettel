import type { Unit } from '@einkaufszettel/core';
import { z } from 'zod';

/**
 * Erlaubte Einheiten (PLAN.md §4.3). Bewusst lokal gespiegelt, weil das
 * Core-Paket derzeit keinen Laufzeit-Export der Einheitenliste hat; der
 * Compiler erzwingt die Übereinstimmung über den `Unit`-Typ.
 */
export const UNIT_VALUES = [
  'g',
  'kg',
  'ml',
  'l',
  'TL',
  'EL',
  'Stk',
  'Bund',
  'Dose',
  'Packung',
  'Zehe',
  'Prise',
  'n. B.',
] as const satisfies readonly Unit[];

export const unitSchema = z.enum(UNIT_VALUES);

const titleSchema = z
  .string()
  .max(200, 'Titel ist zu lang (max. 200 Zeichen)')
  .refine((value) => value.trim().length > 0, 'Titel darf nicht leer sein');

const ingredientNameSchema = z
  .string()
  .max(120, 'Zutatname ist zu lang (max. 120 Zeichen)')
  .refine((value) => value.trim().length > 0, 'Zutat braucht einen Namen');

export const recipeInputSchema = z.object({
  title: titleSchema,
  base_servings: z
    .number()
    .positive('Portionen müssen größer als 0 sein')
    .max(999, 'Maximal 999 Portionen')
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  tags: z
    .array(
      z
        .string()
        .max(40, 'Tag ist zu lang (max. 40 Zeichen)')
        .refine((value) => value.trim().length > 0, 'Tag darf nicht leer sein'),
    )
    .max(20, 'Maximal 20 Tags')
    .optional()
    .transform((value) => value ?? []),
  instructions: z
    .string()
    .max(20000, 'Zubereitung ist zu lang')
    .nullable()
    .optional()
    .transform((value) => {
      if (value === null || value === undefined) return null;
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }),
});

export const ingredientDraftSchema = z.object({
  id: z.string().min(1).optional(),
  name: ingredientNameSchema,
  quantity: z
    .number()
    .positive('Menge muss größer als 0 sein')
    .max(100000, 'Menge ist zu groß')
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  unit: unitSchema
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

export type ValidatedRecipeInput = z.infer<typeof recipeInputSchema>;
export type ValidatedIngredientDraft = z.infer<typeof ingredientDraftSchema>;

export class RecipeValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(' '));
    this.name = 'RecipeValidationError';
    this.issues = issues;
  }
}

function messagesFrom(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
}

export function parseRecipeInput(input: unknown): ValidatedRecipeInput {
  const result = recipeInputSchema.safeParse(input);
  if (!result.success) throw new RecipeValidationError(messagesFrom(result.error));
  return result.data;
}

export function parseIngredientDrafts(input: unknown): ValidatedIngredientDraft[] {
  const result = z.array(ingredientDraftSchema).safeParse(input);
  if (!result.success) throw new RecipeValidationError(messagesFrom(result.error));
  return result.data;
}
