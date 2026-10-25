import { describe, expect, it } from 'vitest';

import { applyCheck, resolveRow } from './conflict.js';
import { makeListItem } from './testing/fixtures.js';

const T2 = '2026-01-01T00:00:02.000Z';
const T3 = '2026-01-01T00:00:03.000Z';
const T5 = '2026-01-01T00:00:05.000Z';

describe('resolveRow (feldweises LWW)', () => {
  it('lässt Änderungen an unterschiedlichen Feldern beider Seiten überleben', () => {
    const local = makeListItem(
      { name: 'Vollmilch', name_normalized: 'vollmilch' },
      { field_updated_at: { name: T2, name_normalized: T2 } },
    );
    const remote = makeListItem({ quantity: 2 }, { field_updated_at: { quantity: T3 } });

    const result = resolveRow(local, remote);

    expect(result.resolution).toBe('merged');
    expect(result.row.fields.name).toBe('Vollmilch');
    expect(result.row.fields.quantity).toBe(2);
    expect([...result.changed_fields].sort()).toEqual(['name', 'name_normalized']);
  });

  it('gewinnt bei demselben Feld der jüngere Zeitstempel', () => {
    const local = makeListItem(
      { name: 'Vollmilch', name_normalized: 'vollmilch' },
      { updated_at: T3, field_updated_at: { name: T3, name_normalized: T3 } },
    );
    const remote = makeListItem(
      { name: 'Magermilch', name_normalized: 'magermilch' },
      { updated_at: T2, field_updated_at: { name: T2, name_normalized: T2 } },
    );

    const result = resolveRow(local, remote);

    expect(result.resolution).toBe('local');
    expect(result.row.fields.name).toBe('Vollmilch');
    expect([...result.changed_fields].sort()).toEqual(['name', 'name_normalized']);
  });

  it('lässt bei Zeitstempel-Gleichstand die Server-Seite (remote) gewinnen', () => {
    const local = makeListItem(
      { name: 'Vollmilch', name_normalized: 'vollmilch' },
      { updated_at: T2, field_updated_at: { name: T2, name_normalized: T2 } },
    );
    const remote = makeListItem(
      { name: 'Magermilch', name_normalized: 'magermilch' },
      { updated_at: T2, field_updated_at: { name: T2, name_normalized: T2 } },
    );

    const result = resolveRow(local, remote);

    expect(result.resolution).toBe('remote');
    expect(result.row.fields.name).toBe('Magermilch');
    expect(result.changed_fields).toEqual([]);
  });

  it('kann die Server-Seite für Tests auf local legen', () => {
    const local = makeListItem(
      { name: 'Vollmilch', name_normalized: 'vollmilch' },
      { updated_at: T2, field_updated_at: { name: T2, name_normalized: T2 } },
    );
    const remote = makeListItem(
      { name: 'Magermilch', name_normalized: 'magermilch' },
      { updated_at: T2, field_updated_at: { name: T2, name_normalized: T2 } },
    );

    const result = resolveRow(local, remote, { serverSide: 'local' });

    expect(result.row.fields.name).toBe('Vollmilch');
  });

  it('lässt Delete gegen eine neuere Bearbeitung gewinnen', () => {
    const local = makeListItem(
      { name: 'Vollmilch', name_normalized: 'vollmilch' },
      { updated_at: T5, field_updated_at: { name: T5 } },
    );
    const remote = makeListItem({}, { updated_at: T2, deleted_at: T2 });

    const result = resolveRow(local, remote);

    expect(result.resolution).toBe('deleted');
    expect(result.row.deleted_at).toBe(T2);
    expect(result.changed_fields).toContain('name');
  });

  it('behält den Löschzeitpunkt, wenn lokal gelöscht und remote später bearbeitet wurde', () => {
    const local = makeListItem({}, { updated_at: T2, deleted_at: T2 });
    const remote = makeListItem(
      { name: 'Vollmilch', name_normalized: 'vollmilch' },
      { updated_at: T5, field_updated_at: { name: T5 } },
    );

    const result = resolveRow(local, remote);

    expect(result.resolution).toBe('deleted');
    expect(result.row.deleted_at).toBe(T2);
    expect(result.changed_fields).toContain('deleted_at');
  });

  it('behält bei beidseitigem Löschen den frühesten Löschzeitpunkt', () => {
    const local = makeListItem({}, { updated_at: T5, deleted_at: T5 });
    const remote = makeListItem({}, { updated_at: T3, deleted_at: T3 });

    expect(resolveRow(local, remote).row.deleted_at).toBe(T3);
  });

  it('meldet unveränderte Stände als unchanged', () => {
    const row = makeListItem();
    const result = resolveRow(row, row);

    expect(result.resolution).toBe('unchanged');
    expect(result.changed_fields).toEqual([]);
    expect(result.row.fields).toEqual(row.fields);
  });

  it('wirft bei ungültigen Zeitstempeln', () => {
    const local = makeListItem({}, { updated_at: 'kein-iso-datum' });
    expect(() => resolveRow(local, makeListItem())).toThrow(/Ungültiger Zeitstempel/);
  });
});

describe('applyCheck (idempotentes Abhaken)', () => {
  it('setzt checked und checked_by', () => {
    const base = makeListItem({ checked: false, checked_by: null });
    const checked = applyCheck(base, true, { at: T2, by: 'user-a' });

    expect(checked.fields.checked).toBe(true);
    expect(checked.fields.checked_by).toBe('user-a');
    expect(checked.updated_at).toBe(T2);
    expect(checked.field_updated_at.checked).toBe(T2);
  });

  it('ist idempotent: erneutes Abhaken ändert nichts (gleiche Referenz)', () => {
    const checked = applyCheck(makeListItem({ checked: false }), true, { at: T2, by: 'user-a' });
    const again = applyCheck(checked, true, { at: T3, by: 'user-a' });

    expect(again).toBe(checked);
    expect(again.updated_at).toBe(T2);
  });

  it('setzt beim Entfernen des Häkchens checked_by zurück', () => {
    const checked = applyCheck(makeListItem({ checked: false }), true, { at: T2, by: 'user-a' });
    const unchecked = applyCheck(checked, false, { at: T3, by: 'user-a' });

    expect(unchecked.fields.checked).toBe(false);
    expect(unchecked.fields.checked_by).toBeNull();
  });

  it('lässt gelöschte Items unverändert', () => {
    const deleted = makeListItem({}, { deleted_at: T2 });
    expect(applyCheck(deleted, true, { at: T3, by: 'user-a' })).toBe(deleted);
  });
});
