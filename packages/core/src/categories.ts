/**
 * Kategorien und Regel-Typen (PLAN.md §4.4).
 *
 * Bewusst in einem eigenen Modul, damit die Typen der Sync-Schicht
 * (`types.ts`) unverändert bleiben und keine Kollision entsteht.
 */
export const CATEGORY_KEYS = [
  'obst_gemuese',
  'brot_backwaren',
  'milch_eier',
  'kuehlware',
  'fleisch_fisch',
  'tiefkuehl',
  'trockenwaren_konserven',
  'gewuerze_oele',
  'getraenke',
  'snacks_suesses',
  'drogerie',
  'haushalt',
  'sonstiges',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_LABELS: Readonly<Record<CategoryKey, string>> = {
  obst_gemuese: 'Obst & Gemüse',
  brot_backwaren: 'Brot & Backwaren',
  milch_eier: 'Milch & Eier',
  kuehlware: 'Kühlware',
  fleisch_fisch: 'Fleisch & Fisch',
  tiefkuehl: 'Tiefkühl',
  trockenwaren_konserven: 'Trockenwaren & Konserven',
  gewuerze_oele: 'Gewürze & Öle',
  getraenke: 'Getränke',
  snacks_suesses: 'Snacks & Süßes',
  drogerie: 'Drogerie',
  haushalt: 'Haushalt',
  sonstiges: 'Sonstiges',
};

export const DEFAULT_CATEGORY: CategoryKey = 'sonstiges';

/**
 * Entspricht einer Zeile aus `public.category_rules`.
 * `householdId === null` ist eine globale Regel, sonst eine Haushaltsregel.
 */
export interface CategoryRule {
  keyword: string;
  categoryKey: CategoryKey;
  householdId: string | null;
}

export interface CategoryMatch {
  categoryKey: CategoryKey;
  rule: CategoryRule;
  matchedKeyword: string;
  score: number;
}

export interface CategoryResult {
  categoryKey: CategoryKey;
  match: CategoryMatch | null;
  fallbackUsed: boolean;
}

export function isCategoryKey(value: string): value is CategoryKey {
  return (CATEGORY_KEYS as readonly string[]).includes(value);
}
