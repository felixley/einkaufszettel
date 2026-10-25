import { describe, expect, it } from 'vitest';

import type { AddToListRequest } from './add-to-list.js';
import {
  acknowledge,
  createOutbox,
  enqueue,
  pending,
  recordFailure,
  type AddToListEntry,
  type DeleteEntry,
  type UpsertEntry,
} from './outbox.js';
import { makeListItem, toRowData } from './testing/fixtures.js';
import type { IsoTimestamp, ListItem } from './types.js';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:00:01.000Z';
const T2 = '2026-01-01T00:00:02.000Z';
const T3 = '2026-01-01T00:00:03.000Z';

function upsertEntry(
  id: string,
  row: ListItem,
  changedFields: readonly string[],
  clientTs: IsoTimestamp = T1,
): UpsertEntry {
  return {
    id,
    table: 'list_items',
    op: 'upsert',
    payload: { row: toRowData(row), changed_fields: changedFields },
    client_ts: clientTs,
    attempts: 0,
  };
}

function deleteEntry(id: string, rowId: string, clientTs: IsoTimestamp = T1): DeleteEntry {
  return {
    id,
    table: 'list_items',
    op: 'delete',
    payload: { id: rowId },
    client_ts: clientTs,
    attempts: 0,
  };
}

const request: AddToListRequest = {
  request_id: 'req-1',
  list_id: 'list-1',
  name: 'Milch',
  quantity: 2,
  unit: 'l',
};

function addEntry(
  id: string,
  payload: AddToListRequest,
  clientTs: IsoTimestamp = T1,
): AddToListEntry {
  return { id, table: 'list_items', op: 'add_to_list', payload, client_ts: clientTs, attempts: 0 };
}

describe('Outbox-Queue', () => {
  it('startet leer', () => {
    expect(createOutbox().entries).toHaveLength(0);
  });

  it('ignoriert doppeltes Einreihen derselben Entry-ID (idempotent)', () => {
    const entry = upsertEntry('e1', makeListItem(), ['name']);
    const once = enqueue(createOutbox(), entry);
    const twice = enqueue(once, entry);

    expect(once.entries).toHaveLength(1);
    expect(twice).toBe(once);
  });

  it('fasst mehrere Upserts derselben Zeile zu einem Eintrag zusammen', () => {
    const first = upsertEntry(
      'e1',
      makeListItem(
        { name: 'Vollmilch', name_normalized: 'vollmilch' },
        { field_updated_at: { name: T1 } },
      ),
      ['name', 'name_normalized'],
      T1,
    );
    const second = upsertEntry(
      'e2',
      makeListItem(
        { name: 'Vollmilch', name_normalized: 'vollmilch', quantity: 2 },
        { field_updated_at: { quantity: T2 } },
      ),
      ['quantity'],
      T2,
    );

    const outbox = enqueue(enqueue(createOutbox(), first), second);

    expect(outbox.entries).toHaveLength(1);
    const only = outbox.entries[0];
    expect(only?.op).toBe('upsert');
    if (only?.op !== 'upsert') throw new Error('upsert erwartet');
    expect([...only.payload.changed_fields].sort()).toEqual([
      'name',
      'name_normalized',
      'quantity',
    ]);
    expect(only.payload.row.quantity).toBe(2);
  });

  it('lässt Delete gegen Edit gewinnen (Upsert danach wird verworfen)', () => {
    const upsert = upsertEntry('e1', makeListItem({ name: 'Vollmilch' }), ['name'], T1);
    const deletion = deleteEntry('e2', 'item-1', T2);
    const lateEdit = upsertEntry('e3', makeListItem({ name: 'Magermilch' }), ['name'], T3);

    const outbox = enqueue(enqueue(enqueue(createOutbox(), upsert), deletion), lateEdit);

    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]?.op).toBe('delete');
  });

  it('verdrängt bei Delete alle offenen Upserts derselben Zeile', () => {
    const upsert = upsertEntry('e1', makeListItem(), ['name'], T1);
    const deletion = deleteEntry('e2', 'item-1', T2);

    const outbox = enqueue(enqueue(createOutbox(), upsert), deletion);

    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]?.op).toBe('delete');
  });

  it('dedupliziert add_to_list über request_id', () => {
    const first = addEntry('e1', request, T1);
    const second = addEntry('e2', request, T2);

    const outbox = enqueue(enqueue(createOutbox(), first), second);

    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]?.id).toBe('e1');
  });

  it('hält add_to_list mit unterschiedlichen request_ids getrennt', () => {
    const first = addEntry('e1', request, T1);
    const second = addEntry('e2', { ...request, request_id: 'req-2' }, T2);

    expect(enqueue(enqueue(createOutbox(), first), second).entries).toHaveLength(2);
  });

  it('quittiert Einträge und entfernt sie', () => {
    const outbox = enqueue(
      enqueue(createOutbox(), upsertEntry('e1', makeListItem(), ['name'])),
      deleteEntry('e2', 'x'),
    );
    expect(acknowledge(outbox, ['e1']).entries.map((entry) => entry.id)).toEqual(['e2']);
  });

  it('sortiert pending nach client_ts und dann nach id', () => {
    const outbox = createOutbox([
      upsertEntry('b', makeListItem({}, { id: 'b' }), ['name'], T2),
      upsertEntry('c', makeListItem({}, { id: 'c' }), ['name'], T1),
      upsertEntry('a', makeListItem({}, { id: 'a' }), ['name'], T1),
    ]);

    expect(pending(outbox).map((entry) => entry.id)).toEqual(['a', 'c', 'b']);
  });

  it('erhöht attempts und verschiebt erst ab maxAttempts ins Dead-Letter', () => {
    const outbox = createOutbox([upsertEntry('e1', makeListItem(), ['name'])]);

    const first = recordFailure(outbox, 'e1', 2);
    expect(first.deadLettered).toBeNull();
    expect(first.outbox.entries[0]?.attempts).toBe(1);

    const second = recordFailure(first.outbox, 'e1', 2);
    expect(second.outbox.entries).toHaveLength(0);
    expect(second.deadLettered?.id).toBe('e1');
    expect(second.deadLettered?.attempts).toBe(2);
  });

  it('ignoriert recordFailure für unbekannte IDs', () => {
    const outbox = createOutbox();
    expect(recordFailure(outbox, 'unbekannt').outbox).toBe(outbox);
  });

  it('behält bei client_ts-Gleichstand die deterministische id-Ordnung', () => {
    const outbox = createOutbox([upsertEntry('z', makeListItem({}, { id: 'z' }), ['name'], T0)]);
    expect(pending(outbox)[0]?.client_ts).toBe(T0);
  });
});
