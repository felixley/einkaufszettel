import 'fake-indexeddb/auto';

import {
  replayOutbox,
  type ListItem,
  type ListItemRowData,
  type SyncAdapter,
  type UpsertEntry,
} from '@einkaufszettel/core';
import { InMemorySyncAdapter } from '@einkaufszettel/core/testing/in-memory-adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EinkaufszettelDB } from './database';
import {
  checkItemLocal,
  createItemLocal,
  deleteItemLocal,
  discardDeadLetter,
  getActiveItems,
  getItem,
  mergeRemoteItem,
  readDeadLetters,
  readOutbox,
  retryDeadLetter,
  saveReplayResult,
  updateItemLocal,
} from './repository';

const T1 = '2026-01-01T00:00:01.000Z';
const T2 = '2026-01-01T00:00:02.000Z';
const T3 = '2026-01-01T00:00:03.000Z';

let db: EinkaufszettelDB;
let adapter: InMemorySyncAdapter;

beforeEach(async () => {
  db = new EinkaufszettelDB(`einkaufszettel-test-${crypto.randomUUID()}`);
  await db.open();
  adapter = new InMemorySyncAdapter();
});

afterEach(async () => {
  await db.delete();
});

async function flushOutbox(now: string): Promise<void> {
  const result = await replayOutbox(await readOutbox(db), adapter);
  await saveReplayResult(db, result, now);
}

async function adapterRow(id: string): Promise<ListItem> {
  const row = adapter.row('list_items', id);
  if (row === undefined) throw new Error(`Adapter-Zeile ${id} fehlt`);
  return row;
}

function rowData(row: ListItem, patch: Partial<ListItemRowData> = {}): ListItemRowData {
  return { id: row.id, ...row.fields, ...patch };
}

describe('Repository: lokale Schreibvorgänge', () => {
  it('legt Artikel in Dexie an und reiht genau einen Upsert ein', async () => {
    const item = await createItemLocal(
      db,
      { list_id: 'liste-1', name: 'Tomaten', quantity: 3, unit: 'Stk' },
      T1,
    );

    expect(item.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await getActiveItems(db, 'liste-1')).toHaveLength(1);

    const outbox = await readOutbox(db);
    expect(outbox.entries).toHaveLength(1);
    const entry = outbox.entries[0] as UpsertEntry;
    expect(entry.op).toBe('upsert');
    expect(entry.payload.changed_fields).toContain('name');
    expect(entry.payload.row.name).toBe('Tomaten');
  });

  it('führt mehrere Änderungen an derselben Zeile zu einem Outbox-Eintrag zusammen', async () => {
    const item = await createItemLocal(db, { list_id: 'liste-1', name: 'Milch' }, T1);
    await flushOutbox(T1);

    await updateItemLocal(db, item.id, { quantity: 2, unit: 'l' }, T2);
    await updateItemLocal(db, item.id, { note: 'fettarm' }, T3);

    const outbox = await readOutbox(db);
    expect(outbox.entries).toHaveLength(1);
    const entry = outbox.entries[0] as UpsertEntry;
    expect(entry.payload.row.quantity).toBe(2);
    expect(entry.payload.row.note).toBe('fettarm');
    expect(new Set(entry.payload.changed_fields)).toEqual(new Set(['quantity', 'unit', 'note']));
  });

  it('Abhaken ist idempotent und erzeugt beim zweiten Aufruf keinen Eintrag', async () => {
    const item = await createItemLocal(db, { list_id: 'liste-1', name: 'Brot' }, T1);
    await flushOutbox(T1);

    const first = await checkItemLocal(db, item.id, true, T2, 'nutzer-a');
    expect(first?.fields.checked).toBe(true);
    expect((await readOutbox(db)).entries).toHaveLength(1);

    await flushOutbox(T2);
    const second = await checkItemLocal(db, item.id, true, T3, 'nutzer-b');
    expect(second?.fields.checked_by).toBe('nutzer-a');
    expect((await readOutbox(db)).entries).toHaveLength(0);
  });

  it('Delete verdrängt offene Upserts und wird idempotent wiederholt', async () => {
    const item = await createItemLocal(db, { list_id: 'liste-1', name: 'Eier' }, T1);
    await flushOutbox(T1);
    await updateItemLocal(db, item.id, { quantity: 6 }, T2);

    expect((await readOutbox(db)).entries).toHaveLength(1);
    await deleteItemLocal(db, item.id, T3);

    const outbox = await readOutbox(db);
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]?.op).toBe('delete');
    expect(await getActiveItems(db, 'liste-1')).toHaveLength(0);

    await deleteItemLocal(db, item.id, T3);
    expect((await readOutbox(db)).entries).toHaveLength(1);
  });
});

describe('Repository: Konfliktfälle (AK)', () => {
  it('Edit vs. Delete: Löschen gewinnt, ein nachlaufender Upsert belebt nicht', async () => {
    const item = await createItemLocal(db, { list_id: 'liste-1', name: 'Joghurt' }, T1);
    await flushOutbox(T1);
    await updateItemLocal(db, item.id, { quantity: 4 }, T2);

    adapter.softDelete('list_items', item.id);
    await flushOutbox(T3);

    const serverRow = await adapterRow(item.id);
    expect(serverRow.deleted_at).not.toBeNull();
    expect((await readOutbox(db)).entries).toHaveLength(0);
  });

  it('gleichzeitiges Abhaken auf zwei Geräten endet in einem Zustand', async () => {
    const item = await createItemLocal(db, { list_id: 'liste-1', name: 'Kaffee' }, T1);
    await flushOutbox(T1);

    // Gerät A hakt lokal ab.
    await checkItemLocal(db, item.id, true, T2, 'geraet-a');

    // Gerät B schreibt direkt auf den „Server“.
    const base = await adapterRow(item.id);
    adapter.upsert('list_items', rowData(base, { checked: true, checked_by: 'geraet-b' }), [
      'checked',
      'checked_by',
    ]);

    await flushOutbox(T3);

    const serverRow = await adapterRow(item.id);
    expect(serverRow.deleted_at).toBeNull();
    expect(serverRow.fields.checked).toBe(true);
    expect(adapter.activeRows('list_items')).toHaveLength(1);
  });

  it('Realtime überschreibt keine noch nicht übertragenen lokalen Felder', async () => {
    const item = await createItemLocal(db, { list_id: 'liste-1', name: 'Tomaten' }, T1);
    await flushOutbox(T1);

    // Lokale, noch nicht übertragene Änderung (dirty).
    await updateItemLocal(db, item.id, { quantity: 2, unit: 'Stk' }, T2);

    // Realtime-Event eines anderen Geräts ändert nur den Namen.
    const base = await adapterRow(item.id);
    const remote: ListItem = {
      ...base,
      updated_at: T3,
      field_updated_at: {
        list_id: T3,
        name: T3,
        name_normalized: T3,
        quantity: T3,
        unit: T3,
        category_id: T3,
        checked: T3,
        checked_by: T3,
        source_recipe_id: T3,
        note: T3,
      },
      fields: { ...base.fields, name: 'Tomaten frisch', name_normalized: 'tomaten frisch' },
    };

    const merged = await mergeRemoteItem(db, remote);
    expect(merged.item.fields.name).toBe('Tomaten frisch');
    expect(merged.item.fields.quantity).toBe(2);
    expect(merged.item.fields.unit).toBe('Stk');

    // Der ausstehende Upsert trägt den zusammengeführten Stand zum Server.
    await flushOutbox(T3);
    const serverRow = await adapterRow(item.id);
    expect(serverRow.fields.name).toBe('Tomaten frisch');
    expect(serverRow.fields.quantity).toBe(2);
  });

  it('doppeltes Replay der Outbox erzeugt keine Duplikate', async () => {
    await createItemLocal(db, { list_id: 'liste-1', name: 'Reis' }, T1);
    await flushOutbox(T1);

    const second = await replayOutbox(await readOutbox(db), adapter);
    expect(second.applied).toHaveLength(0);
    expect(adapter.activeRows('list_items')).toHaveLength(1);
  });

  it('Merge einer gelöschten Server-Zeile setzt den lokalen Tombstone', async () => {
    const item = await createItemLocal(db, { list_id: 'liste-1', name: 'Butter' }, T1);
    await flushOutbox(T1);

    const base = await adapterRow(item.id);
    const deleted: ListItem = { ...base, deleted_at: T2, updated_at: T2 };
    const merged = await mergeRemoteItem(db, deleted);

    expect(merged.resolution).toBe('deleted');
    expect((await getItem(db, item.id))?.deleted_at).toBe(T2);
  });
});

describe('Repository: Dead-Letter-Verwaltung (T4.3)', () => {
  class AlwaysFailAdapter implements SyncAdapter {
    upsert(): void {
      throw new Error('Server nicht erreichbar');
    }
    softDelete(): void {
      throw new Error('Server nicht erreichbar');
    }
    addToList(): void {
      throw new Error('Server nicht erreichbar');
    }
  }

  async function createDeadLetter(): Promise<string> {
    const failing = new AlwaysFailAdapter();
    await createItemLocal(db, { list_id: 'liste-1', name: 'Kakao' }, T1);
    const result = await replayOutbox(await readOutbox(db), failing, { maxAttempts: 1 });
    await saveReplayResult(db, result, T2);
    const dead = await readDeadLetters(db);
    expect(dead).toHaveLength(1);
    return dead[0]!.id;
  }

  it('retryDeadLetter reiht den Eintrag mit attempts=0 und ohne Backoff wieder ein', async () => {
    const deadId = await createDeadLetter();

    const retried = await retryDeadLetter(db, deadId);
    expect(retried).toBe(true);
    expect(await readDeadLetters(db)).toHaveLength(0);

    const outbox = await readOutbox(db);
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]?.id).toBe(deadId);
    expect(outbox.entries[0]?.attempts).toBe(0);
    expect(outbox.entries[0]?.next_attempt_at).toBeUndefined();
    expect(outbox.entries[0]?.last_error).toBeUndefined();
  });

  it('discardDeadLetter entfernt den Eintrag dauerhaft', async () => {
    const deadId = await createDeadLetter();

    const discarded = await discardDeadLetter(db, deadId);
    expect(discarded).toBe(true);
    expect(await readDeadLetters(db)).toHaveLength(0);
    expect((await readOutbox(db)).entries).toHaveLength(0);
  });

  it('meldet false fuer unbekannte Dead-Letter-IDs', async () => {
    expect(await retryDeadLetter(db, 'unbekannt')).toBe(false);
    expect(await discardDeadLetter(db, 'unbekannt')).toBe(false);
  });
});
