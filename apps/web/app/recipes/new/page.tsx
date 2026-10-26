'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RecipeForm, type RecipeFormValues } from '@/components/recipes/RecipeForm';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { useAuth } from '@/context/AuthContext';
import { getDb } from '@/lib/db/database';
import { createRecipeLocal } from '@/lib/db/recipes';
import { getHouseholdAdapter } from '@/lib/household';
import { cacheHouseholdId, readCachedHouseholdId } from '@/lib/recipes/household-cache';
import styles from '../recipes.module.css';

export default function NewRecipePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?next=/recipes/new');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    setHouseholdId(readCachedHouseholdId());
    let active = true;
    void getHouseholdAdapter()
      .getMyHousehold()
      .then((result) => {
        if (!active) return;
        if (result.ok && result.data) {
          setHouseholdId(result.data.id);
          cacheHouseholdId(result.data.id);
        }
      })
      .catch(() => {
        /* offline/kein Haushalt: Fehler beim Speichern zeigen. */
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function handleSubmit(values: RecipeFormValues) {
    if (householdId === null) {
      setError('Kein Haushalt gefunden. Bitte zuerst einen Haushalt anlegen.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const db = getDb();
      const recipe = await createRecipeLocal(
        db,
        {
          household_id: householdId,
          title: values.title,
          base_servings: values.base_servings,
          tags: values.tags,
          instructions: values.instructions,
          ingredients: values.ingredients,
        },
        new Date().toISOString(),
      );
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSavedOffline(true);
        return;
      }
      router.push(`/recipes/${recipe.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
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

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.backBtn}
            aria-label="Zurück zu den Rezepten"
            onClick={() => router.push('/recipes')}
          >
            ←
          </button>
          <h1>Neues Rezept</h1>
        </div>
        <div className={styles.headerActions}>
          <SyncStatusBadge />
        </div>
      </header>

      {savedOffline ? (
        <div className={styles.form}>
          <div className={styles.savedBox} role="status" data-testid="recipe-saved-offline">
            <strong>Offline gespeichert</strong>
            <p className={styles.hint}>
              Das Rezept liegt in dieser Browser-Datenbank und wird nach dem Reconnect
              synchronisiert. Sobald du wieder online bist, erscheint es in der Rezeptliste.
            </p>
            <Link href="/recipes" className={styles.primaryBtn}>
              Zur Rezeptliste
            </Link>
          </div>
        </div>
      ) : (
        <RecipeForm
          initial={null}
          submitLabel="Rezept speichern"
          busy={busy}
          error={error}
          onSubmit={(values) => void handleSubmit(values)}
          onCancel={() => router.push('/recipes')}
        />
      )}
    </main>
  );
}
