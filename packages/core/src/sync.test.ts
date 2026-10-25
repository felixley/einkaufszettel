import { describe, expect, it } from 'vitest';

import type { AddToListRequest } from './add-to-list.js';
import {
  createOutbox,
  enqueue,
  type AddToListEntry,
  type DeleteEntry,
  type OutboxEntry,
  type UpsertEntry,
} from './outbox.js';
import { replayOutbox, type SyncAdapter } from './sync.js';
import { InMemorySyncAdapter } from './testing/in-memory-adapter.js';
import { fixedClock, makeListItem, toRowData } from './testing/fixtures.js';
import type { IsoTimestamp, ListItem } from './types.js';

const T1 = '2026-01-01T00:00:01.000Z';
const T2 = '2026-01-01T00:00:02.000Z';
const T3 = '2026-01-01T00:00:03.000Z';
const T4 = '2026-01-01T00:00:04.000Z';

const ALL_FIELDS = Object.keys(makeListItem().fields);

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

function deleteEntry(id: string, rowId: string, clientTs: IsoTimestamp = T2): DeleteEntry {
  return {
    id,
    table: 'list_items',
    op: 'delete',
    payload: { id: rowId },
    client_ts: clientTs,
    attempts: 0,
  };
}

function addEntry(
  id: string,
  request: AddToListRequest,
  clientTs: IsoTimestamp = T2,
): AddToListEntry {
  return {
    id,
    table: 'list_items',
    op: 'add_to_list',
    payload: request,
    client_ts: clientTs,
    attempts: 0,
  };
}

function makeAdapter(): InMemorySyncAdapter {
  return new InMemorySyncAdapter({ now: fixedClock() });
}

describe('replayOutbox (idempotentes Replay)', () => {
  it('spielt einen Upsert ab, quittiert ihn und legt genau eine Zeile an', async () => {
    const adapter = makeAdapter();
    const entry = upsertEntry('e1', makeListItem({ id: 'item-1' }), ALL_FIELDS);

    const result = await replayOutbox(createOutbox([entry]), adapter);

    expect(result.applied).toEqual(['e1']);
    expect(result.failed).toEqual([]);
    expect(result.outbox.entries).toHaveLength(0);
    expect(adapter.allRows('list_items')).toHaveLength(1);
    expect(adapter.row('list_items', 'item-1')?.fields.name).toBe('Milch');
  });

  it('erzeugt bei 2× Abspielen derselben Outbox kein Duplikat', async () => {
    const adapter = makeAdapter();
    const original = createOutbox([upsertEntry('e1', makeListItem({ id: 'item-1' }), ALL_FIELDS)]);

    const first = await replayOutbox(original, adapter);
    const afterFirst = adapter.row('list_items', 'item-1');
    const second = await replayOutbox(original, adapter);
    const afterSecond = adapter.row('list_items', 'item-1');

    expect(first.applied).toEqual(['e1']);
    expect(second.applied).toEqual(['e1']);
    expect(adapter.allRows('list_items')).toHaveLength(1);
    expect(afterSecond).toEqual(afterFirst);
  });

  it('spielt eine bereits quittierte Outbox ein zweites Mal ohne Wirkung ab', async () => {
    const adapter = makeAdapter();
    const original = createOutbox([upsertEntry('e1', makeListItem({ id: 'item-1' }), ALL_FIELDS)]);
    const first = await replayOutbox(original, adapter);
    const snapshot = adapter.row('list_items', 'item-1');

    const second = await replayOutbox(first.outbox, adapter);

    expect(second.applied).toEqual([]);
    expect(adapter.allRows('list_items')).toHaveLength(1);
    expect(adapter.row('list_items', 'item-1')).toEqual(snapshot);
  });

  it('löst gleichzeitiges Abhaken zu genau einem Endzustand auf', async () => {
    const adapter = makeAdapter();
    await replayOutbox(
      createOutbox([
        upsertEntry('create', makeListItem({ id: 'item-1', checked: false }), ALL_FIELDS),
      ]),
      adapter,
    );

    const checkA = upsertEntry(
      'check-a',
      makeListItem({ id: 'item-1', checked: true, checked_by: 'user-a' }, { updated_at: T2 }),
      ['checked', 'checked_by'],
      T2,
    );
    const checkB = upsertEntry(
      'check-b',
      makeListItem({ id: 'item-1', checked: true, checked_by: 'user-b' }, { updated_at: T3 }),
      ['checked', 'checked_by'],
      T3,
    );
    const original = createOutbox([checkA, checkB]);

    const first = await replayOutbox(original, adapter);
    const active = adapter.activeRows('list_items');
    const afterFirst = adapter.row('list_items', 'item-1');

    expect(first.applied).toHaveLength(2);
    expect(active).toHaveLength(1);
    expect(active[0]?.fields.checked).toBe(true);

    const second = await replayOutbox(original, adapter);
    expect(second.applied).toHaveLength(2);
    expect(adapter.activeRows('list_items')).toHaveLength(1);
    expect(adapter.row('list_items', 'item-1')).toEqual(afterFirst);
  });

  it('ist bei wiederholtem Abhaken idempotent (checked bleibt true, Zeitstempel stabil)', async () => {
    const adapter = makeAdapter();
    await replayOutbox(
      createOutbox([
        upsertEntry('create', makeListItem({ id: 'item-1', checked: false }), ALL_FIELDS),
      ]),
      adapter,
    );
    const check = upsertEntry(
      'check',
      makeListItem({ id: 'item-1', checked: true, checked_by: 'user-a' }, { updated_at: T2 }),
      ['checked', 'checked_by'],
      T2,
    );

    await replayOutbox(createOutbox([check]), adapter);
    const snapshot = adapter.row('list_items', 'item-1');
    await replayOutbox(createOutbox([check]), adapter);

    expect(adapter.row('list_items', 'item-1')).toEqual(snapshot);
  });

  it('lässt Delete gegen Edit in beiden Abspielreihenfolgen gewinnen', async () => {
    const base = makeListItem({ id: 'item-1' });
    const edit = upsertEntry(
      'edit',
      makeListItem(
        { id: 'item-1', name: 'Vollmilch', name_normalized: 'vollmilch' },
        { updated_at: T3 },
      ),
      ['name', 'name_normalized'],
      T3,
    );
    const deletion = deleteEntry('delete', 'item-1', T2);

    for (const editFirst of [true, false]) {
      const adapter = makeAdapter();
      await replayOutbox(
        createOutbox([upsertEntry('create', base, ALL_FIELDS, '2026-01-01T00:00:00.000Z')]),
        adapter,
      );
      const entries: OutboxEntry[] = editFirst ? [edit, deletion] : [deletion, edit];

      await replayOutbox(createOutbox(entries), adapter);

      expect(adapter.row('list_items', 'item-1')?.deleted_at).not.toBeNull();
      expect(adapter.activeRows('list_items')).toHaveLength(0);
    }
  });

  it('legt für einen Delete ohne vorherigen Upsert einen Tombstone an und verhindert Wiederbelebung', async () => {
    const adapter = makeAdapter();
    const ghost = makeListItem({ id: 'ghost' });

    const result = await replayOutbox(
      createOutbox([
        deleteEntry('delete', 'ghost', T1),
        upsertEntry('edit', ghost, ALL_FIELDS, T2),
      ]),
      adapter,
    );

    expect(result.applied).toHaveLength(2);
    expect(adapter.tombstoneIds('list_items')).toContain('ghost');
    expect(adapter.allRows('list_items')).toHaveLength(0);
  });

  it('spielt beim Reconnect alle Einträge vollständig ab', async () => {
    const adapter = makeAdapter();
    const request: AddToListRequest = {
      request_id: 'req-1',
      list_id: 'list-1',
      name: 'Butter',
      quantity: 250,
      unit: 'g',
    };
    const outbox = createOutbox([
      upsertEntry('create-a', makeListItem({ id: 'a', name: 'Milch' }), ALL_FIELDS, T1),
      upsertEntry(
        'create-b',
        makeListItem({ id: 'b', name: 'Brot', unit: 'Stk', quantity: 1 }),
        ALL_FIELDS,
        T2,
      ),
      addEntry('add-c', request, T3),
    ]);

    const result = await replayOutbox(outbox, adapter);

    expect(result.applied).toEqual(['create-a', 'create-b', 'add-c']);
    expect(result.outbox.entries).toHaveLength(0);
    expect(result.deadLetter.entries).toHaveLength(0);
    expect(adapter.activeRows('list_items')).toHaveLength(3);
  });

  it('spielt einen Delete mehrfach ohne Zustandsänderung ab', async () => {
    const adapter = makeAdapter();
    await replayOutbox(
      createOutbox([upsertEntry('create', makeListItem({ id: 'item-1' }), ALL_FIELDS)]),
      adapter,
    );
    const deletion = createOutbox([deleteEntry('delete', 'item-1', T2)]);

    await replayOutbox(deletion, adapter);
    const snapshot = adapter.row('list_items', 'item-1');
    const second = await replayOutbox(deletion, adapter);

    expect(second.applied).toEqual(['delete']);
    expect(adapter.row('list_items', 'item-1')).toEqual(snapshot);
    expect(adapter.activeRows('list_items')).toHaveLength(0);
  });

  it('addiert eine add_to_list-RPC bei doppeltem Replay nur einmal', async () => {
    const adapter = makeAdapter();
    const request: AddToListRequest = {
      request_id: 'req-1',
      list_id: 'list-1',
      name: 'Milch',
      quantity: 2,
      unit: 'l',
    };
    const original = createOutbox([addEntry('add-1', request)]);

    await replayOutbox(original, adapter);
    const active = adapter.activeRows('list_items');
    expect(active).toHaveLength(1);
    expect(active[0]?.fields.quantity).toBe(2);

    await replayOutbox(original, adapter);

    expect(adapter.activeRows('list_items')).toHaveLength(1);
    expect(adapter.activeRows('list_items')[0]?.fields.quantity).toBe(2);
    expect(adapter.appliedRequestIds()).toEqual(['req-1']);
  });

  it('lässt fehlgeschlagene Einträge in der Outbox und verschiebt sie ab maxAttempts ins Dead-Letter', async () => {
    const failingAdapter: SyncAdapter = {
      upsert() {
        throw new Error('offline');
      },
      softDelete() {
        throw new Error('offline');
      },
      addToList() {
        throw new Error('offline');
      },
    };
    const original = createOutbox([upsertEntry('e1', makeListItem(), ALL_FIELDS)]);

    const first = await replayOutbox(original, failingAdapter, { maxAttempts: 2 });
    expect(first.failed).toHaveLength(1);
    expect(first.outbox.entries).toHaveLength(1);
    expect(first.outbox.entries[0]?.attempts).toBe(1);
    expect(first.deadLetter.entries).toHaveLength(0);

    const second = await replayOutbox(first.outbox, failingAdapter, { maxAttempts: 2 });
    expect(second.deadLettered).toEqual(['e1']);
    expect(second.outbox.entries).toHaveLength(0);
    expect(second.deadLetter.entries).toHaveLength(1);
    expect(second.deadLetter.entries[0]?.attempts).toBe(2);
  });

  it('wendet mehrere Einträge derselben Zeile in client_ts-Reihenfolge an', async () => {
    const adapter = makeAdapter();
    const outbox = createOutbox([
      upsertEntry(
        'later',
        makeListItem({ id: 'item-1', quantity: 5 }, { updated_at: T4 }),
        ['quantity'],
        T4,
      ),
      upsertEntry(
        'earlier',
        makeListItem(
          { id: 'item-1', name: 'Vollmilch', name_normalized: 'vollmilch' },
          { updated_at: T2 },
        ),
        ['name', 'name_normalized'],
        T2,
      ),
    ]);

    await replayOutbox(outbox, adapter);

    const row = adapter.row('list_items', 'item-1');
    expect(row?.fields.name).toBe('Vollmilch');
    expect(row?.fields.quantity).toBe(5);
  });

  it('fasst Einträge derselben Zeile schon beim Einreihen zusammen', () => {
    const row = makeListItem({ id: 'item-1' });
    const first = upsertEntry('e1', row, ['name'], T1);
    const second = upsertEntry('e2', makeListItem({ id: 'item-1', quantity: 3 }), ['quantity'], T2);
    const outbox = enqueue(enqueue(createOutbox(), first), second);

    expect(outbox.entries).toHaveLength(1);
  });
});
