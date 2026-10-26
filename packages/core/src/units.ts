import { normalizeName } from './name.js';
import type { Unit, UnitDimension } from './types.js';

const UNIT_DIMENSIONS: Readonly<Record<Unit, UnitDimension>> = {
  g: 'mass',
  kg: 'mass',
  ml: 'volume',
  l: 'volume',
  TL: 'volume',
  EL: 'volume',
  Stk: 'piece',
  Bund: 'piece',
  Dose: 'piece',
  Packung: 'piece',
  Zehe: 'piece',
  Prise: 'unspecified',
  'n. B.': 'unspecified',
};

/** Faktoren zur Basiseinheit je Dimension (g, ml, Stk). */
const BASE_FACTORS: Readonly<Record<Unit, number>> = {
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  TL: 5,
  EL: 15,
  Stk: 1,
  Bund: 1,
  Dose: 1,
  Packung: 1,
  Zehe: 1,
  Prise: 1,
  'n. B.': 1,
};

export function unitDimension(unit: Unit | null): UnitDimension {
  if (unit === null) return 'unspecified';
  return UNIT_DIMENSIONS[unit] ?? 'unspecified';
}

/** Faktor der Einheit zur Basiseinheit ihrer Dimension (g, ml, Stk). */
export function unitBaseFactor(unit: Unit | null): number {
  if (unit === null) return 1;
  return BASE_FACTORS[unit] ?? 1;
}

/**
 * Rechnet eine Menge in eine andere Einheit derselben Dimension um.
 *
 * Nur Masse und Volumen haben verlässliche Faktoren. Bei Stück-Einheiten
 * (Stk, Bund, Dose …) wird bewusst **nicht** zwischen verschiedenen Einheiten
 * umgerechnet — 1 Bund ist nicht 1 Stk. T3.1 verfeinert diese Regel.
 *
 * @returns umgerechnete Menge oder `null`, wenn keine Umrechnung möglich ist.
 */
export function convertQuantity(
  quantity: number,
  from: Unit | null,
  to: Unit | null,
): number | null {
  if (from === null || to === null) {
    return from === to ? quantity : null;
  }
  const fromDimension = unitDimension(from);
  if (fromDimension !== unitDimension(to)) return null;
  if (from === to) return quantity;
  if (fromDimension === 'mass' || fromDimension === 'volume') {
    return roundQuantity((quantity * BASE_FACTORS[from]) / BASE_FACTORS[to]);
  }
  return null;
}

/** Rundet Mengen auf drei Nachkommastellen, um Float-Rauschen zu vermeiden. */
export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Zutat in der für Parser/Formatter/Aggregator gemeinsamen Form. */
export interface IngredientQuantity {
  name: string;
  quantity: number | null;
  unit: Unit | null;
}

/** Ergebnis einer geparsten Zutatenzeile (PLAN.md §4.3). */
export interface ParsedIngredientLine {
  quantity: number | null;
  unit: Unit | null;
  name?: string;
}

/** Ergebniszeile des Aggregators; `hint` markiert nicht kombinierbare Zeilen. */
export interface AggregatedIngredient {
  name: string;
  name_normalized: string;
  dimension: UnitDimension;
  quantity: number | null;
  unit: Unit | null;
  /** Anzahl der Originaleinträge, die in diese Zeile eingeflossen sind. */
  mergedCount: number;
  hint: string | null;
}

/** Unicode-Brüche → ASCII-Bruch (PLAN.md §4.3: ½ ¼ ¾ ⅓ ⅔). */
const UNICODE_FRACTIONS: Readonly<Record<string, string>> = {
  '½': '1/2',
  '¼': '1/4',
  '¾': '3/4',
  '⅓': '1/3',
  '⅔': '2/3',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
  '⅕': '1/5',
  '⅖': '2/5',
  '⅗': '3/5',
  '⅘': '4/5',
  '⅙': '1/6',
  '⅚': '5/6',
};

/**
 * Einheiten-Aliasse (normalisiert: Kleinschreibung, ohne abschließende Punkte).
 * Pluralformen wie „2 Dosen“ werden auf die kanonische Einheit abgebildet.
 */
const UNIT_ALIASES: Readonly<Record<string, Unit>> = {
  g: 'g',
  gr: 'g',
  gramm: 'g',
  gram: 'g',
  kg: 'kg',
  kilo: 'kg',
  kilogramm: 'kg',
  ml: 'ml',
  milliliter: 'ml',
  l: 'l',
  lt: 'l',
  liter: 'l',
  tl: 'TL',
  teelöffel: 'TL',
  teeloeffel: 'TL',
  el: 'EL',
  esslöffel: 'EL',
  essloeffel: 'EL',
  stk: 'Stk',
  stck: 'Stk',
  st: 'Stk',
  stück: 'Stk',
  stueck: 'Stk',
  bund: 'Bund',
  dose: 'Dose',
  dosen: 'Dose',
  packung: 'Packung',
  packungen: 'Packung',
  pkg: 'Packung',
  pck: 'Packung',
  zehe: 'Zehe',
  zehen: 'Zehe',
  prise: 'Prise',
  prisen: 'Prise',
  'n. b': 'n. B.',
  'n.b': 'n. B.',
  nb: 'n. B.',
  'nach belieben': 'n. B.',
  nachbelieben: 'n. B.',
};

const INTEGER_RE = /^[0-9]+$/;
const DECIMAL_RE = /^[0-9]+[.,][0-9]+$/;
const FRACTION_RE = /^([0-9]+)\/([0-9]+)$/;
const COMPACT_RE = /^([0-9]+(?:[.,][0-9]+)?(?:\/[0-9]+)?)([A-Za-zÄÖÜäöüß].*)$/;

const APPROX_PREFIXES = new Set(['ca', 'etwa', 'circa', 'ungefähr', 'ungefaehr', '~', '≈']);

/** Normalisiert Einheiten-/Zahlen-Token: caseless, ohne führende/abschließende Punkte. */
function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^\.+/, '').replace(/\.+$/, '');
}

function lookupUnit(token: string): Unit | null {
  const key = normalizeToken(token);
  return UNIT_ALIASES[key] ?? null;
}

/** Ersetzt geschützte Leerzeichen und Unicode-Brüche, fasst Whitespace zusammen. */
function normalizeLine(input: string): string {
  let text = input.replace(/[\u00A0\u202F\u2009]/g, ' ').replace(/^[~≈]\s*/, '');
  for (const [character, fraction] of Object.entries(UNICODE_FRACTIONS)) {
    text = text.replaceAll(character, ` ${fraction} `);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Zerlegt in Tokens und trennt kompakte Schreibweisen wie „250g“ oder „1,5EL“. */
function tokenize(input: string): string[] {
  const normalized = normalizeLine(input);
  if (normalized === '') return [];
  const tokens: string[] = [];
  for (const token of normalized.split(' ')) {
    const compact = COMPACT_RE.exec(token);
    const numberPart = compact?.[1];
    const unitPart = compact?.[2];
    if (compact !== null && numberPart !== undefined && unitPart !== undefined) {
      tokens.push(numberPart, unitPart);
    } else {
      tokens.push(token);
    }
  }
  return tokens;
}

/** Entfernt führende „ca.“/„etwa“/„~“-Tokens. */
function stripApprox(tokens: readonly string[]): string[] {
  let start = 0;
  while (start < tokens.length) {
    const token = tokens[start];
    if (token === undefined) break;
    if (APPROX_PREFIXES.has(token.toLowerCase())) {
      start += 1;
      continue;
    }
    break;
  }
  return tokens.slice(start);
}

function parseNumberToken(token: string): number | null {
  if (INTEGER_RE.test(token)) return Number(token);
  if (/^[0-9]+[.,]$/.test(token)) return Number(token.slice(0, -1));
  if (DECIMAL_RE.test(token)) return Number(token.replace(',', '.'));
  const fraction = FRACTION_RE.exec(token);
  if (fraction !== null) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return null;
    }
    return numerator / denominator;
  }
  return null;
}

/** Parst eine Zahl ab `start` (einzelne Zahl oder gemischte Zahl „2 1/2“). */
function parseQuantityExpression(
  tokens: readonly string[],
  start: number,
): { value: number; length: number } | null {
  const first = tokens[start];
  if (first === undefined) return null;

  const second = tokens[start + 1];
  if (second !== undefined && INTEGER_RE.test(first)) {
    const fraction = FRACTION_RE.exec(second);
    if (fraction !== null) {
      const numerator = Number(fraction[1]);
      const denominator = Number(fraction[2]);
      if (denominator !== 0) {
        const fractionValue = numerator / denominator;
        if (fractionValue > 0 && fractionValue < 1) {
          return { value: Number(first) + fractionValue, length: 2 };
        }
      }
    }
  }

  const single = parseNumberToken(first);
  if (single !== null) return { value: single, length: 1 };
  return null;
}

/** Parst eine Zahl, die direkt vor `endExclusive` endet (für „Mehl 250 g“). */
function parseQuantityExpressionEndingAt(
  tokens: readonly string[],
  endExclusive: number,
): { value: number; start: number; length: number } | null {
  const twoStart = endExclusive - 2;
  if (twoStart >= 0) {
    const parsed = parseQuantityExpression(tokens, twoStart);
    if (parsed !== null && parsed.length === 2) {
      return { value: parsed.value, start: twoStart, length: 2 };
    }
  }
  const oneStart = endExclusive - 1;
  if (oneStart >= 0) {
    const parsed = parseQuantityExpression(tokens, oneStart);
    if (parsed !== null && parsed.length === 1) {
      return { value: parsed.value, start: oneStart, length: 1 };
    }
  }
  return null;
}

/** Sucht ab `index` eine Einheit; mehrteilige Einheiten wie „n. B.“ zuerst. */
function findUnitAt(
  tokens: readonly string[],
  index: number,
): { unit: Unit; length: number } | null {
  const first = tokens[index];
  if (first === undefined) return null;
  const second = tokens[index + 1];
  if (second !== undefined) {
    const joined = lookupUnit(`${first} ${second}`);
    if (joined !== null) return { unit: joined, length: 2 };
  }
  const single = lookupUnit(first);
  if (single !== null) return { unit: single, length: 1 };
  return null;
}

/** Räumt einen Namen auf (Whitespace, führende/abschließende Satzzeichen). */
function cleanName(parts: readonly string[]): string | undefined {
  const text = parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:.]+/, '')
    .replace(/[,;:.]+$/, '')
    .trim();
  return text === '' ? undefined : text;
}

function buildParsed(
  quantity: number | null,
  unit: Unit | null,
  name: string | undefined,
): ParsedIngredientLine {
  const parsed: ParsedIngredientLine = { quantity, unit };
  if (name !== undefined) parsed.name = name;
  return parsed;
}

/**
 * Parst eine Mengenangabe wie „250 g“, „1,5 EL“, „½ TL“, „2 1/2 Stk“ oder
 * „1,5“ (ohne Einheit). Komma und Punkt sind als Dezimaltrenner erlaubt.
 *
 * @returns die Menge oder `null`, wenn keine Zahl erkannt wird.
 */
export function parseQuantity(input: string): number | null {
  const tokens = stripApprox(tokenize(input));
  if (tokens.length === 0) return null;

  const leading = parseQuantityExpression(tokens, 0);
  if (leading !== null) return leading.value;

  const trailing = parseQuantityExpressionEndingAt(tokens, tokens.length);
  if (trailing !== null) return trailing.value;

  for (let index = 0; index < tokens.length; index += 1) {
    const parsed = parseQuantityExpression(tokens, index);
    if (parsed !== null) return parsed.value;
  }
  return null;
}

/**
 * Parst eine freie Zutatenzeile (PLAN.md §4.3).
 *
 * Versteht Menge und Einheit vor oder nach dem Namen, gemischte Zahlen,
 * Unicode-Brüche, kompakte Schreibweisen („250g“) sowie „Salz n. B.“.
 */
export function parseIngredientLine(line: string): ParsedIngredientLine {
  const tokens = stripApprox(tokenize(line));
  if (tokens.length === 0) return { quantity: null, unit: null };

  const leading = parseQuantityExpression(tokens, 0);
  if (leading !== null) {
    let unit: Unit | null = null;
    let unitIndex: number | null = null;
    let unitLength = 1;
    const cursor = leading.length;
    for (let index = cursor; index < tokens.length && index <= cursor + 2; index += 1) {
      const found = findUnitAt(tokens, index);
      if (found !== null) {
        unit = found.unit;
        unitIndex = index;
        unitLength = found.length;
        break;
      }
    }
    const nameParts =
      unitIndex === null
        ? tokens.slice(cursor)
        : [...tokens.slice(cursor, unitIndex), ...tokens.slice(unitIndex + unitLength)];
    return buildParsed(leading.value, unit, cleanName(nameParts));
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const found = findUnitAt(tokens, index);
    if (found === null) continue;

    const before = tokens.slice(0, index);
    const after = tokens.slice(index + found.length);
    const quantity = parseQuantityExpressionEndingAt(before, before.length);
    const nameParts =
      quantity === null ? [...before, ...after] : [...before.slice(0, quantity.start), ...after];
    return buildParsed(quantity?.value ?? null, found.unit, cleanName(nameParts));
  }

  const trailing = parseQuantityExpressionEndingAt(tokens, tokens.length);
  if (trailing !== null) {
    return buildParsed(trailing.value, null, cleanName(tokens.slice(0, trailing.start)));
  }

  return buildParsed(null, null, cleanName(tokens));
}

/** Label der Einheit inkl. einfacher deutscher Pluralform. */
function unitLabel(unit: Unit, quantity: number | null): string {
  if (unit === 'n. B.') return 'n. B.';
  if (quantity === null || quantity === 1) return unit;
  switch (unit) {
    case 'Dose':
      return 'Dosen';
    case 'Packung':
      return 'Packungen';
    case 'Zehe':
      return 'Zehen';
    case 'Prise':
      return 'Prisen';
    default:
      return unit;
  }
}

/** Rundet auf `decimals` Stellen (halbaufwärts, gegen Float-Rauschen). */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Formatiert eine Zahl mit deutschem Komma, max. 2 Nachkommastellen. */
function formatNumberDe(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = roundTo(value, 2);
  if (Object.is(rounded, -0)) return '0';
  const text = rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
  return text;
}

/**
 * Formatiert eine Menge samt Einheit „schön“ (PLAN.md §4.3):
 * 1500 g → „1,5 kg“, 500 ml → „0,5 l“, 0.25 l → „250 ml“.
 *
 * Masse/Volumen werden nur zwischen den Basiseinheiten umgerechnet
 * (g↔kg, ml↔l); Kochlöffel (TL/EL) und Stück-Einheiten bleiben unverändert.
 */
export function formatQuantity(quantity: number | null, unit: Unit | null): string {
  if (quantity === null) {
    if (unit === null) return '';
    if (unit === 'n. B.') return 'n. B.';
    return unitLabel(unit, null);
  }
  if (unit === null) return formatNumberDe(quantity);
  if (unit === 'n. B.') return 'n. B.';

  const dimension = unitDimension(unit);
  if (dimension === 'mass') {
    const base = roundTo(quantity * unitBaseFactor(unit), 2);
    const displayUnit: Unit = Math.abs(base) >= 1000 ? 'kg' : 'g';
    const displayValue = displayUnit === 'kg' ? base / 1000 : base;
    return `${formatNumberDe(displayValue)} ${unitLabel(displayUnit, displayValue)}`;
  }
  if (dimension === 'volume' && (unit === 'ml' || unit === 'l')) {
    const base = roundTo(quantity * unitBaseFactor(unit), 2);
    const displayUnit: Unit = Math.abs(base) >= 500 ? 'l' : 'ml';
    const displayValue = displayUnit === 'l' ? base / 1000 : base;
    return `${formatNumberDe(displayValue)} ${unitLabel(displayUnit, displayValue)}`;
  }
  return `${formatNumberDe(quantity)} ${unitLabel(unit, quantity)}`;
}

/** Formatiert eine Zutat als Anzeigezeile („1,5 kg Mehl“, „Salz n. B.“). */
export function formatIngredient(ingredient: IngredientQuantity): string {
  const name = ingredient.name.trim();
  if (ingredient.quantity === null || ingredient.unit === 'n. B.') {
    if (ingredient.unit === 'n. B.') return name === '' ? 'n. B.' : `${name} n. B.`;
    return name;
  }
  const quantityText = formatQuantity(ingredient.quantity, ingredient.unit);
  return name === '' ? quantityText : `${quantityText} ${name}`;
}

interface IngredientGroup {
  key: string;
  name: string;
  name_normalized: string;
  dimension: UnitDimension;
  quantity: number | null;
  unit: Unit | null;
  mergedCount: number;
}

/** Gruppenschlüssel: Name + Dimension; bei Stück/Unbestimmt zählt die Einheit. */
function groupKeyFor(normalizedName: string, unit: Unit | null): string {
  const dimension = unitDimension(unit);
  const unitPart = dimension === 'mass' || dimension === 'volume' ? dimension : (unit ?? '∅');
  return `${normalizedName}::${unitPart}`;
}

function createGroup(
  key: string,
  ingredient: IngredientQuantity,
  normalizedName: string,
  withConflictSuffix: boolean,
  index: number,
): IngredientGroup {
  return {
    key: withConflictSuffix ? `${key}::conflict${index}` : key,
    name: ingredient.name.trim(),
    name_normalized: normalizedName,
    dimension: unitDimension(ingredient.unit),
    quantity: ingredient.quantity === null ? null : roundQuantity(ingredient.quantity),
    unit: ingredient.unit,
    mergedCount: 1,
  };
}

/**
 * Aggregiert Zutaten (PLAN.md §4.3).
 *
 * Gleich normalisierter Name **und** gleiche Dimension werden addiert und in
 * die Einheit des ersten Eintrags umgerechnet. Andere Dimensionen sowie nicht
 * konvertierbare Stück-Einheiten bleiben eigene Zeilen mit `hint`.
 */
export function aggregateIngredients(
  ingredients: readonly IngredientQuantity[],
): AggregatedIngredient[] {
  const groups: IngredientGroup[] = [];

  for (const ingredient of ingredients) {
    const normalizedName = normalizeName(ingredient.name);
    const key = groupKeyFor(normalizedName, ingredient.unit);
    const existing = groups.find((group) => group.key === key);

    if (existing === undefined) {
      groups.push(createGroup(key, ingredient, normalizedName, false, groups.length));
      continue;
    }

    if (ingredient.quantity === null || existing.quantity === null) {
      const bothUnspecified =
        ingredient.quantity === null &&
        existing.quantity === null &&
        ingredient.unit === existing.unit;
      if (bothUnspecified) {
        existing.mergedCount += 1;
        continue;
      }
      groups.push(createGroup(key, ingredient, normalizedName, true, groups.length));
      continue;
    }

    const converted = convertQuantity(ingredient.quantity, ingredient.unit, existing.unit);
    if (converted === null) {
      groups.push(createGroup(key, ingredient, normalizedName, true, groups.length));
      continue;
    }
    existing.quantity = roundQuantity(existing.quantity + converted);
    existing.mergedCount += 1;
  }

  const groupCounts = new Map<string, number>();
  for (const group of groups) {
    groupCounts.set(group.name_normalized, (groupCounts.get(group.name_normalized) ?? 0) + 1);
  }

  return groups.map((group) => {
    const shareName = (groupCounts.get(group.name_normalized) ?? 1) > 1;
    let hint: string | null = null;
    if (shareName) {
      const others = groups.filter(
        (other) => other !== group && other.name_normalized === group.name_normalized,
      );
      const differentDimension = others.some((other) => other.dimension !== group.dimension);
      hint = differentDimension
        ? 'Andere Dimension – eigene Zeile.'
        : 'Nicht konvertierbare Einheit – eigene Zeile.';
    }
    return {
      name: group.name,
      name_normalized: group.name_normalized,
      dimension: group.dimension,
      quantity: group.quantity,
      unit: group.unit,
      mergedCount: group.mergedCount,
      hint,
    };
  });
}
