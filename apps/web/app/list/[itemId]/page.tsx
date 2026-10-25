'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ListItem } from '@einkaufszettel/core';
import { CATEGORY_KEYS, CATEGORY_LABELS } from '@einkaufszettel/core';
import { getDb } from '@/lib/db/database';
import {
  checkItemLocal,
  deleteItemLocal,
  getItem,
  updateItemLocal,
} from '@/lib/db/repository';
import styles from './list-detail.module.css';

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

export default function ItemDetailPage() {
  const params = useParams<{ itemId: string }>();
  const router = useRouter();
  const itemId = params.itemId;

  const [item, setItem] = useState<ListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const db = getDb();
        const data = await getItem(db, itemId);
        if (!active) return;
        if (data) {
          setItem(data);
          setName(data.fields.name);
          setQuantity(data.fields.quantity?.toString() ?? '');
          setUnit(data.fields.unit ?? '');
          setCategory(data.fields.category_id ?? '');
          setNote(data.fields.note ?? '');
          setChecked(data.fields.checked);
        } else {
          setError('Artikel nicht gefunden.');
        }
      } catch {
        if (active) setError('Fehler beim Laden des Artikels.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [itemId]);

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    setError(null);
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const patch = {
        name: name.trim(),
        quantity: quantity === '' ? null : Number.parseFloat(quantity),
        unit: (unit === '' ? null : unit) as ListItem['fields']['unit'],
        category_id: category === '' ? null : category,
        note: note.trim() === '' ? null : note.trim(),
      };

      const updated = await updateItemLocal(db, item.id, patch, now);
      if (updated && checked !== item.fields.checked) {
        await checkItemLocal(db, item.id, checked, now);
      }
      router.push('/lists');
    } catch {
      setError('Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!item) return;
    setDeleting(true);
    setError(null);
    try {
      const db = getDb();
      await deleteItemLocal(db, item.id, new Date().toISOString());
      router.push('/lists');
    } catch {
      setError('Löschen fehlgeschlagen.');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  if (loading) {
    return (
      <main className={styles.container}>
        <p className={styles.centered}>Lade Artikel …</p>
      </main>
    );
  }

  if (error && !item) {
    return (
      <main className={styles.container}>
        <p className={`${styles.centered} ${styles.errorText}`} role="alert">
          {error}
        </p>
        <button type="button" className={styles.secondaryBtn} onClick={() => router.push('/lists')}>
          Zur Liste
        </button>
      </main>
    );
  }

  if (!item) return null;

  const busy = saving || deleting;

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          aria-label="Zurück zur Liste"
          onClick={() => router.push('/lists')}
        >
          ←
        </button>
        <div>
          <h1 className={styles.title}>Artikel bearbeiten</h1>
          <p className={styles.subtitle}>
            {item.fields.checked ? 'Erledigt' : 'Offen'} ·{' '}
            {item.fields.category_id
              ? (CATEGORY_LABELS[item.fields.category_id as keyof typeof CATEGORY_LABELS] ??
                item.fields.category_id)
              : 'Ohne Kategorie'}
          </p>
        </div>
      </header>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input
            className={styles.input}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="z. B. Milch"
            autoComplete="off"
            required
          />
        </label>

        <div className={styles.row}>
          <label className={`${styles.field} ${styles.grow}`}>
            <span className={styles.label}>Menge</span>
            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="z. B. 1"
            />
          </label>
          <label className={`${styles.field} ${styles.grow}`}>
            <span className={styles.label}>Einheit</span>
            <select
              className={styles.select}
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            >
              <option value="">ohne</option>
              {UNITS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Kategorie</span>
          <select
            className={styles.select}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Ohne Kategorie</option>
            {CATEGORY_KEYS.map((key) => (
              <option key={key} value={key}>
                {CATEGORY_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Notiz</span>
          <textarea
            className={styles.textarea}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional: Marke, Abholung, Alternativen …"
          />
        </label>

        <div className={styles.statusCard}>
          <div>
            <p className={styles.statusTitle}>Status</p>
            <p className={styles.muted}>
              {checked ? 'Abgehakt – erscheint unten bei „Erledigt“.' : 'Noch offen.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label="Abgehakt"
            className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
            onClick={() => setChecked((value) => !value)}
          >
            <span className={styles.toggleKnob} />
          </button>
        </div>

        {error ? (
          <p className={`alert error ${styles.errorText}`} role="alert">
            {error}
          </p>
        ) : null}

        {showDeleteConfirm ? (
          <div className={styles.confirmCard} role="alertdialog" aria-label="Löschen bestätigen">
            <p className={styles.confirmText}>Artikel wirklich löschen?</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void handleDelete()}
                disabled={busy}
              >
                {deleting ? 'Lösche …' : 'Löschen'}
              </button>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setShowDeleteConfirm(false)}
                disabled={busy}
              >
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => setShowDeleteConfirm(true)}
            disabled={busy}
          >
            Artikel löschen
          </button>
        )}

        <div className={styles.actions}>
          <button type="submit" className={styles.saveBtn} disabled={busy || name.trim() === ''}>
            {saving ? 'Speichere …' : 'Speichern'}
          </button>
        </div>
      </form>
    </main>
  );
}
