import {
  replayOutbox,
  type ListItem,
  type ReplayResult,
  type SyncAdapter,
} from '@einkaufszettel/core';
import type { EinkaufszettelDB } from '@/lib/db/database';
import {
  countDeadLetters,
  countPending,
  mergeRemoteItem,
  readOutbox,
  saveReplayResult,
  OUTBOX_CHANGED_EVENT,
} from '@/lib/db/repository';
import type { RealtimeSource } from './realtime';
import { computeSyncStatus, type SyncMode, type SyncStatus } from './status';

export interface SyncWorkerOptions {
  db: EinkaufszettelDB;
  adapter: SyncAdapter;
  mode: SyncMode;
  signedIn: boolean;
  online: () => boolean;
  now?: () => string;
  intervalMs?: number;
  maxAttempts?: number;
  onStatus?: (status: SyncStatus) => void;
  realtime?: RealtimeSource;
}

const DEFAULT_INTERVAL_MS = 30_000;

function errorToString(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unbekannter Fehler';
  }
}

/**
 * Sync-Worker für die Outbox (PLAN.md §4.2).
 *
 * Spielt bei Start, Reconnect, Fokus, Rückkehr in den Tab, Outbox-Änderungen
 * und alle 30 s die Outbox idempotent ab. Realtime-Zeilen werden in Dexie
 * eingemischt; der Worker ist die einzige Stelle, die Netzwerk-Sync auslöst.
 */
export class SyncWorker {
  private readonly options: SyncWorkerOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeRealtime: (() => void) | null = null;
  private running = false;
  private stopped = true;
  private rerunRequested = false;
  private lastError: string | null = null;
  private lastStatus: SyncStatus | null = null;

  constructor(options: SyncWorkerOptions) {
    this.options = options;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      window.addEventListener('focus', this.handleFocus);
      window.addEventListener(OUTBOX_CHANGED_EVENT, this.handleOutboxChanged);
      document.addEventListener('visibilitychange', this.handleVisibility);
    }

    if (this.options.realtime !== undefined) {
      this.unsubscribeRealtime = this.options.realtime.subscribe((row) => {
        void this.applyRemoteRow(row);
      });
    }

    this.timer = setInterval(() => {
      void this.syncNow();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);

    void this.syncNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
      window.removeEventListener('focus', this.handleFocus);
      window.removeEventListener(OUTBOX_CHANGED_EVENT, this.handleOutboxChanged);
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
    this.unsubscribeRealtime?.();
    this.unsubscribeRealtime = null;
  }

  getStatus(): SyncStatus | null {
    return this.lastStatus;
  }

  /**
   * Ein Replay-Lauf. Rückgabe `null` bedeutet: bereits ein Lauf aktiv oder
   * offline. Ein währenddessen angeforderter Lauf wird nachgeholt.
   */
  async syncNow(): Promise<ReplayResult | null> {
    if (this.running) {
      this.rerunRequested = true;
      return null;
    }
    if (this.stopped && this.timer === null && this.unsubscribeRealtime === null) {
      // Erlaubt explizite Aufrufe vor `start()` in Tests/Trigger-Buttons.
    }
    if (!this.options.online()) {
      await this.emitStatus();
      return null;
    }

    this.running = true;
    try {
      const outbox = await readOutbox(this.options.db);
      if (outbox.entries.length === 0) {
        this.lastError = null;
        await this.emitStatus();
        return null;
      }

      const result = await replayOutbox(outbox, this.options.adapter, {
        ...(this.options.maxAttempts === undefined
          ? {}
          : { maxAttempts: this.options.maxAttempts }),
      });
      await saveReplayResult(this.options.db, result, this.now());
      this.lastError =
        result.deadLettered.length > 0
          ? `${result.deadLettered.length} Eintrag/Einträge dauerhaft fehlgeschlagen`
          : result.failed.length > 0
            ? errorToString(result.failed[0]?.error)
            : null;
      return result;
    } catch (error) {
      this.lastError = errorToString(error);
      return null;
    } finally {
      this.running = false;
      await this.emitStatus();
      if (this.rerunRequested && !this.stopped) {
        this.rerunRequested = false;
        void this.syncNow();
      }
    }
  }

  /** Realtime-Zeile einmischen (öffentlich für Tests). */
  async applyRemoteRow(row: ListItem): Promise<void> {
    try {
      await mergeRemoteItem(this.options.db, row);
      this.lastError = null;
    } catch (error) {
      this.lastError = errorToString(error);
    }
    await this.emitStatus();
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private readonly handleOnline = (): void => {
    void this.syncNow();
  };

  private readonly handleOffline = (): void => {
    void this.emitStatus();
  };

  private readonly handleFocus = (): void => {
    void this.syncNow();
  };

  private readonly handleVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void this.syncNow();
    }
  };

  private readonly handleOutboxChanged = (): void => {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.syncNow();
    }, 250);
  };

  private async emitStatus(): Promise<void> {
    const [pendingCount, deadLetterCount] = await Promise.all([
      countPending(this.options.db),
      countDeadLetters(this.options.db),
    ]);
    const status = computeSyncStatus({
      mode: this.options.mode,
      online: this.options.online(),
      signedIn: this.options.signedIn,
      pendingCount,
      deadLetterCount,
      running: this.running,
      lastError: this.lastError,
    });
    this.lastStatus = status;
    this.options.onStatus?.(status);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('einkaufszettel:sync-status', { detail: status }));
    }
  }
}
