import { describe, expect, it } from 'vitest';

import { normalizeName } from './name.js';
import { compareTimestamps, latestTimestamp, timestampToMillis } from './time.js';
import {
  aggregateIngredients,
  convertQuantity,
  formatIngredient,
  formatQuantity,
  parseIngredientLine,
  parseQuantity,
  roundQuantity,
  unitBaseFactor,
  unitDimension,
} from './units.js';

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

describe('unitBaseFactor', () => {
  it('liefert den Faktor zur Basiseinheit', () => {
    expect(unitBaseFactor('g')).toBe(1);
    expect(unitBaseFactor('kg')).toBe(1000);
    expect(unitBaseFactor('l')).toBe(1000);
    expect(unitBaseFactor('EL')).toBe(15);
    expect(unitBaseFactor('TL')).toBe(5);
    expect(unitBaseFactor(null)).toBe(1);
  });
});

describe('parseQuantity', () => {
  it('parst ganze Zahlen und Dezimalzahlen mit Komma oder Punkt', () => {
    expect(parseQuantity('250')).toBe(250);
    expect(parseQuantity('1,5')).toBe(1.5);
    expect(parseQuantity('1.5')).toBe(1.5);
    expect(parseQuantity('0,25')).toBe(0.25);
  });

  it('parst Unicode-Brüche', () => {
    expect(parseQuantity('½')).toBe(0.5);
    expect(parseQuantity('¼')).toBe(0.25);
    expect(parseQuantity('¾')).toBe(0.75);
    expect(parseQuantity('⅓')).toBeCloseTo(1 / 3);
    expect(parseQuantity('⅔')).toBeCloseTo(2 / 3);
  });

  it('parst ASCII-Brüche und gemischte Zahlen', () => {
    expect(parseQuantity('1/2')).toBe(0.5);
    expect(parseQuantity('2 1/2')).toBe(2.5);
    expect(parseQuantity('1 1/2')).toBe(1.5);
    expect(parseQuantity('2½')).toBe(2.5);
  });

  it('parst Mengen mit Einheit und kompakter Schreibweise', () => {
    expect(parseQuantity('250 g')).toBe(250);
    expect(parseQuantity('250g')).toBe(250);
    expect(parseQuantity('1,5 EL')).toBe(1.5);
    expect(parseQuantity('0.5 kg')).toBe(0.5);
    expect(parseQuantity('Mehl 250 g')).toBe(250);
  });

  it('ignoriert führende Näherungen (ca./etwa/~)', () => {
    expect(parseQuantity('ca. 250 g')).toBe(250);
    expect(parseQuantity('etwa 1,5')).toBe(1.5);
    expect(parseQuantity('~ 500')).toBe(500);
  });

  it('liefert null für Text ohne Zahl', () => {
    expect(parseQuantity('Salz')).toBeNull();
    expect(parseQuantity('n. B.')).toBeNull();
    expect(parseQuantity('')).toBeNull();
  });
});

describe('parseIngredientLine', () => {
  it('parst Menge, Einheit und Namen in gängiger Reihenfolge', () => {
    expect(parseIngredientLine('250 g Mehl')).toEqual({ quantity: 250, unit: 'g', name: 'Mehl' });
    expect(parseIngredientLine('1,5 EL Öl')).toEqual({ quantity: 1.5, unit: 'EL', name: 'Öl' });
    expect(parseIngredientLine('½ TL Salz')).toEqual({ quantity: 0.5, unit: 'TL', name: 'Salz' });
    expect(parseIngredientLine('¼ l Milch')).toEqual({ quantity: 0.25, unit: 'l', name: 'Milch' });
    expect(parseIngredientLine('2 1/2 Stk Eier')).toEqual({
      quantity: 2.5,
      unit: 'Stk',
      name: 'Eier',
    });
    expect(parseIngredientLine('1 Prise Salz')).toEqual({
      quantity: 1,
      unit: 'Prise',
      name: 'Salz',
    });
  });

  it('erkennt „Salz n. B.“ als unbestimmte Menge', () => {
    expect(parseIngredientLine('Salz n. B.')).toEqual({
      quantity: null,
      unit: 'n. B.',
      name: 'Salz',
    });
    expect(parseIngredientLine('Salz n.B.')).toEqual({
      quantity: null,
      unit: 'n. B.',
      name: 'Salz',
    });
    expect(parseIngredientLine('Salz nach Belieben')).toEqual({
      quantity: null,
      unit: 'n. B.',
      name: 'Salz',
    });
  });

  it('versteht Plural-/Alias-Einheiten', () => {
    expect(parseIngredientLine('2 Dosen Tomaten')).toEqual({
      quantity: 2,
      unit: 'Dose',
      name: 'Tomaten',
    });
    expect(parseIngredientLine('1 Stück Butter')).toEqual({
      quantity: 1,
      unit: 'Stk',
      name: 'Butter',
    });
    expect(parseIngredientLine('3 Zehen Knoblauch')).toEqual({
      quantity: 3,
      unit: 'Zehe',
      name: 'Knoblauch',
    });
    expect(parseIngredientLine('1 Pkg Nudeln')).toEqual({
      quantity: 1,
      unit: 'Packung',
      name: 'Nudeln',
    });
  });

  it('parst kompakte Schreibweise ohne Leerzeichen', () => {
    expect(parseIngredientLine('250g Mehl')).toEqual({ quantity: 250, unit: 'g', name: 'Mehl' });
    expect(parseIngredientLine('1,5EL Öl')).toEqual({ quantity: 1.5, unit: 'EL', name: 'Öl' });
    expect(parseIngredientLine('1/2l Milch')).toEqual({ quantity: 0.5, unit: 'l', name: 'Milch' });
  });

  it('findet Menge und Einheit auch nach dem Namen', () => {
    expect(parseIngredientLine('Mehl 250 g')).toEqual({ quantity: 250, unit: 'g', name: 'Mehl' });
    expect(parseIngredientLine('Tomaten 2 Dosen')).toEqual({
      quantity: 2,
      unit: 'Dose',
      name: 'Tomaten',
    });
    expect(parseIngredientLine('Mehl 2 1/2 g')).toEqual({
      quantity: 2.5,
      unit: 'g',
      name: 'Mehl',
    });
  });

  it('toleriert Adjektive zwischen Menge und Einheit', () => {
    expect(parseIngredientLine('2 große Dosen Tomaten')).toEqual({
      quantity: 2,
      unit: 'Dose',
      name: 'große Tomaten',
    });
  });

  it('behandelt Zeilen ohne Einheit', () => {
    expect(parseIngredientLine('2 Eier')).toEqual({ quantity: 2, unit: null, name: 'Eier' });
    expect(parseIngredientLine('Eier 2')).toEqual({ quantity: 2, unit: null, name: 'Eier' });
    expect(parseIngredientLine('Milch')).toEqual({ quantity: null, unit: null, name: 'Milch' });
  });

  it('liefert bei leerer Eingabe leere Menge, Einheit und Namen', () => {
    expect(parseIngredientLine('')).toEqual({ quantity: null, unit: null });
    expect(parseIngredientLine('   ')).toEqual({ quantity: null, unit: null });
    expect(parseIngredientLine('n. B.')).toEqual({ quantity: null, unit: 'n. B.' });
  });
});

describe('formatQuantity', () => {
  it('rechnet Masse zwischen g und kg um', () => {
    expect(formatQuantity(1500, 'g')).toBe('1,5 kg');
    expect(formatQuantity(1000, 'g')).toBe('1 kg');
    expect(formatQuantity(500, 'g')).toBe('500 g');
    expect(formatQuantity(0.5, 'kg')).toBe('500 g');
    expect(formatQuantity(1.25, 'kg')).toBe('1,25 kg');
  });

  it('rechnet Volumen zwischen ml und l um', () => {
    expect(formatQuantity(500, 'ml')).toBe('0,5 l');
    expect(formatQuantity(250, 'ml')).toBe('250 ml');
    expect(formatQuantity(0.25, 'l')).toBe('250 ml');
    expect(formatQuantity(1500, 'ml')).toBe('1,5 l');
  });

  it('rechnet Stück-Einheiten nie um', () => {
    expect(formatQuantity(2, 'Stk')).toBe('2 Stk');
    expect(formatQuantity(2, 'Bund')).toBe('2 Bund');
    expect(formatQuantity(2, 'Dose')).toBe('2 Dosen');
    expect(formatQuantity(1, 'Dose')).toBe('1 Dose');
    expect(formatQuantity(2, 'Prise')).toBe('2 Prisen');
  });

  it('behält Kochlöffel-Einheiten bei', () => {
    expect(formatQuantity(1, 'EL')).toBe('1 EL');
    expect(formatQuantity(3, 'TL')).toBe('3 TL');
  });

  it('formatiert mit deutschem Komma, max. 2 Stellen, ohne trailing zeros', () => {
    expect(formatQuantity(1.5, null)).toBe('1,5');
    expect(formatQuantity(2, null)).toBe('2');
    expect(formatQuantity(1.239, null)).toBe('1,24');
    expect(formatQuantity(1.2, 'kg')).toBe('1,2 kg');
  });

  it('behandelt „n. B.“, null-Einheit und null-Menge', () => {
    expect(formatQuantity(null, 'n. B.')).toBe('n. B.');
    expect(formatQuantity(5, 'n. B.')).toBe('n. B.');
    expect(formatQuantity(3, null)).toBe('3');
    expect(formatQuantity(null, null)).toBe('');
    expect(formatQuantity(null, 'g')).toBe('g');
  });
});

describe('formatIngredient', () => {
  it('formatiert vollständige Zutaten', () => {
    expect(formatIngredient({ name: 'Mehl', quantity: 1500, unit: 'g' })).toBe('1,5 kg Mehl');
    expect(formatIngredient({ name: 'Milch', quantity: 500, unit: 'ml' })).toBe('0,5 l Milch');
    expect(formatIngredient({ name: 'Tomaten', quantity: 2, unit: 'Dose' })).toBe(
      '2 Dosen Tomaten',
    );
  });

  it('hängt „n. B.“ hinter den Namen', () => {
    expect(formatIngredient({ name: 'Salz', quantity: null, unit: 'n. B.' })).toBe('Salz n. B.');
    expect(formatIngredient({ name: 'Salz', quantity: 1, unit: 'n. B.' })).toBe('Salz n. B.');
  });

  it('lässt Namen ohne Menge stehen', () => {
    expect(formatIngredient({ name: 'Salz', quantity: null, unit: null })).toBe('Salz');
    expect(formatIngredient({ name: 'Salz', quantity: null, unit: 'g' })).toBe('Salz');
  });

  it('gibt nur die Menge zurück, wenn kein Name da ist', () => {
    expect(formatIngredient({ name: '', quantity: 250, unit: 'g' })).toBe('250 g');
  });
});

describe('aggregateIngredients', () => {
  it('addiert gleiche Namen in derselben Masse-Dimension', () => {
    const result = aggregateIngredients([
      { name: 'Mehl', quantity: 1, unit: 'kg' },
      { name: 'Mehl', quantity: 250, unit: 'g' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.quantity).toBe(1.25);
    expect(result[0]?.unit).toBe('kg');
    expect(result[0]?.dimension).toBe('mass');
    expect(result[0]?.mergedCount).toBe(2);
    expect(result[0]?.hint).toBeNull();
  });

  it('addiert gleiche Namen in derselben Volumen-Dimension', () => {
    const result = aggregateIngredients([
      { name: 'Milch', quantity: 1, unit: 'l' },
      { name: 'Milch', quantity: 500, unit: 'ml' },
      { name: 'Milch', quantity: 1, unit: 'EL' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.quantity).toBe(1.515);
    expect(result[0]?.unit).toBe('l');
  });

  it('addiert gleiche Stück-Einheiten, lässt verschiedene getrennt', () => {
    const same = aggregateIngredients([
      { name: 'Eier', quantity: 2, unit: 'Stk' },
      { name: 'Eier', quantity: 3, unit: 'Stk' },
    ]);
    expect(same).toHaveLength(1);
    expect(same[0]?.quantity).toBe(5);

    const different = aggregateIngredients([
      { name: 'Eier', quantity: 2, unit: 'Stk' },
      { name: 'Eier', quantity: 1, unit: 'Bund' },
    ]);
    expect(different).toHaveLength(2);
    expect(different[0]?.hint).toBe('Nicht konvertierbare Einheit – eigene Zeile.');
    expect(different[1]?.hint).toBe('Nicht konvertierbare Einheit – eigene Zeile.');
  });

  it('trennt unterschiedliche Dimensionen mit Hinweis', () => {
    const result = aggregateIngredients([
      { name: 'Milch', quantity: 1, unit: 'l' },
      { name: 'Milch', quantity: 2, unit: 'Stk' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.dimension).toBe('volume');
    expect(result[1]?.dimension).toBe('piece');
    expect(result[0]?.hint).toBe('Andere Dimension – eigene Zeile.');
    expect(result[1]?.hint).toBe('Andere Dimension – eigene Zeile.');
  });

  it('trennt unterschiedliche Namen', () => {
    const result = aggregateIngredients([
      { name: 'Mehl', quantity: 1, unit: 'kg' },
      { name: 'Zucker', quantity: 1, unit: 'kg' },
    ]);
    expect(result).toHaveLength(2);
    expect(result.every((row) => row.hint === null)).toBe(true);
  });

  it('normalisiert den Namen für den Vergleich', () => {
    const result = aggregateIngredients([
      { name: '  MEHL ', quantity: 1, unit: 'kg' },
      { name: 'mehl', quantity: 1, unit: 'kg' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.name_normalized).toBe('mehl');
    expect(result[0]?.mergedCount).toBe(2);
  });

  it('fasst mehrfach genannte n.-B.-Zeilen zusammen', () => {
    const result = aggregateIngredients([
      { name: 'Salz', quantity: null, unit: 'n. B.' },
      { name: 'Salz', quantity: null, unit: 'n. B.' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.quantity).toBeNull();
    expect(result[0]?.mergedCount).toBe(2);
    expect(result[0]?.hint).toBeNull();
  });

  it('verändert die Eingabe nicht', () => {
    const input = [{ name: 'Mehl', quantity: 1, unit: 'kg' }] as const;
    aggregateIngredients(input);
    expect(input[0]?.quantity).toBe(1);
  });
});
