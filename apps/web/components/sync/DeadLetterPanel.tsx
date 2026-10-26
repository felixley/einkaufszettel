'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { DeadLetterRow } from '@/lib/db/types';
import { getDb, indexedDbAvailable } from '@/lib/db/database';
import { discardDeadLetter, readDeadLetters, retryDeadLetter } from '@/lib/db/repository';
import { useSync } from '@/lib/sync/SyncProvider';
import styles from './DeadLetterPanel.module.css';

const OP_LABELS: Record<string, string> = {
  upsert: 'Änderung',
  delete: 'Löschen',
  add_to_list: 'Zur Liste hinzufügen',
};

function describeEntry(dead: DeadLetterRow): string {
  const op = OP_LABELS[dead.entry.op] ?? dead.entry.op;
  const table = dead.entry.table === 'list_items' ? 'Artikel' : dead.entry.table;
  return `${op} · ${table}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('de-DE');
}

interface DeadLetterPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Dead-Letter-Anzeige (PLAN.md §5, T4.3): listet dauerhaft fehlgeschlagene
 * Sync-Einträge und bietet „Erneut versuchen“ sowie „Verwerfen“.
 *
 * Als Bottom-Sheet gebaut: Daumen erreichbar, Touch-Ziele ≥ 48 px, Fokus
 * landet beim Öffnen auf „Schließen“, Escape schließt. Statusänderungen
 * werden über `aria-live` angesagt. Die Liste liest reaktiv aus Dexie.
 */
export function DeadLetterPanel({ open, onClose }: DeadLetterPanelProps) {
  if (!open) return null;
  return <PanelContent onClose={onClose} />;
}

function PanelContent({ onClose }: { onClose: () => void }) {
  const { triggerSync } = useSync();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const deadLetters = useLiveQuery(async () => {
    if (!indexedDbAvailable()) return [];
    return readDeadLetters(getDb());
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    // Kein Scrollen der Liste hinter dem offenen Sheet (One-Hand-Bedienung).
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const entries = deadLetters ?? [];

  async function handleRetry(dead: DeadLetterRow): Promise<void> {
    if (busyId !== null) return;
    setBusyId(dead.id);
    try {
      const requeued = await retryDeadLetter(getDb(), dead.id);
      setMessage(
        requeued
          ? 'Eintrag erneut eingereiht. Sync wird sofort versucht …'
          : 'Eintrag war nicht mehr vorhanden.',
      );
      if (requeued) await triggerSync();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDiscard(dead: DeadLetterRow): Promise<void> {
    if (busyId !== null) return;
    setBusyId(dead.id);
    try {
      const discarded = await discardDeadLetter(getDb(), dead.id);
      setMessage(discarded ? 'Eintrag verworfen.' : 'Eintrag war nicht mehr vorhanden.');
    } finally {
      setBusyId(null);
    }
  }

  const sheet = (
    <div id="dead-letter-panel" className={styles.overlay} role="presentation" onClick={onClose}>
      <section
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dead-letter-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.handle} aria-hidden="true" />
        <header className={styles.header}>
          <div>
            <h2 id="dead-letter-title" className={styles.title}>
              Fehlgeschlagene Sync-Einträge
            </h2>
            <p className={styles.subtitle}>
              {entries.length === 0
                ? 'Keine fehlgeschlagenen Einträge'
                : `${entries.length} Eintrag/Einträge dauerhaft fehlgeschlagen`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Dead-Letter-Anzeige schließen"
          >
            Schließen
          </button>
        </header>

        <p className={styles.live} role="status" aria-live="polite">
          {message}
        </p>

        {entries.length === 0 ? (
          <p className={styles.empty}>Keine fehlgeschlagenen Einträge.</p>
        ) : (
          <ul className={styles.list}>
            {entries.map((dead) => (
              <li key={dead.id} className={styles.item} data-testid="dead-letter-item">
                <div className={styles.itemHeader}>
                  <span className={styles.itemTitle}>{describeEntry(dead)}</span>
                  <span className={styles.attempts}>{dead.entry.attempts} Versuche</span>
                </div>
                <p className={styles.error}>{dead.error}</p>
                <p className={styles.meta}>Fehlgeschlagen am {formatDate(dead.failed_at)}</p>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.retryButton}
                    onClick={() => void handleRetry(dead)}
                    disabled={busyId !== null}
                    aria-label={`Eintrag „${describeEntry(dead)}“ erneut versuchen`}
                  >
                    Erneut versuchen
                  </button>
                  <button
                    type="button"
                    className={styles.discardButton}
                    onClick={() => void handleDiscard(dead)}
                    disabled={busyId !== null}
                    aria-label={`Eintrag „${describeEntry(dead)}“ verwerfen`}
                  >
                    Verwerfen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  // Portal an <body>: Der Dialog wird im Header gerendert, dessen
  // Stacking-Context (z-index 10) ihn sonst unter die fixe Add-Leiste
  // (z-index 20) legt — deren „+“-Button fängt dann alle Klicks ab (T4.3).
  if (typeof document === 'undefined') return null;
  return createPortal(sheet, document.body);
}

export default DeadLetterPanel;
