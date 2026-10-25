import {
  DEFAULT_CATEGORY,
  type CategoryKey,
  type CategoryMatch,
  type CategoryResult,
  type CategoryRule,
} from './categories.js';

/**
 * Normalisiert einen Artikelnamen für das Keyword-Matching.
 *
 * Der Seed enthält Singular- und Plural-Keywords bereits getrennt, daher ist
 * hier keine Plural-/Synonym-Abbildung nötig (die gehört zu T3.1, `name.ts`).
 * Bewusst ohne Stemming, damit Regeln explizit und nachvollziehbar bleiben.
 */
export function normalizeArticleName(name: string): string {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

type MatchKind = 'exact' | 'token' | 'suffix' | 'prefix' | 'contains';

const KIND_BASE: Readonly<Record<MatchKind, number>> = {
  exact: 10_000,
  token: 5_000,
  suffix: 3_000,
  prefix: 2_000,
  contains: 1_000,
};

const KIND_RANK: Readonly<Record<MatchKind, number>> = {
  exact: 5,
  token: 4,
  suffix: 3,
  prefix: 2,
  contains: 1,
};

interface Candidate {
  rule: CategoryRule;
  normalizedKeyword: string;
  kind: MatchKind;
  score: number;
  keywordLength: number;
  tokenIndex: number;
}

function candidateFor(
  rule: CategoryRule,
  normalizedKeyword: string,
  kind: MatchKind,
  tokenIndex: number,
): Candidate {
  return {
    rule,
    normalizedKeyword,
    kind,
    score: KIND_BASE[kind] + normalizedKeyword.length,
    keywordLength: normalizedKeyword.length,
    tokenIndex,
  };
}

function byScoreThenDeterministic(a: Candidate, b: Candidate): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.keywordLength !== b.keywordLength) return b.keywordLength - a.keywordLength;
  if (a.kind !== b.kind) return KIND_RANK[b.kind] - KIND_RANK[a.kind];
  if (a.tokenIndex !== b.tokenIndex) return a.tokenIndex - b.tokenIndex;
  const aLocal = a.rule.householdId !== null;
  const bLocal = b.rule.householdId !== null;
  if (aLocal !== bLocal) return aLocal ? -1 : 1;
  if (a.normalizedKeyword !== b.normalizedKeyword) {
    return a.normalizedKeyword < b.normalizedKeyword ? -1 : 1;
  }
  return a.rule.keyword < b.rule.keyword ? -1 : a.rule.keyword > b.rule.keyword ? 1 : 0;
}

function bestCandidateFor(
  normalizedName: string,
  tokens: readonly string[],
  rule: CategoryRule,
): Candidate | null {
  const normalizedKeyword = normalizeArticleName(rule.keyword);
  if (normalizedKeyword.length === 0) return null;

  if (normalizedName === normalizedKeyword) {
    return candidateFor(rule, normalizedKeyword, 'exact', -1);
  }

  let best: Candidate | null = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token.length === 0) continue;

    let candidate: Candidate | null = null;
    if (token === normalizedKeyword) {
      candidate = candidateFor(rule, normalizedKeyword, 'token', index);
    } else if (token.length > normalizedKeyword.length && token.endsWith(normalizedKeyword)) {
      candidate = candidateFor(rule, normalizedKeyword, 'suffix', index);
    } else if (token.length > normalizedKeyword.length && token.startsWith(normalizedKeyword)) {
      candidate = candidateFor(rule, normalizedKeyword, 'prefix', index);
    } else if (token.includes(normalizedKeyword)) {
      candidate = candidateFor(rule, normalizedKeyword, 'contains', index);
    }

    if (candidate !== null && (best === null || byScoreThenDeterministic(candidate, best) < 0)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Regelbasierte Auto-Kategorisierung über die Semantik von `category_rules`.
 *
 * Matching-Priorität (deterministisch):
 * exakter Name > exaktes Token > Suffix > Präfix > Teilstring.
 * Suffix gewinnt bewusst gegen Präfix, weil das Grundwort im Deutschen am Ende
 * steht ("Zitronentee" → Tee, "Käsebrot" → Brot). Innerhalb derselben Stufe
 * gewinnt das längere Keyword, dann das frühere Token, dann die Haushaltsregel.
 *
 * @returns besten Treffer oder `null`, wenn keine Regel passt.
 */
export function autoCategorize(name: string, rules: readonly CategoryRule[]): CategoryMatch | null {
  const normalizedName = normalizeArticleName(name);
  if (normalizedName.length === 0) return null;

  const tokens = normalizedName.split(' ');
  let best: Candidate | null = null;

  for (const rule of rules) {
    const candidate = bestCandidateFor(normalizedName, tokens, rule);
    if (candidate === null) continue;
    if (best === null || byScoreThenDeterministic(candidate, best) < 0) best = candidate;
  }

  if (best === null) return null;
  return {
    categoryKey: best.rule.categoryKey,
    rule: best.rule,
    matchedKeyword: best.rule.keyword,
    score: best.score,
  };
}

/** Wie autoCategorize, aber mit Fallback `sonstiges` (PLAN.md §4.4). */
export function categorize(
  name: string,
  rules: readonly CategoryRule[],
  fallback: CategoryKey = DEFAULT_CATEGORY,
): CategoryResult {
  const match = autoCategorize(name, rules);
  if (match === null) return { categoryKey: fallback, match: null, fallbackUsed: true };
  return { categoryKey: match.categoryKey, match, fallbackUsed: false };
}

export interface ManualChangeInput {
  articleName: string;
  categoryKey: CategoryKey;
  householdId: string;
}

/**
 * Lernen aus manueller Korrektur: erzeugt eine Haushaltsregel als reine
 * Funktion (kein DB-Zugriff). Das Keyword ist der normalisierte Artikelname,
 * damit die nächste gleiche Eingabe exakt trifft.
 */
export function createRuleFromManualChange(input: ManualChangeInput): CategoryRule {
  const keyword = normalizeArticleName(input.articleName);
  if (keyword.length === 0) throw new TypeError('articleName darf nicht leer sein');
  if (input.householdId.trim().length === 0) {
    throw new TypeError('householdId darf nicht leer sein');
  }
  return { keyword, categoryKey: input.categoryKey, householdId: input.householdId };
}

/**
 * Wendet eine manuelle Korrektur auf einen Regelsatz an (rein, ohne Mutation).
 * Eine bestehende Haushaltsregel mit gleichem normalisiertem Keyword wird
 * ersetzt; globale Regeln bleiben unangetastet.
 */
export function learnFromManualChange(
  rules: readonly CategoryRule[],
  input: ManualChangeInput,
): CategoryRule[] {
  const newRule = createRuleFromManualChange(input);
  const kept = rules.filter(
    (rule) =>
      !(
        rule.householdId === newRule.householdId &&
        normalizeArticleName(rule.keyword) === newRule.keyword
      ),
  );
  return [...kept, newRule];
}
