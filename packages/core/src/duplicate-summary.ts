import type { UnitDimension } from './types.js';
import type { Unit } from './types.js';
import type { RowId } from './types.js';
import type { ListItem } from './types.js';
import { normalizeName } from './name.js';
import { convertQuantity, roundQuantity, unitDimension } from './units.js';

/** Eine zusammengefasste Listenzeile (Duplikat-Aggregation, T2.8). */
export interface AggregatedListItem {
  name: string;
  name_normalized: string;
  dimension: UnitDimension;
  quantity: number | null;
  unit: Unit | null;
  sourceIds: RowId[];
  hint: string | null;
}

export interface DuplicateCandidate {
  name: string;
  /** Optional vorberechnet (z. B. aus der DB); sonst wird normalisiert. */
  name_normalized?: string;
  quantity: number | null;
  unit: Unit | null;
}

export interface DuplicatePreview {
  kind: 'aggregate' | 'new-line';
  targetId: RowId | null;
  hint: string | null;
  quantity: number | null;
  unit: Unit | null;
}

const AGGREGATED_HINT = (count: number) => `Menge aus ${count} Einträgen zusammengefasst.`;

function isActive(row: ListItem): boolean {
  return row.deleted_at === null;
}

function groupKeyFor(nameNormalized: string, dimension: UnitDimension, unit: Unit | null): string {
  if (dimension === 'mass' || dimension === 'volume') return `${nameNormalized}|${dimension}`;
  return `${nameNormalized}|${dimension}|${unit ?? ''}`;
}

interface Group {
  name: string;
  nameNormalized: string;
  dimension: UnitDimension;
  unit: Unit | null;
  quantity: number | null;
  knownQuantity: boolean;
  sourceIds: RowId[];
  unitKeys: Set<string>;
}

/**
 * Fasst aktive Listenzeilen zusammen (PLAN.md §4.3, T2.8).
 *
 * Gleicher `name_normalized` + gleiche Dimension → Mengen werden addiert
 * (innerhalb Masse/Volumen umgerechnet). Unterschiedliche Dimension oder
 * nicht konvertierbare Einheiten (1 Bund ≠ 1 Stk) → eigene Zeile mit Hinweis.
 * Reihenfolge = erstes Vorkommen; die Eingabe wird nicht verändert.
 */
export function aggregateListRows(rows: readonly ListItem[]): AggregatedListItem[] {
  const groups: Group[] = [];
  const indexByKey = new Map<string, number>();

  for (const row of rows) {
    if (!isActive(row)) continue;

    const nameNormalized = row.fields.name_normalized;
    const dimension = unitDimension(row.fields.unit);
    const key = groupKeyFor(nameNormalized, dimension, row.fields.unit);

    let index = indexByKey.get(key);
    if (index === undefined) {
      index = groups.length;
      indexByKey.set(key, index);
      groups.push({
        name: row.fields.name,
        nameNormalized,
        dimension,
        unit: row.fields.unit,
        quantity: null,
        knownQuantity: false,
        sourceIds: [],
        unitKeys: new Set<string>(),
      });
    }

    const group = groups[index];
    if (group === undefined) continue;

    group.sourceIds.push(row.id);
    group.unitKeys.add(`${dimension}|${row.fields.unit ?? ''}`);

    if (row.fields.quantity !== null) {
      const converted =
        group.quantity === null
          ? row.fields.quantity
          : convertQuantity(row.fields.quantity, row.fields.unit, group.unit);
      if (converted !== null) {
        group.quantity = roundQuantity((group.quantity ?? 0) + converted);
        group.knownQuantity = true;
      }
    }
  }

  const unitsByNameAndDimension = new Map<string, Set<string>>();
  const dimensionsByName = new Map<string, Set<UnitDimension>>();
  for (const group of groups) {
    const unitKey = `${group.nameNormalized}|${group.dimension}`;
    const unitSet = unitsByNameAndDimension.get(unitKey) ?? new Set<string>();
    unitSet.add(group.unit ?? '');
    unitsByNameAndDimension.set(unitKey, unitSet);

    const dimSet = dimensionsByName.get(group.nameNormalized) ?? new Set<UnitDimension>();
    dimSet.add(group.dimension);
    dimensionsByName.set(group.nameNormalized, dimSet);
  }

  return groups.map((group) => {
    let hint: string | null = null;
    if (group.sourceIds.length > 1) {
      hint = AGGREGATED_HINT(group.sourceIds.length);
    } else if (
      (unitsByNameAndDimension.get(`${group.nameNormalized}|${group.dimension}`)?.size ?? 0) > 1
    ) {
      hint = 'Einheit nicht konvertierbar – eigene Zeile.';
    } else if ((dimensionsByName.get(group.nameNormalized)?.size ?? 0) > 1) {
      hint = 'Andere Dimension – eigene Zeile.';
    }

    return {
      name: group.name,
      name_normalized: group.nameNormalized,
      dimension: group.dimension,
      quantity: group.quantity,
      unit: group.unit,
      sourceIds: group.sourceIds,
      hint,
    };
  });
}

/**
 * Vorschau für „manuell hinzufügen": findet eine passende Zeile und liefert
 * den Hinweis, den die UI anzeigt (A-8).
 */
export function summarizeDuplicate(
  rows: readonly ListItem[],
  candidate: DuplicateCandidate,
): DuplicatePreview {
  const nameNormalized = candidate.name_normalized ?? normalizeName(candidate.name);
  const dimension = unitDimension(candidate.unit);
  const active = rows.filter(isActive);

  const target = active.find((row) => {
    if (row.fields.name_normalized !== nameNormalized) return false;
    if (unitDimension(row.fields.unit) !== dimension) return false;
    if (candidate.quantity === null || row.fields.quantity === null) {
      return (row.fields.unit ?? null) === (candidate.unit ?? null);
    }
    return convertQuantity(candidate.quantity, candidate.unit, row.fields.unit) !== null;
  });

  if (target !== undefined) {
    const converted =
      candidate.quantity === null
        ? null
        : convertQuantity(candidate.quantity, candidate.unit, target.fields.unit);
    const targetQuantity = target.fields.quantity;
    let quantity: number | null = null;
    if (targetQuantity !== null && converted !== null) {
      quantity = roundQuantity(targetQuantity + converted);
    } else if (targetQuantity !== null) {
      quantity = targetQuantity;
    } else if (converted !== null) {
      quantity = converted;
    }
    return {
      kind: 'aggregate',
      targetId: target.id,
      hint: 'Artikel steht bereits auf der Liste – Menge wird addiert.',
      quantity,
      unit: target.fields.unit,
    };
  }

  const sameName = active.find((row) => row.fields.name_normalized === nameNormalized);
  let hint: string | null = null;
  if (sameName !== undefined) {
    hint =
      unitDimension(sameName.fields.unit) === dimension
        ? 'Artikel steht bereits auf der Liste, aber die Einheit ist nicht konvertierbar – eigene Zeile.'
        : 'Artikel steht bereits auf der Liste, aber in anderer Dimension – eigene Zeile.';
  }

  return {
    kind: 'new-line',
    targetId: null,
    hint,
    quantity: candidate.quantity,
    unit: candidate.unit,
  };
}
