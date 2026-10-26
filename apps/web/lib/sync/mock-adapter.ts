import type { AddToListRequest, ListItemRowData, RowId, SyncAdapter } from '@einkaufszettel/core';

/**
 * Sync-Adapter gegen die Dev-Mock-Gegenstelle (`/api/mock/sync`).
 *
 * Er wirft bei jedem Fehler (HTTP-Fehler, `{ok:false}`, Netzwerkfehler), damit
 * `replayOutbox` aus packages/core unverändert Retry-/Dead-Letter-Verhalten
 * anwendet. Nur für Dev/E2E gedacht; im Supabase-Modus bleibt der echte
 * Adapter aktiv.
 */

export interface MockSyncAdapterOptions {
  /** Sync-Scope (Haushalts-ID; im Dev-Mock notfalls `default-household`). */
  scope: string;
  /** Basis-URL; im Browser leer (relative Route). */
  baseUrl?: string;
  /** Testbarer fetch; Standard ist das globale fetch. */
  fetchImpl?: typeof fetch;
}

interface MockResponse {
  ok: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

function syncUrl(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/api/mock/sync`;
}

export class MockSyncAdapter implements SyncAdapter {
  private readonly options: MockSyncAdapterOptions;

  constructor(options: MockSyncAdapterOptions) {
    this.options = options;
  }

  async upsert(
    table: string,
    row: ListItemRowData,
    changedFields: readonly string[],
  ): Promise<void> {
    await this.call({
      action: 'upsert',
      scope: this.options.scope,
      table,
      row,
      changed_fields: [...changedFields],
    });
  }

  async softDelete(table: string, id: RowId): Promise<void> {
    await this.call({
      action: 'delete',
      scope: this.options.scope,
      table,
      id,
    });
  }

  async addToList(request: AddToListRequest): Promise<void> {
    await this.call({
      action: 'add_to_list',
      scope: this.options.scope,
      request,
    });
  }

  private async call(body: Record<string, unknown>): Promise<void> {
    const fetcher = this.options.fetchImpl ?? fetch;
    const response = await fetcher(syncUrl(this.options.baseUrl ?? ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => null)) as MockResponse | null;
    if (!response.ok || parsed?.ok !== true) {
      const message =
        parsed?.error?.message ?? `Mock-Sync fehlgeschlagen (HTTP ${response.status})`;
      throw new Error(message);
    }
  }
}

export function createMockSyncAdapter(options: MockSyncAdapterOptions): SyncAdapter {
  return new MockSyncAdapter(options);
}
