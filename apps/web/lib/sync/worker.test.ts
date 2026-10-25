import 'fake-indexeddb/auto';

import type { ListItem, SyncAdapter } from '@einkaufszettel/core';
import { InMemorySyncAdapter } from '@einkaufszettel/core/testing/in-memory-adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EinkaufszettelDB } from '../db/database';
import { countDeadLetters, countPending, createItemLocal, getItem } from '../db/repository';
import type { SyncStatus } from './status';
import { SyncWorker } from './worker';

const T1 = '2026-01-01T00:00:01.000Z';
const T2 = '2026-01-01T00:00:02.000Z';
const T3 = '2026-01-01T00:00:03.000Z';

class FailingAdapter implements SyncAdapter {
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

let db: EinkaufszettelDB;

beforeEach(async () => {
  db = new EinkaufszettelDB(`worker-test-${crypto.randomUUID()}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function worker(
  adapter: SyncAdapter,
  options: {
    online: () => boolean;
    maxAttempts?: number;
    statuses?: SyncStatus[];
    now?: () => string;
  },
): SyncWorker {
  return new SyncWorker({
    db,
    adapter,
    mode: 'supabase',
    signedIn: true,
    online: options.online,
    now: options.now ?? (() => T2),
    ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    onStatus: (status) => options.statuses?.push(status),
  });
}

describe('SyncWorker', () => {
  it('lässt bei Offline alles in der Outbox und meldet offline', async () => {
    const adapter = new InMemorySyncAdapter();
    const statuses: SyncStatus[] = [];
    const instance = worker(adapter, { online: () => false, statuses });

    await createItemLocal(db, { list_id: 'liste-1', name: 'Äpfel' }, T1);
    const result = await instance.syncNow();

    expect(result).toBeNull();
    expect(await countPending(db)).toBe(1);
    expect(adapter.activeRows('list_items')).toHaveLength(0);
    expect(statuses.at(-1)?.state).toBe('offline');
    expect(statuses.at(-1)?.label).toBe('Offline – 1 ausstehend');
  });

  it('spielt nach Reconnect die Outbox ab und meldet synchronisiert', async () => {
    const adapter = new InMemorySyncAdapter();
    const statuses: SyncStatus[] = [];
    let online = false;
    const instance = worker(adapter, { online: () => online, statuses });

    const item = await createItemLocal(db, { list_id: 'liste-1', name: 'Birnen' }, T1);
    await instance.syncNow();
    expect(await countPending(db)).toBe(1);

    online = true;
    const result = await instance.syncNow();

    expect(result?.applied).toHaveLength(1);
    expect(result?.failed).toHaveLength(0);
    expect(await countPending(db)).toBe(0);
    expect(adapter.activeRows('list_items')).toHaveLength(1);
    expect(adapter.row('list_items', item.id)?.fields.name).toBe('Birnen');
    expect(statuses.at(-1)?.state).toBe('synced');
    expect(statuses.at(-1)?.label).toBe('Synchronisiert');
  });

  it('verschiebt dauerhaft fehlgeschlagene Einträge ins Dead-Letter', async () => {
    const adapter = new FailingAdapter();
    const statuses: SyncStatus[] = [];
    const instance = worker(adapter, { online: () => true, maxAttempts: 2, statuses });

    await createItemLocal(db, { list_id: 'liste-1', name: 'Kakao' }, T1);

    await instance.syncNow();
    expect(await countPending(db)).toBe(1);
    expect(await countDeadLetters(db)).toBe(0);

    await instance.syncNow();
    expect(await countPending(db)).toBe(0);
    expect(await countDeadLetters(db)).toBe(1);
    expect(statuses.at(-1)?.state).toBe('error');
    expect(statuses.at(-1)?.label).toBe('1 nicht synchronisiert');
  });

  it('macht Realtime-Zeilen ohne neuen Outbox-Eintrag sichtbar', async () => {
    const adapter = new InMemorySyncAdapter();
    const instance = worker(adapter, { online: () => true });

    const item = await createItemLocal(db, { list_id: 'liste-1', name: 'Zwiebeln' }, T1);
    // Erst den lokalen Stand übertragen, damit die Zeile nicht mehr „dirty“ ist.
    await instance.syncNow();
    const remote: ListItem = {
      ...item,
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
      fields: { ...item.fields, checked: true, checked_by: 'geraet-b' },
    };

    await instance.applyRemoteRow(remote);

    const merged = await getItem(db, item.id);
    expect(merged?.fields.checked).toBe(true);
    expect(merged?.fields.checked_by).toBe('geraet-b');
    expect(await countPending(db)).toBe(0);
  });

  it('quittiert ein doppeltes Replay ohne Duplikat', async () => {
    const adapter = new InMemorySyncAdapter();
    const instance = worker(adapter, { online: () => true });

    await createItemLocal(db, { list_id: 'liste-1', name: 'Salz' }, T1);
    await instance.syncNow();
    const second = await instance.syncNow();

    expect(second).toBeNull();
    expect(adapter.activeRows('list_items')).toHaveLength(1);
  });
});
