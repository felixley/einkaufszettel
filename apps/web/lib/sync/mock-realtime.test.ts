import type { ListItem, ListItemRowData } from '@einkaufszettel/core';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, GET, POST } from '@/app/api/mock/sync/route';
import { MockSyncAdapter } from './mock-adapter';
import { resetMockSyncStore } from './mock-store';
import { MockRealtimeSource } from './mock-realtime';

const SCOPE = 'haushalt-realtime';
const BASE_URL = 'http://localhost';

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

function adapter(): MockSyncAdapter {
  return new MockSyncAdapter({ scope: SCOPE, baseUrl: BASE_URL, fetchImpl: routeFetch });
}

function waitForRow(
  rows: ListItem[],
  predicate: (row: ListItem) => boolean,
  timeoutMs = 2_000,
): Promise<ListItem> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = rows.find(predicate);
      if (found !== undefined) {
        clearInterval(timer);
        resolve(found);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Realtime-Zeile kam nicht innerhalb des Timeouts an.'));
      }
    }, 20);
  });
}

describe('MockRealtimeSource (Polling)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_AUTH_MOCK = 'true';
    resetMockSyncStore();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_AUTH_MOCK;
  });

  it('liefert Aenderungen eines zweiten Clients an Abonnenten', async () => {
    const client = adapter();
    const received: ListItem[] = [];
    const source = new MockRealtimeSource({
      scope: SCOPE,
      baseUrl: BASE_URL,
      fetchImpl: routeFetch,
      intervalMs: 25,
    });
    const unsubscribe = source.subscribe((row) => received.push(row));

    try {
      await client.upsert('list_items', row('rt-1', 'Zwiebeln'), ['name']);
      const delivered = await waitForRow(received, (item) => item.id === 'rt-1');
      expect(delivered.fields.name).toBe('Zwiebeln');
      expect(delivered.deleted_at).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it('meldet auch Soft-Deletes', async () => {
    const client = adapter();
    const received: ListItem[] = [];
    const source = new MockRealtimeSource({
      scope: SCOPE,
      baseUrl: BASE_URL,
      fetchImpl: routeFetch,
      intervalMs: 25,
    });
    const unsubscribe = source.subscribe((row) => received.push(row));

    try {
      await client.upsert('list_items', row('rt-2', 'Butter'), ['name']);
      await waitForRow(received, (item) => item.id === 'rt-2' && item.deleted_at === null);

      await client.softDelete('list_items', 'rt-2');
      const deleted = await waitForRow(
        received,
        (item) => item.id === 'rt-2' && item.deleted_at !== null,
      );
      expect(deleted.deleted_at).not.toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it('stoppt das Polling nach unsubscribe', async () => {
    const client = adapter();
    const received: ListItem[] = [];
    const source = new MockRealtimeSource({
      scope: SCOPE,
      baseUrl: BASE_URL,
      fetchImpl: routeFetch,
      intervalMs: 20,
    });
    const unsubscribe = source.subscribe((row) => received.push(row));
    await new Promise((resolve) => setTimeout(resolve, 40));
    unsubscribe();

    await client.upsert('list_items', row('rt-3', 'Milch'), ['name']);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(received.some((item) => item.id === 'rt-3')).toBe(false);
  });
});
