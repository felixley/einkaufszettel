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
