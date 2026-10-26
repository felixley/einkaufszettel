'use client';

import { useCallback, useRef, useState } from 'react';
import { useSync } from '@/lib/sync/SyncProvider';
import { DeadLetterPanel } from '@/components/sync/DeadLetterPanel';

/**
 * Sichtbarer Sync-Status (PLAN.md §4.2): synchronisiert / ausstehend: N /
 * offline. Bei ausstehenden oder fehlgeschlagenen Einträgen startet ein Tipp
 * einen erneuten Sync-Lauf; bei Dead-Lettern öffnet er die Detailanzeige
 * (T4.3), damit der Fehler geprüft, wiederholt oder verworfen werden kann.
 */
export function SyncStatusBadge() {
  const { status, triggerSync } = useSync();
  const [panelOpen, setPanelOpen] = useState(false);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const hasDeadLetters = status.deadLetterCount > 0;
  const canRetry = status.state === 'pending' || status.state === 'error';

  // Fokus nach dem Schließen zurück auf den Auslöser (Tastaturbedienung).
  // Stabile Referenz, damit der Panel-Effekt nicht bei jedem Render neu läuft.
  const closePanel = useCallback((): void => {
    setPanelOpen(false);
    badgeRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={badgeRef}
        type="button"
        className={`sync-status tone-${status.tone}`}
        aria-haspopup={hasDeadLetters ? 'dialog' : undefined}
        aria-expanded={hasDeadLetters ? panelOpen : undefined}
        aria-controls={hasDeadLetters ? 'dead-letter-panel' : undefined}
        onClick={() => {
          if (hasDeadLetters) setPanelOpen(true);
          else if (canRetry) void triggerSync();
        }}
        title={status.detail}
        aria-live="polite"
        aria-label={`Sync-Status: ${status.label}${
          hasDeadLetters
            ? `, ${status.deadLetterCount} fehlgeschlagene Einträge – Details öffnen`
            : ''
        }`}
        data-testid="sync-status"
        data-sync-state={status.state}
        data-pending-count={status.pendingCount}
        data-dead-letter-count={status.deadLetterCount}
      >
        <span className="sync-dot" aria-hidden="true" />
        <span>{status.label}</span>
      </button>
      <DeadLetterPanel open={panelOpen} onClose={closePanel} />
    </>
  );
}
