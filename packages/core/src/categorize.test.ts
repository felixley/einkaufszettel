import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CATEGORY_KEYS,
  CATEGORY_LABELS,
  DEFAULT_CATEGORY,
  isCategoryKey,
  type CategoryKey,
  type CategoryRule,
} from './categories.js';
import {
  autoCategorize,
  categorize,
  createRuleFromManualChange,
  learnFromManualChange,
  normalizeArticleName,
} from './categorize.js';

const SEED_URL = new URL('../../../supabase/seed.sql', import.meta.url);
const PAIR_PATTERN = /::uuid,\s*'([^']+)'::text,\s*'([a-z_]+)'::text/g;

/** Lädt die echten Seed-Regeln (T1.5) aus supabase/seed.sql. */
function loadSeedRules(): CategoryRule[] {
  const sql = readFileSync(SEED_URL, 'utf8');
  const rules: CategoryRule[] = [];
  for (const match of sql.matchAll(PAIR_PATTERN)) {
    const keyword = match[1];
    const category = match[2];
    if (keyword === undefined || category === undefined) continue;
    if (!isCategoryKey(category)) {
      throw new Error(`Unbekannte Kategorie im Seed: ${category}`);
    }
    rules.push({ keyword, categoryKey: category, householdId: null });
  }
  return rules;
}

const SEED_RULES = loadSeedRules();

interface ArticleCase {
  name: string;
  expected: CategoryKey;
}

/**
 * Seed-Testset (PLAN.md A-7): ≥50 deutsche Artikel, über alle 13 Kategorien.
 * Die drei letzten Einträge sind bewusste Lücken der Seed-Taxonomie
 * (Zubereitungsformen wie Salat/Sauce sind dort nicht als eigene Keywords
 * gepflegt) und werden als Trefferquote-Fehler mitgeloggt.
 */
const ARTICLES: readonly ArticleCase[] = [
  { name: 'Bio-Äpfel', expected: 'obst_gemuese' },
  { name: 'Bananen', expected: 'obst_gemuese' },
  { name: 'Tomaten', expected: 'obst_gemuese' },
  { name: 'Gurke', expected: 'obst_gemuese' },
  { name: 'Kartoffeln', expected: 'obst_gemuese' },
  { name: 'Zwiebeln', expected: 'obst_gemuese' },
  { name: 'Karotten', expected: 'obst_gemuese' },
  { name: 'Brokkoli', expected: 'obst_gemuese' },
  { name: 'Spinat', expected: 'obst_gemuese' },
  { name: 'Rucola', expected: 'obst_gemuese' },
  { name: 'Champignons', expected: 'obst_gemuese' },
  { name: 'Zucchini', expected: 'obst_gemuese' },
  { name: 'Paprika', expected: 'obst_gemuese' },
  { name: 'Kopfsalat', expected: 'obst_gemuese' },
  { name: 'Obstsalat', expected: 'obst_gemuese' },
  { name: 'Kartoffelsalat', expected: 'obst_gemuese' },
  { name: 'Vollkornbrot', expected: 'brot_backwaren' },
  { name: 'Brötchen', expected: 'brot_backwaren' },
  { name: 'Baguette', expected: 'brot_backwaren' },
  { name: 'Toastbrot', expected: 'brot_backwaren' },
  { name: 'Croissant', expected: 'brot_backwaren' },
  { name: 'Brezel', expected: 'brot_backwaren' },
  { name: 'Kuchen', expected: 'brot_backwaren' },
  { name: 'Mehl', expected: 'brot_backwaren' },
  { name: 'Hefe', expected: 'brot_backwaren' },
  { name: 'Apfelkuchen', expected: 'brot_backwaren' },
  { name: 'Käsebrot', expected: 'brot_backwaren' },
  { name: 'Vollkorn-Toast', expected: 'brot_backwaren' },
  { name: 'Vollmilch', expected: 'milch_eier' },
  { name: 'Sahne', expected: 'milch_eier' },
  { name: 'Butter', expected: 'milch_eier' },
  { name: 'Joghurt', expected: 'milch_eier' },
  { name: 'Quark', expected: 'milch_eier' },
  { name: 'Gouda', expected: 'milch_eier' },
  { name: 'Mozzarella', expected: 'milch_eier' },
  { name: 'Eier', expected: 'milch_eier' },
  { name: 'Buttermilch', expected: 'milch_eier' },
  { name: 'Kräuterfrischkäse', expected: 'milch_eier' },
  { name: 'Schinken', expected: 'kuehlware' },
  { name: 'Salami', expected: 'kuehlware' },
  { name: 'Leberwurst', expected: 'kuehlware' },
  { name: 'Lachs', expected: 'kuehlware' },
  { name: 'Thunfisch', expected: 'kuehlware' },
  { name: 'Tofu', expected: 'kuehlware' },
  { name: 'Bratwurst', expected: 'kuehlware' },
  { name: 'Hähnchenbrust', expected: 'fleisch_fisch' },
  { name: 'Rinderhackfleisch', expected: 'fleisch_fisch' },
  { name: 'Schweinefilet', expected: 'fleisch_fisch' },
  { name: 'Hackfleisch', expected: 'fleisch_fisch' },
  { name: 'Hähnchenbrustfilet', expected: 'fleisch_fisch' },
  { name: 'Pizza', expected: 'tiefkuehl' },
  { name: 'Pommes', expected: 'tiefkuehl' },
  { name: 'Fischstäbchen', expected: 'tiefkuehl' },
  { name: 'Speiseeis', expected: 'tiefkuehl' },
  { name: 'Reis', expected: 'trockenwaren_konserven' },
  { name: 'Nudeln', expected: 'trockenwaren_konserven' },
  { name: 'Spaghetti', expected: 'trockenwaren_konserven' },
  { name: 'Haferflocken', expected: 'trockenwaren_konserven' },
  { name: 'Müsli', expected: 'trockenwaren_konserven' },
  { name: 'Kichererbsen', expected: 'trockenwaren_konserven' },
  { name: 'Passierte Tomaten', expected: 'trockenwaren_konserven' },
  { name: 'Olivenöl', expected: 'trockenwaren_konserven' },
  { name: 'Kokosmilch', expected: 'trockenwaren_konserven' },
  { name: 'Gemüsebrühe', expected: 'trockenwaren_konserven' },
  { name: 'Tomatensuppe', expected: 'trockenwaren_konserven' },
  { name: 'Salz', expected: 'gewuerze_oele' },
  { name: 'Pfeffer', expected: 'gewuerze_oele' },
  { name: 'Currypulver', expected: 'gewuerze_oele' },
  { name: 'Zimt', expected: 'gewuerze_oele' },
  { name: 'Chilipulver', expected: 'gewuerze_oele' },
  { name: 'Meersalz', expected: 'gewuerze_oele' },
  { name: 'Mineralwasser', expected: 'getraenke' },
  { name: 'Apfelsaft', expected: 'getraenke' },
  { name: 'Orangensaft', expected: 'getraenke' },
  { name: 'Cola', expected: 'getraenke' },
  { name: 'Bier', expected: 'getraenke' },
  { name: 'Kaffee', expected: 'getraenke' },
  { name: 'Zitronentee', expected: 'getraenke' },
  { name: 'Pfefferminztee', expected: 'getraenke' },
  { name: 'Apfelsaft naturtrüb', expected: 'getraenke' },
  { name: 'Chips', expected: 'snacks_suesses' },
  { name: 'Salzstangen', expected: 'snacks_suesses' },
  { name: 'Popcorn', expected: 'snacks_suesses' },
  { name: 'Erdnüsse', expected: 'snacks_suesses' },
  { name: 'Schokoriegel', expected: 'snacks_suesses' },
  { name: 'Gummibärchen', expected: 'snacks_suesses' },
  { name: 'Zahnpasta', expected: 'drogerie' },
  { name: 'Duschgel', expected: 'drogerie' },
  { name: 'Shampoo', expected: 'drogerie' },
  { name: 'Deodorant', expected: 'drogerie' },
  { name: 'Waschmittel', expected: 'drogerie' },
  { name: 'Toilettenpapier', expected: 'haushalt' },
  { name: 'Küchenrolle', expected: 'haushalt' },
  { name: 'Müllbeutel', expected: 'haushalt' },
  { name: 'Backpapier', expected: 'haushalt' },
  { name: 'Alufolie', expected: 'haushalt' },
  { name: 'Batterien', expected: 'haushalt' },
  { name: 'Katzenfutter', expected: 'sonstiges' },
  { name: 'Hundefutter', expected: 'sonstiges' },
  { name: 'Blumen', expected: 'sonstiges' },
  { name: 'Sonnencreme', expected: 'sonstiges' },
  // Bewusste Seed-Lücken (Zubereitungsform ohne eigenes Keyword):
  { name: 'Tomatensauce', expected: 'trockenwaren_konserven' },
  { name: 'Fleischsalat', expected: 'kuehlware' },
  { name: 'Nudelsalat', expected: 'trockenwaren_konserven' },
];

describe('Seed-Regeln laden', () => {
  it('liest die vollständigen Keyword-Regeln aus supabase/seed.sql', () => {
    expect(SEED_RULES.length).toBeGreaterThanOrEqual(380);
    const categories = new Set(SEED_RULES.map((rule) => rule.categoryKey));
    expect(categories.size).toBe(CATEGORY_KEYS.length);
  });
});

describe('Auto-Kategorisierung (T2.7 / A-7)', () => {
  it('erreicht ≥85 % Trefferquote auf dem Seed-Testset (≥50 Artikel)', () => {
    expect(ARTICLES.length).toBeGreaterThanOrEqual(50);

    const misses: string[] = [];
    for (const article of ARTICLES) {
      const result = categorize(article.name, SEED_RULES);
      if (result.categoryKey !== article.expected) {
        misses.push(`${article.name}: erwartet ${article.expected}, war ${result.categoryKey}`);
      }
    }

    const hits = ARTICLES.length - misses.length;
    const rate = hits / ARTICLES.length;
    // Trefferquote sichtbar im CI-Log (AK A-7).
    console.log(
      `Kategorisierung Trefferquote: ${hits}/${ARTICLES.length} = ${(rate * 100).toFixed(1)} %`,
    );
    if (misses.length > 0) console.log(`Fehltreffer:\n  ${misses.join('\n  ')}`);

    expect(rate).toBeGreaterThanOrEqual(0.85);
  });

  it('bevorzugt exakten Namen vor Token-/Teilstring-Treffern', () => {
    expect(autoCategorize('Salz', SEED_RULES)?.matchedKeyword).toBe('salz');
    expect(autoCategorize('Vollkornbrot', SEED_RULES)?.matchedKeyword).toBe('vollkornbrot');
  });

  it('bevorzugt das Grundwort am Wortende (Suffix) vor dem Präfix', () => {
    const tea = autoCategorize('Zitronentee', SEED_RULES);
    expect(tea?.matchedKeyword).toBe('tee');
    expect(tea?.categoryKey).toBe('getraenke');

    const bread = autoCategorize('Käsebrot', SEED_RULES);
    expect(bread?.matchedKeyword).toBe('brot');
    expect(bread?.categoryKey).toBe('brot_backwaren');
  });

  it('wählt bei mehreren Suffixen das längere Keyword', () => {
    const result = autoCategorize('Rinderhackfleisch', SEED_RULES);
    expect(result?.matchedKeyword).toBe('hackfleisch');
    expect(result?.categoryKey).toBe('fleisch_fisch');
  });

  it('trifft Komposita über das Präfix', () => {
    const result = autoCategorize('Hähnchenbrust', SEED_RULES);
    expect(result?.matchedKeyword).toBe('hähnchen');
    expect(result?.categoryKey).toBe('fleisch_fisch');
  });

  it('wertet alle Tokens aus und nimmt das stärkste Keyword', () => {
    const result = autoCategorize('Passierte Tomaten', SEED_RULES);
    expect(result?.matchedKeyword).toBe('passierte');
    expect(result?.categoryKey).toBe('trockenwaren_konserven');
  });

  it('ist deterministisch und unabhängig von der Regelreihenfolge', () => {
    const reversed = [...SEED_RULES].reverse();
    for (const article of ['Käsebrot', 'Zitronentee', 'Rinderhackfleisch', 'Bio-Äpfel']) {
      expect(autoCategorize(article, SEED_RULES)).toEqual(autoCategorize(article, reversed));
    }
  });

  it('liefert null und Fallback `sonstiges` bei unbekannten Artikeln', () => {
    expect(autoCategorize('Zauberpulver', SEED_RULES)).toBeNull();
    const result = categorize('Zauberpulver', SEED_RULES);
    expect(result.fallbackUsed).toBe(true);
    expect(result.categoryKey).toBe(DEFAULT_CATEGORY);
    expect(result.match).toBeNull();
  });

  it('liefert bei leerem Namen null bzw. den Fallback', () => {
    expect(normalizeArticleName('   ')).toBe('');
    expect(autoCategorize('   ', SEED_RULES)).toBeNull();
    expect(categorize('', SEED_RULES).categoryKey).toBe(DEFAULT_CATEGORY);
  });

  it('zieht eine Haushaltsregel bei Gleichstand der globalen Regel vor', () => {
    const global: CategoryRule = { keyword: 'milch', categoryKey: 'milch_eier', householdId: null };
    const local: CategoryRule = {
      keyword: 'milch',
      categoryKey: 'drogerie',
      householdId: 'haus-1',
    };
    expect(autoCategorize('Milch', [global, local])?.categoryKey).toBe('drogerie');
    expect(autoCategorize('Milch', [local, global])?.categoryKey).toBe('drogerie');
  });

  it('liefert für alle Kategorien ein Label', () => {
    for (const key of CATEGORY_KEYS) {
      expect(CATEGORY_LABELS[key]).toBeTruthy();
    }
  });
});

describe('Lernen aus manueller Korrektur (T2.7)', () => {
  it('erzeugt aus einer Korrektur eine Haushaltsregel (reine Funktion)', () => {
    const rule = createRuleFromManualChange({
      articleName: 'Bio-Äpfel',
      categoryKey: 'snacks_suesses',
      householdId: 'haus-1',
    });
    expect(rule).toEqual({
      keyword: 'bio äpfel',
      categoryKey: 'snacks_suesses',
      householdId: 'haus-1',
    });
  });

  it('wirft bei leerem Artikelnamen oder leerer Haushalts-ID', () => {
    expect(() =>
      createRuleFromManualChange({ articleName: '  ', categoryKey: 'sonstiges', householdId: 'h' }),
    ).toThrow(TypeError);
    expect(() =>
      createRuleFromManualChange({
        articleName: 'Apfel',
        categoryKey: 'sonstiges',
        householdId: ' ',
      }),
    ).toThrow(TypeError);
  });

  it('greift beim nächsten gleichen Artikel und verändert die Eingabe nicht', () => {
    const before = [...SEED_RULES];
    const learned = learnFromManualChange(SEED_RULES, {
      articleName: 'Bio-Äpfel',
      categoryKey: 'snacks_suesses',
      householdId: 'haus-1',
    });

    expect(learned).not.toBe(SEED_RULES);
    expect(learned.length).toBe(SEED_RULES.length + 1);
    expect(SEED_RULES).toEqual(before);
    expect(categorize('Bio-Äpfel', learned).categoryKey).toBe('snacks_suesses');
    // Gleicher Artikel bleibt für andere Haushalte global kategorisiert.
    expect(categorize('Bio-Äpfel', SEED_RULES).categoryKey).toBe('obst_gemuese');
  });

  it('ersetzt eine bestehende Haushaltsregel mit gleichem Keyword statt zu duplizieren', () => {
    const first = learnFromManualChange(SEED_RULES, {
      articleName: 'Milch',
      categoryKey: 'drogerie',
      householdId: 'haus-1',
    });
    const second = learnFromManualChange(first, {
      articleName: 'Milch',
      categoryKey: 'milch_eier',
      householdId: 'haus-1',
    });

    expect(second.length).toBe(first.length);
    expect(categorize('Milch', second).categoryKey).toBe('milch_eier');
    // Globale Regel bleibt zusätzlich vorhanden.
    expect(categorize('Milch', SEED_RULES).categoryKey).toBe('milch_eier');
  });
});
