'use client';

import Link from 'next/link';
import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { ListItem } from '@einkaufszettel/core';
import styles from '@/app/lists/lists.module.css';

interface Props {
  item: ListItem;
  onToggle: (item: ListItem) => void;
  onDelete: (item: ListItem) => void;
}

/** Ab dieser horizontalen Strecke löst der Swipe die Aktion aus. */
const SWIPE_THRESHOLD = 72;
/** Maximale Auslenkung, damit die Zeile nicht aus dem Bild läuft. */
const MAX_OFFSET = 140;
/** Erst ab dieser Bewegung wird horizontal gewischt (Achsen-Lock). */
const AXIS_LOCK = 10;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Listenzeile mit Swipe-Gesten (T4.5):
 * - nach rechts wischen = abhaken / abhaken rückgängig
 * - nach links wischen  = löschen (mit kurzer Entfernen-Animation)
 * Sichtbare Buttons bleiben zusätzlich erhalten (Barrierefreiheit).
 */
export function ListItemRow({ item, onToggle, onDelete }: Props) {
  const { fields } = item;
  const quantityText =
    fields.quantity !== null ? `${fields.quantity} ${fields.unit ?? ''}`.trim() : '';

  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(false);

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const horizontalRef = useRef(false);
  const offsetRef = useRef(0);
  const suppressClickUntilRef = useRef(0);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (removing) return;
    startRef.current = { x: event.clientX, y: event.clientY };
    horizontalRef.current = false;
    offsetRef.current = 0;
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = startRef.current;
    if (start === null) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (!horizontalRef.current) {
      if (Math.abs(dx) > AXIS_LOCK && Math.abs(dx) > Math.abs(dy)) {
        horizontalRef.current = true;
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      } else if (Math.abs(dy) > AXIS_LOCK) {
        // Vertikales Scrollen gewinnt: Geste nicht weiter verfolgen.
        startRef.current = null;
        return;
      }
    }
    if (!horizontalRef.current) return;
    event.preventDefault();
    const next = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, dx));
    offsetRef.current = next;
    setOffset(next);
  }

  function removeWithAnimation() {
    if (prefersReducedMotion()) {
      onDelete(item);
      return;
    }
    setRemoving(true);
    setOffset(-MAX_OFFSET);
    window.setTimeout(() => onDelete(item), 180);
  }

  function finishGesture() {
    startRef.current = null;
    if (!horizontalRef.current) {
      setOffset(0);
      offsetRef.current = 0;
      return;
    }
    horizontalRef.current = false;
    setDragging(false);
    const dx = offsetRef.current;
    offsetRef.current = 0;

    if (dx >= SWIPE_THRESHOLD) {
      setOffset(0);
      suppressClickUntilRef.current = Date.now() + 400;
      onToggle(item);
      return;
    }
    if (dx <= -SWIPE_THRESHOLD) {
      suppressClickUntilRef.current = Date.now() + 400;
      removeWithAnimation();
      return;
    }
    setOffset(0);
  }

  function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    // Nach einem Swipe den folgenden Klick (z. B. auf den Link) unterdrücken.
    if (Date.now() < suppressClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  const rowClassName = [styles.itemRow, dragging ? styles.dragging : '', removing ? styles.removing : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.swipeWrap} data-testid="list-item">
      <div className={`${styles.swipeAction} ${styles.swipeActionCheck}`} aria-hidden="true">
        ✓
      </div>
      <div className={`${styles.swipeAction} ${styles.swipeActionDelete}`} aria-hidden="true">
        ✕
      </div>
      <div
        className={rowClassName}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
        onClickCapture={handleClickCapture}
      >
        <button
          type="button"
          className={`${styles.checkbox} ${fields.checked ? styles.checked : ''}`}
          onClick={() => onToggle(item)}
          aria-label={fields.checked ? 'Abhaken rückgängig' : 'Abhaken'}
        >
          <span className={styles.checkCircle} aria-hidden="true" />
        </button>
        <Link href={`/list/${item.id}`} className={styles.itemContent} draggable={false}>
          <div className={styles.itemName}>{fields.name}</div>
          {quantityText && <div className={styles.itemDetails}>{quantityText}</div>}
        </Link>
        <button
          type="button"
          className={styles.deleteBtn}
          onClick={removeWithAnimation}
          aria-label="Löschen"
          data-testid="delete-btn"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
