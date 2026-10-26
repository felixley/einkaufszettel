'use client';

import { useSync } from '@/lib/sync/SyncProvider';

/**
 * Sichtbarer Sync-Status (PLAN.md §4.2): synchronisiert / ausstehend: N /
 * offline. Bei ausstehenden oder fehlgeschlagenen Einträgen startet ein Tipp
 * einen erneuten Sync-Lauf.
 */
export function SyncStatusBadge() {
  const { status, triggerSync } = useSync();
  const canRetry = status.state === 'pending' || status.state === 'error';

  return (
    <button
      type="button"
      className={`sync-status tone-${status.tone}`}
      onClick={() => {
        if (canRetry) void triggerSync();
      }}
      title={status.detail}
      aria-live="polite"
      aria-label={`Sync-Status: ${status.label}`}
      data-testid="sync-status"
      data-sync-state={status.state}
      data-pending-count={status.pendingCount}
    >
      <span className="sync-dot" aria-hidden="true" />
      <span>{status.label}</span>
    </button>
  );
}
