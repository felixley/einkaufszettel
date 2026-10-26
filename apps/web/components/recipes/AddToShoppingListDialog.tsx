'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ListItem, Recipe, RecipeIngredient } from '@einkaufszettel/core';
import { getDb } from '@/lib/db/database';
import { isMockAuth } from '@/lib/auth/mode';
import {
  applyTransferRequests,
  buildTransferPreviews,
  buildTransferRequests,
  type TransferPreview,
} from '@/lib/recipes/transfer';
import styles from './AddToShoppingListDialog.module.css';

interface AddToShoppingListDialogProps {
  recipe: Recipe;
  ingredients: RecipeIngredient[];
  /** Ziel-Liste. Im Mock-/E2E-Modus wie im manuellen Add-Flow `default-list-id`. */
  listId: string;
  /** Aktive Zeilen für die Konfliktanzeige (aus useActiveListItems). */
  existingItems: ListItem[];
  canWrite?: boolean;
  mode?: 'mock' | 'supabase';
  onClose: () => void;
  onTransferred?: (count: number) => void;
}

function formatFactor(base: number, target: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(target / base);
}

function toggleInSet(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Bottom-Sheet-Vorschau für „Auf die Einkaufsliste“ (T3.4).
 *
 * Die eigentliche Skalierungs-/Aggregationslogik liegt in
 * `lib/recipes/transfer.ts`; diese Komponente ist reine Darstellung und
 * Bedienung. Touch-Ziele sind mindestens 48 px hoch, die Primäraktion liegt
 * am Daumen (unten), Schließen per ×, Backdrop und Escape.
 */
export function AddToShoppingListDialog({
  recipe,
  ingredients,
  listId,
  existingItems,
  canWrite = true,
  mode = isMockAuth() ? 'mock' : 'supabase',
  onClose,
  onTransferred,
}: AddToShoppingListDialogProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const baseServings = recipe.fields.base_servings;
  const [targetServings, setTargetServings] = useState<number>(baseServings ?? 1);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(ingredients.map((ingredient) => ingredient.id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const previews = useMemo<TransferPreview[]>(
    () =>
      buildTransferPreviews(
        recipe,
        ingredients,
        baseServings === null ? null : targetServings,
        existingItems,
        listId,
      ),
    [recipe, ingredients, baseServings, targetServings, existingItems, listId],
  );

  const validIds = useMemo(
    () =>
      new Set(
        previews
          .filter((preview) => preview.request !== null)
          .map((preview) => preview.ingredientId),
      ),
    [previews],
  );

  const selectedCount = previews.filter(
    (preview) => selected.has(preview.ingredientId) && preview.request !== null,
  ).length;

  useEffect(() => {
    titleRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = sheetRef.current;
      if (root === null) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select, textarea, a[href]',
        ),
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  async function handleTransfer(): Promise<void> {
    if (busy) return;
    setError(null);
    if (!canWrite) {
      setError('Du hast nur Leserechte in diesem Haushalt – die Liste kann nicht geändert werden.');
      return;
    }

    const { requests } = buildTransferRequests(
      recipe,
      ingredients,
      baseServings === null ? null : targetServings,
      selected,
      existingItems,
      listId,
    );
    if (requests.length === 0) {
      setError('Bitte mindestens eine Zutat mit Menge auswählen.');
      return;
    }

    setBusy(true);
    try {
      const count = await applyTransferRequests(getDb(), requests, {
        mode,
        now: new Date().toISOString(),
        existingItems,
      });
      setSuccessCount(count);
      onTransferred?.(count);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Übertragung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  const subtitle = `${ingredients.length} ${ingredients.length === 1 ? 'Zutat' : 'Zutaten'} aus „${recipe.fields.title}“`;

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-list-title"
        data-testid="add-to-list-dialog"
      >
        <div className={styles.header}>
          <h2 id="add-to-list-title" ref={titleRef} tabIndex={-1}>
            Auf die Einkaufsliste
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label="Dialog schließen"
            onClick={onClose}
            data-testid="add-to-list-close"
          >
            ×
          </button>
        </div>
        <p className={styles.subtitle}>{subtitle}</p>

        {!canWrite ? (
          <p className={styles.error} role="alert" data-testid="transfer-readonly">
            Du hast nur Leserechte in diesem Haushalt – die Liste kann nicht geändert werden.
          </p>
        ) : null}

        {baseServings !== null ? (
          <div className={styles.servings}>
            <div>
              <div className={styles.servingsLabel}>Portionen</div>
              <div className={styles.servingsMeta}>
                Basis {baseServings} · Faktor {formatFactor(baseServings, targetServings)}
              </div>
            </div>
            <div className={styles.stepper}>
              <button
                type="button"
                className={styles.stepBtn}
                aria-label="Portionen verringern"
                disabled={targetServings <= 1}
                onClick={() => setTargetServings((current) => Math.max(1, current - 1))}
              >
                −
              </button>
              <span className={styles.servingsValue} data-testid="transfer-servings">
                {targetServings} {targetServings === 1 ? 'Portion' : 'Portionen'}
              </span>
              <button
                type="button"
                className={styles.stepBtn}
                aria-label="Portionen erhöhen"
                disabled={targetServings >= 99}
                onClick={() => setTargetServings((current) => Math.min(99, current + 1))}
              >
                +
              </button>
            </div>
          </div>
        ) : (
          <p className={styles.subtitle}>Portionen offen – Zutaten werden nicht skaliert.</p>
        )}

        <div className={styles.bulkRow}>
          <button
            type="button"
            className={styles.bulkBtn}
            onClick={() => setSelected(new Set(validIds))}
            data-testid="transfer-select-all"
          >
            Alle
          </button>
          <button
            type="button"
            className={styles.bulkBtn}
            onClick={() => setSelected(new Set())}
            data-testid="transfer-select-none"
          >
            Keine
          </button>
        </div>

        <div className={styles.list} role="group" aria-label="Zutaten auswählen">
          {previews.map((preview) => {
            const transferable = preview.request !== null;
            const checked = transferable && selected.has(preview.ingredientId);
            return (
              <label
                key={preview.ingredientId}
                className={styles.row}
                data-conflict={preview.conflict}
                data-testid="transfer-row"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!transferable}
                  onChange={() =>
                    setSelected((current) => toggleInSet(current, preview.ingredientId))
                  }
                  data-testid={`transfer-checkbox-${preview.ingredientId}`}
                />
                <span className={styles.rowBody}>
                  <span className={styles.rowName}>{preview.name}</span>
                  <span className={styles.rowAmount}>{preview.display}</span>
                  {preview.hint !== null ? (
                    <span className={styles.rowHint}>{preview.hint}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>

        {error !== null ? (
          <p className={styles.error} role="alert" data-testid="transfer-error">
            {error}
          </p>
        ) : null}

        {successCount !== null ? (
          <>
            <p className={styles.success} role="status" data-testid="transfer-success">
              {mode === 'mock'
                ? `${successCount} ${successCount === 1 ? 'Zutat' : 'Zutaten'} auf die Liste übernommen.`
                : `${successCount} ${successCount === 1 ? 'Zutat' : 'Zutaten'} zur Übertragung vorgemerkt – der Sync-Status zeigt den Fortschritt.`}
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={onClose}
                data-testid="transfer-done"
              >
                Fertig
              </button>
            </div>
          </>
        ) : (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !canWrite || selectedCount === 0}
              onClick={() => void handleTransfer()}
              data-testid="transfer-submit"
            >
              {busy
                ? 'Übertrage …'
                : `${selectedCount} ${selectedCount === 1 ? 'Zutat' : 'Zutaten'} übernehmen`}
            </button>
            <button type="button" className={styles.secondary} onClick={onClose}>
              Abbrechen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
