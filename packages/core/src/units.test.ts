import { describe, expect, it } from 'vitest';

import { normalizeName } from './name.js';
import { compareTimestamps, latestTimestamp, timestampToMillis } from './time.js';
import { convertQuantity, roundQuantity, unitDimension } from './units.js';

const T1 = '2026-01-01T00:00:01.000Z';
const T2 = '2026-01-01T00:00:02.000Z';
const T3 = '2026-01-01T00:00:03.000Z';

describe('unitDimension', () => {
  it('ordnet Masse, Volumen, Stück und Unbestimmt korrekt zu', () => {
    expect(unitDimension('g')).toBe('mass');
    expect(unitDimension('kg')).toBe('mass');
    expect(unitDimension('ml')).toBe('volume');
    expect(unitDimension('l')).toBe('volume');
    expect(unitDimension('TL')).toBe('volume');
    expect(unitDimension('EL')).toBe('volume');
    expect(unitDimension('Stk')).toBe('piece');
    expect(unitDimension('Bund')).toBe('piece');
    expect(unitDimension('Prise')).toBe('unspecified');
    expect(unitDimension('n. B.')).toBe('unspecified');
    expect(unitDimension(null)).toBe('unspecified');
  });
});

describe('convertQuantity', () => {
  it('rechnet innerhalb von Masse und Volumen um', () => {
    expect(convertQuantity(500, 'g', 'kg')).toBe(0.5);
    expect(convertQuantity(1, 'l', 'ml')).toBe(1000);
    expect(convertQuantity(1, 'EL', 'ml')).toBe(15);
    expect(convertQuantity(1, 'kg', 'kg')).toBe(1);
  });

  it('rechnet nicht zwischen Dimensionen oder verschiedenen Stück-Einheiten um', () => {
    expect(convertQuantity(1, 'kg', 'l')).toBeNull();
    expect(convertQuantity(1, 'Stk', 'Bund')).toBeNull();
    expect(convertQuantity(1, null, 'g')).toBeNull();
  });

  it('behandelt einheitenlose Mengen als identisch', () => {
    expect(convertQuantity(2, null, null)).toBe(2);
  });
});

describe('roundQuantity', () => {
  it('rundet auf drei Nachkommastellen', () => {
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
    expect(roundQuantity(1.23456)).toBe(1.235);
  });
});

describe('normalizeName', () => {
  it('trimmt, kleinschreibt und fasst Whitespace zusammen', () => {
    expect(normalizeName('  Tomaten  ')).toBe('tomaten');
    expect(normalizeName('Voll  Milch')).toBe('voll milch');
    expect(normalizeName('ÄPFEL')).toBe('äpfel');
  });
});

describe('Zeitstempel-Helfer', () => {
  it('parst gültige ISO-Zeitstempel und wirft bei ungültigen', () => {
    expect(timestampToMillis(T1)).toBe(Date.parse(T1));
    expect(() => timestampToMillis('kein-datum')).toThrow(/Ungültiger Zeitstempel/);
  });

  it('vergleicht Zeitstempel', () => {
    expect(compareTimestamps(T1, T2)).toBeLessThan(0);
    expect(compareTimestamps(T2, T2)).toBe(0);
    expect(compareTimestamps(T3, T2)).toBeGreaterThan(0);
  });

  it('liefert den jüngsten Zeitstempel', () => {
    expect(latestTimestamp(T1, T3, T2)).toBe(T3);
  });
});
