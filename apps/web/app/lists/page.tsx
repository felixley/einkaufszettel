'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useItemHistory, type ItemHistoryEntry } from '@/components/list/useItemHistory';
import { useAuth } from '@/context/AuthContext';
import { useActiveListItems } from '@/lib/db/hooks';
import { getDb } from '@/lib/db/database';
import { getHouseholdAdapter } from '@/lib/household';
import {
  addItemLocal,
  checkItemLocal,
  createItemLocal,
  deleteItemLocal,
  ensureCategoryRulesSeeded,
} from '@/lib/db/repository';
import type { ListItem } from '@einkaufszettel/core';
import { CATEGORY_KEYS, CATEGORY_LABELS } from '@einkaufszettel/core';
import { ListItemRow } from '@/components/list/ListItemRow';
import styles from './lists.module.css';

/** Einheiten aus PLAN.md §4.3 (identisch zur Detailansicht). */
const UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'TL',
  'EL',
  'Stk',
  'Bund',
  'Dose',
  'Packung',
  'Zehe',
  'Prise',
  'n. B.',
] as const;

/** Lade-Skelett für die Kopfzeile/Liste (T4.4). */
function LoadingSkeleton() {
  return (
    <main className={styles.container} aria-busy="true" aria-label="Liste wird geladen">
      <div className={styles.header}>
        <div className="skeleton" style={{ height: '1.15rem', width: '45%' }} />
        <div className="skeleton" style={{ height: '2.75rem', width: '30%' }} />
      </div>
      <div className={styles.list}>
        <div className="skeleton skeleton-heading" />
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="skeleton skeleton-row" />
        ))}
      </div>
    </main>
  );
}

export default function ListsPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const items = useActiveListItems();
  const history = useItemHistory();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<number | null>(null);

  const [newItemName, setNewItemName] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('');
  const [undoItem, setUndoItem] = useState<ListItem | null>(null);
  const [addHint, setAddHint] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pending, setPending] = useState(false);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?next=/lists');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    // Haushalts-ID für gelernte Regeln (best effort, offline tolerant).
    void getHouseholdAdapter()
      .getMyHousehold()
      .then((result) => {
        if (active && result.ok) setHouseholdId(result.data?.id ?? null);
      })
      .catch(() => {
        /* offline/kein Haushalt: nur globale Regeln. */
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  const suggestions = useMemo<ItemHistoryEntry[]>(() => {
    const query = newItemName.trim().toLowerCase();
    if (query.length === 0) return [];
    const prefix: ItemHistoryEntry[] = [];
    const contains: ItemHistoryEntry[] = [];
    for (const entry of history) {
      if (entry.key.startsWith(query)) prefix.push(entry);
      else if (entry.key.includes(query)) contains.push(entry);
    }
    return [...prefix, ...contains].slice(0, 5);
  }, [history, newItemName]);

  async function handleLogout() {
    setPending(true);
    try {
      await signOut();
      router.replace('/login');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleAddItem(event: React.FormEvent) {
    event.preventDefault();
    if (!newItemName.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setAddHint(null);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    try {
      const db = getDb();
      const now = new Date().toISOString();
      await ensureCategoryRulesSeeded(db, now);
      // Duplikat-Zusammenfassung (T2.8) + Auto-Kategorisierung (T2.7).
      const quantity =
        newItemQuantity.trim() === '' ? null : Number.parseFloat(newItemQuantity.trim());
      const result = await addItemLocal(
        db,
        {
          list_id: 'default-list-id',
          name: newItemName.trim(),
          quantity: Number.isFinite(quantity) ? quantity : null,
          unit: newItemUnit === '' ? null : (newItemUnit as ListItem['fields']['unit']),
        },
        now,
        { householdId },
      );
      setAddHint(result.preview.hint);
      setNewItemName('');
      setNewItemQuantity('');
      setNewItemUnit('');
      // Enter/Submit bleibt im Feld (T4.5) – direkt weiter tippen.
      nameInputRef.current?.focus();
    } finally {
      setIsSubmitting(false);
    }
  }

  function selectSuggestion(entry: ItemHistoryEntry) {
    setNewItemName(entry.name);
    setNewItemQuantity(entry.quantity !== null ? String(entry.quantity) : '');
    setNewItemUnit(entry.unit ?? '');
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    nameInputRef.current?.focus();
  }

  function handleNameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setShowSuggestions(false);
      setActiveSuggestion(-1);
      return;
    }
    if (suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setShowSuggestions(true);
      setActiveSuggestion((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setShowSuggestions(true);
      setActiveSuggestion((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
      return;
    }
    if (event.key === 'Enter' && showSuggestions && activeSuggestion >= 0) {
      event.preventDefault();
      const entry = suggestions[activeSuggestion];
      if (entry) selectSuggestion(entry);
    }
  }

  async function handleToggle(item: ListItem) {
    const db = getDb();
    const now = new Date().toISOString();
    await checkItemLocal(db, item.id, !item.fields.checked, now);
  }

  async function handleDelete(item: ListItem) {
    const db = getDb();
    const now = new Date().toISOString();
    await deleteItemLocal(db, item.id, now);
    setUndoItem(item);
    setTimeout(() => setUndoItem(null), 30000);
  }

  async function handleUndo() {
    if (!undoItem) return;
    const db = getDb();
    const now = new Date().toISOString();
    await createItemLocal(
      db,
      {
        list_id: undoItem.fields.list_id,
        name: undoItem.fields.name,
        quantity: undoItem.fields.quantity,
        unit: undoItem.fields.unit,
        category_id: undoItem.fields.category_id,
        note: undoItem.fields.note,
      },
      now,
    );
    setUndoItem(null);
  }

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (!user) {
    return (
      <main className={styles.container}>
        <p className={styles.centered}>Nicht angemeldet. Weiterleitung …</p>
      </main>
    );
  }

  const activeItems = items.filter((item) => !item.fields.checked);
  const completedItems = items.filter((item) => item.fields.checked);

  const grouped = activeItems.reduce(
    (acc, item) => {
      const category = item.fields.category_id || 'sonstiges';
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    },
    {} as Record<string, ListItem[]>,
  );

  const sortedGroups = CATEGORY_KEYS.map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    items: grouped[key] ?? [],
  })).filter((group) => group.items.length > 0);

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1>Einkaufsliste</h1>
        <div className={styles.headerActions}>
          <SyncStatusBadge />
          <ThemeToggle />
          <Link href="/recipes" className={styles.headerLink}>
            Rezepte
          </Link>
          <Link href="/household" className={styles.headerLink}>
            Haushalt
          </Link>
          <button
            type="button"
            className={styles.headerBtn}
            onClick={handleLogout}
            disabled={pending}
          >
            {pending ? '…' : 'Abmelden'}
          </button>
        </div>
      </header>

      <div className={styles.list}>
        {sortedGroups.map((group) => (
          <section key={group.key} className={styles.categoryGroup}>
            <h2>{group.label}</h2>
            {group.items.map((item) => (
              <ListItemRow
                key={item.id}
                item={item}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </section>
        ))}

        {completedItems.length > 0 && (
          <section className={styles.completedSection}>
            <h2>Erledigt ({completedItems.length})</h2>
            {completedItems.map((item) => (
              <ListItemRow
                key={item.id}
                item={item}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </section>
        )}

        {activeItems.length === 0 && completedItems.length === 0 && (
          <div className={styles.emptyState} data-testid="list-empty">
            <p className={styles.emptyTitle}>Deine Einkaufsliste ist leer</p>
            <p className={styles.emptyText}>
              Tippe unten einen Artikel ein – Vorschläge aus deiner Historie erscheinen
              automatisch.
            </p>
            <button
              type="button"
              className={styles.emptyAction}
              onClick={() => nameInputRef.current?.focus()}
            >
              Ersten Artikel eintragen
            </button>
          </div>
        )}
      </div>

      {undoItem && (
        <div className={styles.undoToast} role="status">
          <span>„{undoItem.fields.name}“ gelöscht</span>
          <button type="button" onClick={handleUndo}>
            Rückgängig
          </button>
        </div>
      )}

      {addHint ? (
        <p className={styles.addHint} role="status" data-testid="add-hint">
          {addHint}
        </p>
      ) : null}

      <form onSubmit={handleAddItem} className={styles.addBar}>
        {showSuggestions && suggestions.length > 0 ? (
          <div className={styles.suggestions} role="listbox" id="item-suggestions">
            {suggestions.map((entry, index) => (
              <button
                key={entry.key}
                type="button"
                id={`item-suggestion-${index}`}
                role="option"
                aria-selected={index === activeSuggestion}
                className={`${styles.suggestionItem} ${
                  index === activeSuggestion ? styles.suggestionActive : ''
                }`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(entry)}
              >
                <span>{entry.name}</span>
                <span className={styles.suggestionMeta}>
                  {entry.quantity !== null ? `${entry.quantity} ${entry.unit ?? ''}`.trim() : ''}
                  {entry.count > 1 ? ` · ${entry.count}×` : ''}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <input
          ref={nameInputRef}
          type="text"
          value={newItemName}
          onChange={(event) => {
            setNewItemName(event.target.value);
            setActiveSuggestion(-1);
            setShowSuggestions(event.target.value.trim().length > 0);
          }}
          onFocus={() => {
            if (newItemName.trim().length > 0) setShowSuggestions(true);
          }}
          onBlur={() => {
            if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
            blurTimerRef.current = window.setTimeout(() => setShowSuggestions(false), 150);
          }}
          onKeyDown={handleNameKeyDown}
          placeholder="Artikel hinzufügen …"
          className={styles.addInput}
          aria-label="Neuer Artikel"
          aria-autocomplete="list"
          aria-expanded={showSuggestions && suggestions.length > 0}
          aria-controls="item-suggestions"
          aria-activedescendant={
            activeSuggestion >= 0 ? `item-suggestion-${activeSuggestion}` : undefined
          }
          enterKeyHint="send"
          autoComplete="off"
        />
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={newItemQuantity}
          onChange={(event) => setNewItemQuantity(event.target.value)}
          placeholder="Menge"
          className={styles.addQuantity}
          aria-label="Menge"
        />
        <select
          value={newItemUnit}
          onChange={(event) => setNewItemUnit(event.target.value)}
          className={styles.addUnit}
          aria-label="Einheit"
        >
          <option value="">Einheit</option>
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
        <button type="submit" className={styles.addBtn} disabled={isSubmitting}>
          +
        </button>
      </form>
    </main>
  );
}
