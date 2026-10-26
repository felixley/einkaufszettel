import type { ListItemRowData } from '@einkaufszettel/core';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetMockSyncStore } from '@/lib/sync/mock-store';
import { DELETE, GET, POST } from './route';

const BASE_URL = 'http://localhost';

function request(path: string, init?: RequestInit): NextRequest {
  return new Request(`${BASE_URL}${path}`, init) as unknown as NextRequest;
}

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

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('Mock-Sync-Route', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_AUTH_MOCK = 'true';
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    resetMockSyncStore();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_AUTH_MOCK;
  });

  it('antwortet ausserhalb des Mock-Modus mit 404', async () => {
    process.env.NEXT_PUBLIC_AUTH_MOCK = 'false';
    const response = await GET(request('/api/mock/sync?scope=x'));
    expect(response.status).toBe(404);
    expect((await body(response)).ok).toBe(false);
  });

  it('nimmt Upserts an und liefert sie ueber GET', async () => {
    const upsert = await POST(
      request('/api/mock/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          scope: 'haushalt-route',
          table: 'list_items',
          row: row('route-1', 'Reis'),
          changed_fields: ['name', 'quantity'],
        }),
      }),
    );
    expect(upsert.status).toBe(200);
    expect((await body(upsert)).ok).toBe(true);

    const list = await GET(request('/api/mock/sync?scope=haushalt-route'));
    const parsed = (await body(list)) as {
      ok: boolean;
      data: { rows: Array<{ id: string }>; cursor: string };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.rows.map((item) => item.id)).toEqual(['route-1']);
    expect(parsed.data.cursor).toBeTruthy();
  });

  it('validiert unbekannte Aktionen', async () => {
    const response = await POST(
      request('/api/mock/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'kaputt', scope: 'x' }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await body(response)).ok).toBe(false);
  });

  it('setzt den Scope per DELETE zurueck', async () => {
    await POST(
      request('/api/mock/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert',
          scope: 'haushalt-reset',
          table: 'list_items',
          row: row('reset-1', 'Salz'),
          changed_fields: ['name'],
        }),
      }),
    );
    await DELETE(request('/api/mock/sync?scope=haushalt-reset'));
    const list = await GET(request('/api/mock/sync?scope=haushalt-reset'));
    const parsed = (await body(list)) as { data: { rows: unknown[] } };
    expect(parsed.data.rows).toHaveLength(0);
  });
});
