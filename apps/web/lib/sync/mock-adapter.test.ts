import type { ListItem, ListItemRowData } from '@einkaufszettel/core';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, POST } from '@/app/api/mock/sync/route';
import { MockSyncAdapter } from './mock-adapter';
import { resetMockSyncStore } from './mock-store';

const SCOPE = 'haushalt-t42a';
const BASE_URL = 'http://localhost';

/** Führt die echten Route-Handler aus (kein Netzwerk, aber gleicher Code). */
const routeFetch: typeof fetch = async (input, init) => {
  const request = new Request(
    typeof input === 'string' ? new URL(input, BASE_URL).toString() : input,
    init,
  );
  const url = new URL(request.url);
  if (url.pathname !== '/api/mock/sync') {
    return new Response('not found', { status: 404 });
  }
  const handler = request.method === 'GET' ? GET : request.method === 'POST' ? POST : DELETE;
  return handler(request as unknown as NextRequest);
};

function row(id: string, name: string): ListItemRowData {
  return {
    id,
    list_id: 'liste-1',
    name,
    name_normalized: name.toLocaleLowerCase('de-DE'),
    quantity: 1,
    unit: 'Stk',
    category_id: null,
    checked: false,
    checked_by: null,
    source_recipe_id: null,
    note: null,
  };
}

async function readRows(scope = SCOPE): Promise<{ rows: ListItem[]; cursor: string }> {
  const response = await routeFetch(`${BASE_URL}/api/mock/sync?scope=${encodeURIComponent(scope)}`);
  const parsed = (await response.json()) as {
    ok: boolean;
    data: { rows: ListItem[]; cursor: string };
  };
  expect(parsed.ok).toBe(true);
  return parsed.data;
}

function adapter(scope = SCOPE): MockSyncAdapter {
  return new MockSyncAdapter({ scope, baseUrl: BASE_URL, fetchImpl: routeFetch });
}

describe('MockSyncAdapter gegen den Dev-Mock-Sync-Server', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_AUTH_MOCK = 'true';
    resetMockSyncStore();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_AUTH_MOCK;
  });

  it('konvergiert: zwei Clients (A/B) sehen nach dem Sync beide Zeilen', async () => {
    const clientA = adapter();
    const clientB = adapter();

    await clientA.upsert('list_items', row('a-1', 'Aepfel'), [
      'list_id',
      'name',
      'quantity',
      'unit',
    ]);
    await clientB.upsert('list_items', row('b-1', 'Birnen'), [
      'list_id',
      'name',
      'quantity',
      'unit',
    ]);

    const seenByA = await readRows();
    const seenByB = await readRows();

    expect(seenByA.rows.map((item) => item.id).sort()).toEqual(['a-1', 'b-1']);
    expect(seenByB.rows.map((item) => item.id).sort()).toEqual(['a-1', 'b-1']);
    expect(seenByA.cursor).toBe(seenByB.cursor);
  });

  it('ist idempotent: derselbe Upsert 2x ergibt eine Zeile', async () => {
    const client = adapter();
    const payload = row('idem-1', 'Mehl');
    await client.upsert('list_items', payload, ['name', 'quantity']);
    await client.upsert('list_items', payload, ['name', 'quantity']);

    const page = await readRows();
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.fields.name).toBe('Mehl');
  });

  it('add_to_list: gleiche request_id 2x erzeugt keine Doppelmenge', async () => {
    const client = adapter();
    const request = {
      request_id: 'req-1',
      list_id: 'liste-1',
      name: 'Tomaten',
      quantity: 2,
      unit: 'Stk' as const,
    };

    await client.addToList(request);
    await client.addToList(request);

    const page = await readRows();
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.fields.quantity).toBe(2);
  });

  it('add_to_list aggregiert verschiedene request_ids nach Name+Dimension', async () => {
    const client = adapter();
    await client.addToList({
      request_id: 'req-2',
      list_id: 'liste-1',
      name: 'Tomaten',
      quantity: 2,
      unit: 'Stk',
    });
    await client.addToList({
      request_id: 'req-3',
      list_id: 'liste-1',
      name: 'tomaten',
      quantity: 3,
      unit: 'Stk',
    });

    const page = await readRows();
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.fields.quantity).toBe(5);
  });

  it('Soft-Delete gewinnt gegen spaeteren Edit (kein Wiederbeleben)', async () => {
    const client = adapter();
    await client.upsert('list_items', row('del-1', 'Brot'), ['name']);
    await client.softDelete('list_items', 'del-1');
    await client.upsert('list_items', { ...row('del-1', 'Brot neu'), quantity: 9 }, [
      'name',
      'quantity',
    ]);

    const page = await readRows();
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.deleted_at).not.toBeNull();
    expect(page.rows[0]?.fields.name).toBe('Brot');
    expect(page.rows[0]?.fields.quantity).toBe(1);
  });

  it('liefert nur Aenderungen seit dem Cursor', async () => {
    const client = adapter();
    await client.upsert('list_items', row('c-1', 'Kakao'), ['name']);
    const first = await readRows();

    await client.upsert('list_items', row('c-2', 'Kaffee'), ['name']);
    const second = await readRows();
    const response = await routeFetch(
      `${BASE_URL}/api/mock/sync?scope=${encodeURIComponent(SCOPE)}&since=${encodeURIComponent(first.cursor)}`,
    );
    const parsed = (await response.json()) as {
      ok: boolean;
      data: { rows: ListItem[]; cursor: string };
    };

    expect(parsed.data.rows.map((item) => item.id)).toEqual(['c-2']);
    expect(parsed.data.cursor).toBe(second.cursor);
  });

  it('wirft bei ungueltigem Payload, damit die Outbox erneut versucht', async () => {
    const client = adapter();
    await expect(
      client.upsert('list_items', { id: '' } as unknown as ListItemRowData, ['name']),
    ).rejects.toThrow();
  });
});
