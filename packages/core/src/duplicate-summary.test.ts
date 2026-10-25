import { describe, expect, it } from 'vitest';

import { aggregateListRows, summarizeDuplicate } from './duplicate-summary.js';
import { makeListItem } from './testing/fixtures.js';
import type { ListItem } from './types.js';

function tomate(quantity: number | null, unit: ListItem['fields']['unit'], id: string): ListItem {
  return makeListItem({ name: 'Tomaten', name_normalized: 'tomaten', quantity, unit }, { id });
}

describe('aggregateListRows (T2.8 / A-8)', () => {
  it('addiert Mengen bei gleichem name_normalized und gleicher Dimension', () => {
    const result = aggregateListRows([tomate(2, 'Stk', 'a'), tomate(3, 'Stk', 'b')]);

    expect(result).toHaveLength(1);
    expect(result[0]?.name_normalized).toBe('tomaten');
    expect(result[0]?.dimension).toBe('piece');
    expect(result[0]?.quantity).toBe(5);
    expect(result[0]?.unit).toBe('Stk');
    expect(result[0]?.sourceIds).toEqual(['a', 'b']);
    expect(result[0]?.hint).toContain('zusammengefasst');
  });

  it('rechnet innerhalb der Dimension Masse um (kg + g)', () => {
    const result = aggregateListRows([tomate(1.5, 'kg', 'a'), tomate(500, 'g', 'b')]);

    expect(result).toHaveLength(1);
    expect(result[0]?.quantity).toBe(2);
    expect(result[0]?.unit).toBe('kg');
    expect(result[0]?.hint).toContain('2');
  });

  it('rechnet innerhalb der Dimension Volumen um (l + ml)', () => {
    const result = aggregateListRows([tomate(1, 'l', 'a'), tomate(250, 'ml', 'b')]);

    expect(result).toHaveLength(1);
    expect(result[0]?.quantity).toBe(1.25);
    expect(result[0]?.unit).toBe('l');
  });

  it('addiert gleiche Einheiten ohne Umrechnung (g + g)', () => {
    const result = aggregateListRows([tomate(500, 'g', 'a'), tomate(250, 'g', 'b')]);
    expect(result[0]?.quantity).toBe(750);
    expect(result[0]?.unit).toBe('g');
  });

  it('addiert gleiche Einheiten ohne Umrechnung (Prise)', () => {
    const rows = [
      makeListItem(
        { name: 'Salz', name_normalized: 'salz', quantity: 2, unit: 'Prise' },
        { id: 'a' },
      ),
      makeListItem(
        { name: 'Salz', name_normalized: 'salz', quantity: 3, unit: 'Prise' },
        { id: 'b' },
      ),
    ];
    const result = aggregateListRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0]?.dimension).toBe('unspecified');
    expect(result[0]?.quantity).toBe(5);
    expect(result[0]?.unit).toBe('Prise');
  });

  it('legt unterschiedliche Dimensionen auf eigene Zeilen', () => {
    const result = aggregateListRows([tomate(1500, 'g', 'a'), tomate(3, 'Stk', 'b')]);

    expect(result).toHaveLength(2);
    const mass = result.find((row) => row.dimension === 'mass');
    const piece = result.find((row) => row.dimension === 'piece');
    expect(mass?.quantity).toBe(1500);
    expect(mass?.unit).toBe('g');
    expect(piece?.quantity).toBe(3);
    expect(piece?.unit).toBe('Stk');
    expect(mass?.hint).toContain('Andere Dimension');
    expect(piece?.hint).toContain('Andere Dimension');
  });

  it('legt nicht konvertierbare Stück-Einheiten auf eigene Zeilen', () => {
    const rows = [
      makeListItem(
        { name: 'Petersilie', name_normalized: 'petersilie', quantity: 1, unit: 'Bund' },
        { id: 'a' },
      ),
      makeListItem(
        { name: 'Petersilie', name_normalized: 'petersilie', quantity: 2, unit: 'Stk' },
        { id: 'b' },
      ),
    ];
    const result = aggregateListRows(rows);

    expect(result).toHaveLength(2);
    expect(result.map((row) => row.unit)).toEqual(['Bund', 'Stk']);
    expect(result[0]?.hint).toContain('nicht konvertierbar');
    expect(result[1]?.hint).toContain('nicht konvertierbar');
  });

  it('addiert Mengen auch bei unbekannter Menge (null)', () => {
    const result = aggregateListRows([tomate(null, 'Stk', 'a'), tomate(2, 'Stk', 'b')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.quantity).toBe(2);
    expect(result[0]?.hint).toContain('zusammengefasst');
  });

  it('behält null, wenn beide Mengen unbekannt sind', () => {
    const result = aggregateListRows([tomate(null, 'Stk', 'a'), tomate(null, 'Stk', 'b')]);
    expect(result[0]?.quantity).toBeNull();
    expect(result[0]?.hint).toContain('zusammengefasst');
  });

  it('ignoriert gelöschte Zeilen', () => {
    const deleted = makeListItem(
      { name: 'Tomaten', name_normalized: 'tomaten', quantity: 5, unit: 'Stk' },
      { id: 'x', deleted_at: '2026-01-02T00:00:00.000Z' },
    );
    const result = aggregateListRows([tomate(2, 'Stk', 'a'), deleted]);
    expect(result).toHaveLength(1);
    expect(result[0]?.quantity).toBe(2);
    expect(result[0]?.sourceIds).toEqual(['a']);
  });

  it('lässt einzelne Zeilen unverändert und ohne Hinweis', () => {
    const result = aggregateListRows([tomate(2, 'kg', 'a')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.quantity).toBe(2);
    expect(result[0]?.unit).toBe('kg');
    expect(result[0]?.hint).toBeNull();
  });

  it('behält die Reihenfolge des ersten Vorkommens bei', () => {
    const apfel = makeListItem(
      { name: 'Apfel', name_normalized: 'apfel', quantity: 1, unit: 'Stk' },
      { id: 'a' },
    );
    const result = aggregateListRows([tomate(1, 'Stk', 'b'), apfel]);
    expect(result.map((row) => row.name_normalized)).toEqual(['tomaten', 'apfel']);
  });

  it('mutiert die Eingabe nicht', () => {
    const rows = [tomate(2, 'Stk', 'a'), tomate(3, 'Stk', 'b')];
    const before = JSON.stringify(rows);
    aggregateListRows(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('liefert für eine leere Liste eine leere Zusammenfassung', () => {
    expect(aggregateListRows([])).toEqual([]);
  });
});

describe('summarizeDuplicate (Vorschau beim manuellen Hinzufügen)', () => {
  it('meldet Aggregation und die addierte Menge', () => {
    const preview = summarizeDuplicate([tomate(1.5, 'kg', 'a')], {
      name: 'Tomaten',
      quantity: 500,
      unit: 'g',
    });

    expect(preview.kind).toBe('aggregate');
    expect(preview.targetId).toBe('a');
    expect(preview.quantity).toBe(2);
    expect(preview.unit).toBe('kg');
    expect(preview.hint).toContain('addiert');
  });

  it('meldet unterschiedliche Dimension als eigene Zeile', () => {
    const preview = summarizeDuplicate([tomate(1.5, 'kg', 'a')], {
      name: 'Tomaten',
      quantity: 3,
      unit: 'Stk',
    });

    expect(preview.kind).toBe('new-line');
    expect(preview.targetId).toBeNull();
    expect(preview.quantity).toBe(3);
    expect(preview.unit).toBe('Stk');
    expect(preview.hint).toContain('anderer Dimension');
  });

  it('meldet nicht konvertierbare Einheiten als eigene Zeile', () => {
    const existing = makeListItem(
      { name: 'Petersilie', name_normalized: 'petersilie', quantity: 1, unit: 'Bund' },
      { id: 'a' },
    );
    const preview = summarizeDuplicate([existing], {
      name: 'Petersilie',
      quantity: 2,
      unit: 'Stk',
    });

    expect(preview.kind).toBe('new-line');
    expect(preview.hint).toContain('nicht konvertierbar');
  });

  it('meldet neue Artikel ohne Hinweis', () => {
    const preview = summarizeDuplicate([tomate(1, 'Stk', 'a')], {
      name: 'Milch',
      quantity: 1,
      unit: 'l',
    });

    expect(preview.kind).toBe('new-line');
    expect(preview.hint).toBeNull();
    expect(preview.quantity).toBe(1);
    expect(preview.unit).toBe('l');
  });

  it('nutzt ein vorberechnetes name_normalized', () => {
    const preview = summarizeDuplicate([tomate(1, 'Stk', 'a')], {
      name: 'Tomaten',
      name_normalized: 'tomaten',
      quantity: 2,
      unit: 'Stk',
    });

    expect(preview.kind).toBe('aggregate');
    expect(preview.quantity).toBe(3);
    expect(preview.hint).toContain('addiert');
  });

  it('ignoriert gelöschte Zeilen bei der Suche', () => {
    const deleted = makeListItem(
      { name: 'Tomaten', name_normalized: 'tomaten', quantity: 2, unit: 'Stk' },
      { id: 'a', deleted_at: '2026-01-02T00:00:00.000Z' },
    );
    const preview = summarizeDuplicate([deleted], { name: 'Tomaten', quantity: 3, unit: 'Stk' });
    expect(preview.kind).toBe('new-line');
    expect(preview.hint).toBeNull();
  });
});
