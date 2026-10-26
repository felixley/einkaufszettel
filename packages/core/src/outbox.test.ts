import { describe, expect, it } from 'vitest';

import type { AddToListRequest } from './add-to-list.js';
import {
  acknowledge,
  BASE_RETRY_DELAY_MS,
  createOutbox,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_MAX_DELAY_MS,
  enqueue,
  nextRetryDelayMs,
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

describe('Backoff-Policy (T4.3a)', () => {
  const fixedNow = () => '2026-01-01T00:00:00.000Z';

  it('liefert die exponentielle Basissequenz und deckelt bei 60 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map((attempts) => nextRetryDelayMs(attempts))).toEqual([
      BASE_RETRY_DELAY_MS,
      BASE_RETRY_DELAY_MS,
      2_000,
      4_000,
      8_000,
      16_000,
      32_000,
      DEFAULT_RETRY_MAX_DELAY_MS,
      DEFAULT_RETRY_MAX_DELAY_MS,
    ]);
  });

  it('behandelt attempts 0 und 1 identisch als erste Wartezeit', () => {
    expect(nextRetryDelayMs(0)).toBe(BASE_RETRY_DELAY_MS);
    expect(nextRetryDelayMs(1)).toBe(BASE_RETRY_DELAY_MS);
  });

  it('wendet optionalen Jitter mit injizierter rand-Funktion deterministisch an', () => {
    expect(nextRetryDelayMs(1, { jitter: true, rand: () => 0 })).toBe(800);
    expect(nextRetryDelayMs(1, { jitter: true, rand: () => 0.5 })).toBe(1_000);
    expect(nextRetryDelayMs(1, { jitter: true, rand: () => 1 })).toBe(1_200);
  });

  it('deckelt auch den gejitterten Wert bei 60 s', () => {
    expect(nextRetryDelayMs(7, { jitter: true, rand: () => 0 })).toBe(48_000);
    expect(nextRetryDelayMs(7, { jitter: true, rand: () => 1 })).toBe(DEFAULT_RETRY_MAX_DELAY_MS);
    expect(nextRetryDelayMs(7)).toBe(DEFAULT_RETRY_MAX_DELAY_MS);
  });

  it('lässt Jitter standardmäßig aus und ignoriert rand ohne jitter=true', () => {
    expect(nextRetryDelayMs(3, { rand: () => 0 })).toBe(4_000);
    expect(nextRetryDelayMs(3)).toBe(4_000);
  });

  it('erlaubt einen benutzerdefinierten maxDelayMs-Deckel', () => {
    expect(nextRetryDelayMs(10, { maxDelayMs: 5_000 })).toBe(5_000);
    expect(nextRetryDelayMs(10, { maxDelayMs: 5_000, jitter: true, rand: () => 1 })).toBe(5_000);
  });

  it('wirft bei ungültigem attempts oder rand einen RangeError', () => {
    expect(() => nextRetryDelayMs(-1)).toThrow(RangeError);
    expect(() => nextRetryDelayMs(Number.NaN)).toThrow(RangeError);
    expect(() => nextRetryDelayMs(1, { jitter: true, rand: () => 1.1 })).toThrow(RangeError);
  });

  it('setzt bei einem Fehlversuch attempts+1 und next_attempt_at aus fester Uhr', () => {
    const outbox = createOutbox([upsertEntry('e1', makeListItem(), ['name'])]);
    const result = recordFailure(outbox, 'e1', DEFAULT_MAX_ATTEMPTS, { now: fixedNow });

    expect(result.deadLettered).toBeNull();
    expect(result.outbox.entries).toHaveLength(1);
    expect(result.outbox.entries[0]?.attempts).toBe(1);
    expect(result.outbox.entries[0]?.next_attempt_at).toBe('2026-01-01T00:00:01.000Z');
  });

  it('folgt der Backoff-Sequenz bei wiederholten Fehlversuchen', () => {
    let outbox = createOutbox([upsertEntry('e1', makeListItem(), ['name'])]);
    const retryTimes: (string | undefined)[] = [];

    for (let i = 0; i < 4; i += 1) {
      const result = recordFailure(outbox, 'e1', DEFAULT_MAX_ATTEMPTS, { now: fixedNow });
      expect(result.deadLettered).toBeNull();
      outbox = result.outbox;
      retryTimes.push(outbox.entries[0]?.next_attempt_at);
    }

    expect(retryTimes).toEqual([
      '2026-01-01T00:00:01.000Z',
      '2026-01-01T00:00:02.000Z',
      '2026-01-01T00:00:04.000Z',
      '2026-01-01T00:00:08.000Z',
    ]);
  });

  it('verschiebt nach 5 Fehlversuchen ins Dead-Letter und hinterlegt den Fehlertext', () => {
    let outbox = createOutbox([upsertEntry('e1', makeListItem(), ['name'])]);
    for (let i = 0; i < 4; i += 1) {
      const result = recordFailure(outbox, 'e1', DEFAULT_MAX_ATTEMPTS, { now: fixedNow });
      expect(result.deadLettered).toBeNull();
      outbox = result.outbox;
    }

    const final = recordFailure(outbox, 'e1', DEFAULT_MAX_ATTEMPTS, {
      now: fixedNow,
      lastError: 'offline',
    });

    expect(final.outbox.entries).toHaveLength(0);
    expect(final.deadLettered?.id).toBe('e1');
    expect(final.deadLettered?.attempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(final.deadLettered?.last_error).toBe('offline');
  });

  it('setzt last_error nicht, wenn kein Fehlertext übergeben wurde', () => {
    let outbox = createOutbox([upsertEntry('e1', makeListItem(), ['name'])]);
    for (let i = 0; i < 4; i += 1) {
      outbox = recordFailure(outbox, 'e1', DEFAULT_MAX_ATTEMPTS, { now: fixedNow }).outbox;
    }

    const final = recordFailure(outbox, 'e1', DEFAULT_MAX_ATTEMPTS, { now: fixedNow });

    expect(final.deadLettered).not.toBeNull();
    expect(Object.hasOwn(final.deadLettered ?? {}, 'last_error')).toBe(false);
  });

  it('akzeptiert eine Clock, die ein Date liefert', () => {
    const outbox = createOutbox([upsertEntry('e1', makeListItem(), ['name'])]);
    const result = recordFailure(outbox, 'e1', DEFAULT_MAX_ATTEMPTS, {
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(result.outbox.entries[0]?.next_attempt_at).toBe('2026-01-01T00:00:01.000Z');
  });

  it('wendet Jitter auch beim Scheduling an', () => {
    const outbox = createOutbox([upsertEntry('e1', makeListItem(), ['name'])]);
    const result = recordFailure(outbox, 'e1', DEFAULT_MAX_ATTEMPTS, {
      now: fixedNow,
      backoff: { jitter: true, rand: () => 0 },
    });

    expect(result.outbox.entries[0]?.next_attempt_at).toBe('2026-01-01T00:00:00.800Z');
  });

  it('ist idempotent für unbekannte IDs und verändert die Outbox nicht', () => {
    const outbox = createOutbox();
    const first = recordFailure(outbox, 'unbekannt', DEFAULT_MAX_ATTEMPTS, { now: fixedNow });
    const second = recordFailure(outbox, 'unbekannt', DEFAULT_MAX_ATTEMPTS, { now: fixedNow });

    expect(first.outbox).toBe(outbox);
    expect(first.deadLettered).toBeNull();
    expect(second.outbox).toBe(outbox);
  });
});
