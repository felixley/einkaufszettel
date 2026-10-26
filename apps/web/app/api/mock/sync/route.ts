import { NextResponse, type NextRequest } from 'next/server';
import { isMockAuth } from '@/lib/auth/mode';
import { getMockSyncStore } from '@/lib/sync/mock-store';
import type { AddToListRequest, ListItemRowData } from '@einkaufszettel/core';

/**
 * Dev-/E2E-Mock-Gegenstelle für den Sync (T4.2a).
 *
 * Nur im Mock-Auth-Modus aktiv (sonst 404). Der Zustand lebt in einer
 * In-Memory-Map im Dev-Server-Prozess — damit sehen zwei Browser-Kontexte
 * („zwei Geräte“) dieselben Zeilen, obwohl ihre IndexedDB getrennt ist.
 * Nichts wird persistiert; Neustart des Dev-Servers = leerer Store.
 *
 * Keine Authentifizierung: Diese Route ist ausdrücklich dev-only und wird
 * außerhalb des Mock-Modus mit 404 beantwortet. Sie ist kein Ersatz für
 * RLS/GoTrue.
 */

export const dynamic = 'force-dynamic';

type Body = Record<string, unknown>;

function ok(data: unknown): NextResponse {
  return NextResponse.json({ ok: true, data });
}

function fail(code: string, message: string, status = 200): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

function asBody(value: unknown): Body {
  return typeof value === 'object' && value !== null ? (value as Body) : {};
}

function readString(body: Body, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readStringArray(body: Body, key: string): string[] | null {
  const value = body[key];
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function isRow(value: unknown): value is ListItemRowData {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && row.id.length > 0;
}

function isAddToListRequest(value: unknown): value is AddToListRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.request_id === 'string' &&
    request.request_id.length > 0 &&
    typeof request.list_id === 'string' &&
    request.list_id.length > 0 &&
    typeof request.name === 'string' &&
    request.name.trim().length > 0 &&
    typeof request.quantity === 'number' &&
    Number.isFinite(request.quantity) &&
    request.quantity > 0
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isMockAuth()) {
    return fail('not_found', 'Mock-Sync ist nur im Mock-Modus aktiv.', 404);
  }

  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') ?? 'default-household';
  const since = url.searchParams.get('since') ?? '';
  const page = getMockSyncStore().listRowsSince(scope, 'list_items', since);
  return ok(page);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isMockAuth()) {
    return fail('not_found', 'Mock-Sync ist nur im Mock-Modus aktiv.', 404);
  }

  const raw: unknown = await request.json().catch(() => null);
  const body = asBody(raw);
  const action = readString(body, 'action');
  const scope = readString(body, 'scope') ?? 'default-household';
  const store = getMockSyncStore();

  try {
    switch (action) {
      case 'upsert': {
        const table = readString(body, 'table');
        const row = body.row;
        const changedFields = readStringArray(body, 'changed_fields');
        if (table === null || !isRow(row) || changedFields === null) {
          return fail('invalid', 'Ungueltiger Upsert-Payload.');
        }
        const stored = store.upsert(scope, table, row, changedFields);
        return ok(stored);
      }
      case 'delete': {
        const table = readString(body, 'table');
        const id = readString(body, 'id');
        if (table === null || id === null) return fail('invalid', 'Ungueltiger Delete-Payload.');
        return ok(store.softDelete(scope, table, id));
      }
      case 'add_to_list': {
        const addRequest = body.request;
        if (!isAddToListRequest(addRequest)) {
          return fail('invalid', 'Ungueltiger add_to_list-Payload.');
        }
        const outcome = store.addToList(scope, addRequest);
        return ok({
          affected: outcome.affected,
          created: outcome.created,
          duplicate: outcome.duplicate,
        });
      }
      default:
        return fail('invalid', 'Unbekannte Aktion.', 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unerwarteter Mock-Sync-Fehler.';
    return fail('unknown', message);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  if (!isMockAuth()) {
    return fail('not_found', 'Mock-Sync ist nur im Mock-Modus aktiv.', 404);
  }

  const url = new URL(request.url);
  const store = getMockSyncStore();
  if (url.searchParams.get('all') === '1') {
    store.reset();
    return ok({ reset: 'all' });
  }
  const scope = url.searchParams.get('scope') ?? 'default-household';
  store.resetScope(scope);
  return ok({ reset: scope });
}
