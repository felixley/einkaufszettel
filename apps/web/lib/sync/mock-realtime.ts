import type { ListItem } from '@einkaufszettel/core';
import type { RealtimeSource } from './realtime';

/**
 * Mock-Realtime für den Dev-/E2E-Modus (T4.2a).
 *
 * Supabase-Realtime steht im Mock-Modus nicht zur Verfügung. Damit zwei
 * Browser-Kontexte („zwei Geräte“) Änderungen des jeweils anderen sehen,
 * pollt diese Quelle den Dev-Mock-Sync-Server in kurzem Abstand über den
 * `since`-Cursor. Es ist bewusst Polling und kein WebSocket/SSE: einfach,
 * robust gegen Reconnects und ohne neue Runtime-Abhängigkeit.
 *
 * Nur für Dev/E2E gedacht. Fehler (offline, Server weg) werden still
 * übergangen; der Sync-Worker meldet den Offline-/Fehlerzustand separat.
 */

export interface MockRealtimeOptions {
  /** Sync-Scope (Haushalts-ID; im Dev-Mock notfalls `default-household`). */
  scope: string;
  /** Polling-Intervall in ms; Standard 1500 ms. */
  intervalMs?: number;
  /** Basis-URL; im Browser leer (relative Route). */
  baseUrl?: string;
  /** Testbarer fetch; Standard ist das globale fetch. */
  fetchImpl?: typeof fetch;
}

interface MockRowsResponse {
  ok: boolean;
  data?: { rows: ListItem[]; cursor: string };
  error?: { code: string; message: string };
}

const DEFAULT_INTERVAL_MS = 1_500;

function syncUrl(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/api/mock/sync`;
}

export class MockRealtimeSource implements RealtimeSource {
  private readonly options: MockRealtimeOptions;

  constructor(options: MockRealtimeOptions) {
    this.options = options;
  }

  subscribe(onRow: (row: ListItem) => void): () => void {
    let active = true;
    let polling = false;
    let since = '';
    let timer: ReturnType<typeof setInterval> | null = null;
    const fetcher = this.options.fetchImpl ?? fetch;

    const poll = async (): Promise<void> => {
      if (!active || polling) return;
      polling = true;
      try {
        const params = new URLSearchParams({ scope: this.options.scope });
        if (since !== '') params.set('since', since);
        const response = await fetcher(
          `${syncUrl(this.options.baseUrl ?? '')}?${params.toString()}`,
        );
        const parsed = (await response.json().catch(() => null)) as MockRowsResponse | null;
        if (!active || !response.ok || parsed?.ok !== true || parsed.data === undefined) return;
        for (const row of parsed.data.rows) {
          if (!active) return;
          onRow(row);
        }
        since = parsed.data.cursor;
      } catch {
        // Offline/Dev-Server nicht erreichbar: nächster Tick versucht es erneut.
      } finally {
        polling = false;
      }
    };

    void poll();
    timer = setInterval(() => {
      void poll();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);

    return () => {
      active = false;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }
}

export function createMockRealtimeSource(options: MockRealtimeOptions): RealtimeSource {
  return new MockRealtimeSource(options);
}
