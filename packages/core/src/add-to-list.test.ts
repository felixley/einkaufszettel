import { describe, expect, it } from 'vitest';

import { addToList, type AddToListContext, type AddToListRequest } from './add-to-list.js';
import { makeListItem } from './testing/fixtures.js';

const T1 = '2026-01-01T00:00:01.000Z';
const T2 = '2026-01-01T00:00:02.000Z';

const baseRequest: AddToListRequest = {
  request_id: 'req-1',
  list_id: 'list-1',
  name: 'Milch',
  quantity: 0.5,
  unit: 'l',
};

function context(overrides: Partial<AddToListContext> = {}): AddToListContext {
  return {
    now: T2,
    applied_request_ids: new Set<string>(),
    generate_id: () => 'new-item',
    ...overrides,
  };
}

describe('addToList (RPC-Mengenaggregation)', () => {
  it('legt eine neue Zeile an, wenn kein passender Artikel existiert', () => {
    const outcome = addToList([], baseRequest, context());

    expect(outcome.created).toBe(true);
    expect(outcome.duplicate).toBe(false);
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.id).toBe('new-item');
    expect(outcome.rows[0]?.fields.name).toBe('Milch');
    expect(outcome.rows[0]?.fields.name_normalized).toBe('milch');
    expect(outcome.rows[0]?.fields.quantity).toBe(0.5);
    expect(outcome.rows[0]?.fields.checked).toBe(false);
    expect(outcome.rows[0]?.updated_at).toBe(T2);
    expect(outcome.applied_request_ids.has('req-1')).toBe(true);
  });

  it('verändert die Eingabe nicht (rein)', () => {
    const rows: ReturnType<typeof makeListItem>[] = [];
    addToList(rows, baseRequest, context());
    expect(rows).toHaveLength(0);
  });

  it('addiert auf eine vorhandene Zeile mit gleicher Einheit', () => {
    const base = makeListItem({ quantity: 1, unit: 'l' });
    const outcome = addToList([base], baseRequest, context());

    expect(outcome.created).toBe(false);
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.fields.quantity).toBe(1.5);
    expect(outcome.affected?.id).toBe('item-1');
    expect(outcome.rows[0]?.updated_at).toBe(T2);
    expect(outcome.rows[0]?.field_updated_at.quantity).toBe(T2);
    expect(base.fields.quantity).toBe(1);
  });

  it('rechnet innerhalb der Masse-Dimension in die Zeilen-Einheit um', () => {
    const base = makeListItem({ quantity: 1, unit: 'kg' });
    const request: AddToListRequest = { ...baseRequest, quantity: 500, unit: 'g' };

    const outcome = addToList([base], request, context());

    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.fields.quantity).toBe(1.5);
    expect(outcome.rows[0]?.fields.unit).toBe('kg');
  });

  it('rechnet innerhalb der Volumen-Dimension in die Zeilen-Einheit um', () => {
    const base = makeListItem({ quantity: 1, unit: 'l' });
    const request: AddToListRequest = { ...baseRequest, quantity: 1, unit: 'EL' };

    const outcome = addToList([base], request, context());

    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.fields.quantity).toBe(1.015);
  });

  it('legt bei unterschiedlicher Dimension eine eigene Zeile an', () => {
    const base = makeListItem({ quantity: 1, unit: 'l' });
    const request: AddToListRequest = { ...baseRequest, quantity: 2, unit: 'Stk' };

    const outcome = addToList([base], request, context());

    expect(outcome.created).toBe(true);
    expect(outcome.rows).toHaveLength(2);
    expect(outcome.affected?.fields.unit).toBe('Stk');
  });

  it('legt bei anderem Namen eine eigene Zeile an', () => {
    const base = makeListItem({ quantity: 1, unit: 'l' });
    const request: AddToListRequest = { ...baseRequest, name: 'Butter', quantity: 250, unit: 'g' };

    expect(addToList([base], request, context()).rows).toHaveLength(2);
  });

  it('normalisiert den Namen für den Vergleich', () => {
    const base = makeListItem({ quantity: 1, unit: 'l' });
    const request: AddToListRequest = { ...baseRequest, name: '  MILCH  ' };

    expect(addToList([base], request, context()).rows).toHaveLength(1);
  });

  it('aggregiert Stück-Einheiten nur bei identischer Einheit', () => {
    const base = makeListItem({ quantity: 1, unit: 'Stk' });
    const request: AddToListRequest = { ...baseRequest, quantity: 2, unit: 'Bund' };

    expect(addToList([base], request, context()).rows).toHaveLength(2);
  });

  it('aggregiert Zeilen ohne Einheit untereinander', () => {
    const base = makeListItem({ quantity: 2, unit: null });
    const request: AddToListRequest = { ...baseRequest, quantity: 3, unit: null };

    const outcome = addToList([base], request, context());
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.fields.quantity).toBe(5);
  });

  it('ist idempotent über request_id (kein doppeltes Aufaddieren)', () => {
    const base = makeListItem({ quantity: 1, unit: 'l' });
    const outcome = addToList(
      [base],
      baseRequest,
      context({ applied_request_ids: new Set(['req-1']) }),
    );

    expect(outcome.duplicate).toBe(true);
    expect(outcome.created).toBe(false);
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.fields.quantity).toBe(1);
    expect(outcome.affected?.id).toBe('item-1');
  });

  it('lässt ein bereits abgehaktes Item abgehakt', () => {
    const base = makeListItem({ quantity: 1, unit: 'l', checked: true, checked_by: 'user-a' });
    const outcome = addToList([base], baseRequest, context());

    expect(outcome.rows[0]?.fields.checked).toBe(true);
    expect(outcome.rows[0]?.fields.checked_by).toBe('user-a');
  });

  it('ignoriert gelöschte Zeilen und legt eine neue an', () => {
    const deleted = makeListItem({ quantity: 5, unit: 'l' }, { deleted_at: T1 });
    const outcome = addToList([deleted], baseRequest, context());

    expect(outcome.created).toBe(true);
    expect(outcome.rows).toHaveLength(2);
    expect(outcome.rows[0]).toBe(deleted);
  });

  it('rundet Mengen auf drei Nachkommastellen', () => {
    const base = makeListItem({ quantity: 0.1, unit: 'l' });
    const request: AddToListRequest = { ...baseRequest, quantity: 0.2 };

    expect(addToList([base], request, context()).rows[0]?.fields.quantity).toBe(0.3);
  });

  it('verliert bei sequenzieller Anwendung keine Mengen (atomare RPC)', () => {
    const first = addToList([], { ...baseRequest, request_id: 'r1', quantity: 2 }, context());
    const second = addToList(
      first.rows,
      { ...baseRequest, request_id: 'r2', quantity: 3 },
      context(),
    );

    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.fields.quantity).toBe(5);
  });

  it('validiert Eingaben', () => {
    expect(() => addToList([], { ...baseRequest, quantity: 0 }, context())).toThrow(RangeError);
    expect(() => addToList([], { ...baseRequest, quantity: -1 }, context())).toThrow(RangeError);
    expect(() => addToList([], { ...baseRequest, quantity: Number.NaN }, context())).toThrow(
      RangeError,
    );
    expect(() => addToList([], { ...baseRequest, name: '   ' }, context())).toThrow(TypeError);
    expect(() => addToList([], { ...baseRequest, request_id: ' ' }, context())).toThrow(TypeError);
    expect(() => addToList([], { ...baseRequest, list_id: '' }, context())).toThrow(TypeError);
  });
});
