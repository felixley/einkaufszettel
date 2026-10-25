'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { useAuth } from '@/context/AuthContext';
import { useActiveListItems } from '@/lib/db/hooks';
import { getDb } from '@/lib/db/database';
import { checkItemLocal, createItemLocal, deleteItemLocal } from '@/lib/db/repository';
import type { ListItem } from '@einkaufszettel/core';
import { CATEGORY_KEYS, CATEGORY_LABELS } from '@einkaufszettel/core';
import { ListItemRow } from '@/components/list/ListItemRow';
import styles from './lists.module.css';

export default function ListsPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const items = useActiveListItems();
  const [newItemName, setNewItemName] = useState('');
  const [undoItem, setUndoItem] = useState<ListItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?next=/lists');
    }
  }, [loading, user, router]);

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
    try {
      const db = getDb();
      const now = new Date().toISOString();
      await createItemLocal(
        db,
        {
          list_id: 'default-list-id',
          name: newItemName.trim(),
        },
        now,
      );
      setNewItemName('');
    } finally {
      setIsSubmitting(false);
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
    return (
      <main className={styles.container}>
        <p className={styles.centered}>Lade Sitzung …</p>
      </main>
    );
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
          <p className={styles.emptyState}>
            Noch keine Artikel. Füge unten den ersten hinzu.
          </p>
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

      <form onSubmit={handleAddItem} className={styles.addBar}>
        <input
          type="text"
          value={newItemName}
          onChange={(event) => setNewItemName(event.target.value)}
          placeholder="Artikel hinzufügen …"
          className={styles.addInput}
          aria-label="Neuer Artikel"
        />
        <button type="submit" className={styles.addBtn} disabled={isSubmitting}>
          +
        </button>
      </form>
    </main>
  );
}
