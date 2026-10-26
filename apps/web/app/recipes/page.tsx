'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { RecipeCard } from '@/components/recipes/RecipeCard';
import { useAuth } from '@/context/AuthContext';
import { getDb } from '@/lib/db/database';
import { useRecipeListData } from '@/lib/db/hooks';
import {
  deleteRecipeLocal,
  normalizeSearchQuery,
  recipeMatchesNeedle,
  restoreRecipeLocal,
} from '@/lib/db/recipes';
import type { Recipe } from '@/lib/db/types';
import { getHouseholdAdapter, type HouseholdRole } from '@/lib/household';
import { cacheHouseholdId, readCachedHouseholdId } from '@/lib/recipes/household-cache';
import styles from './recipes.module.css';

const UNDO_TIMEOUT_MS = 30_000;

export default function RecipesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const entries = useRecipeListData();
  const [query, setQuery] = useState('');
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [role, setRole] = useState<HouseholdRole | null>(null);
  const [undoRecipe, setUndoRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?next=/recipes');
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
          setRole(result.data.role);
          cacheHouseholdId(result.data.id);
        }
      })
      .catch(() => {
        /* offline/kein Haushalt: Liste bleibt lesbar. */
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (undoRecipe === null) return;
    const timer = setTimeout(() => setUndoRecipe(null), UNDO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [undoRecipe]);

  // Gleiche Suchsemantik wie `searchRecipes` (Titel ODER Tags), damit UI und
  // DB-Funktion nicht auseinanderlaufen.
  const filtered = useMemo(() => {
    const needle = normalizeSearchQuery(query);
    if (needle === '') return entries;
    return entries.filter(({ recipe }) => recipeMatchesNeedle(recipe, needle));
  }, [entries, query]);

  const canWrite = role !== 'viewer';

  async function handleDelete(recipe: Recipe) {
    setError(null);
    try {
      const db = getDb();
      await deleteRecipeLocal(db, recipe.id, new Date().toISOString());
      setUndoRecipe(recipe);
    } catch {
      setError('Löschen fehlgeschlagen.');
    }
  }

  async function handleUndo() {
    if (undoRecipe === null) return;
    setError(null);
    try {
      const db = getDb();
      await restoreRecipeLocal(db, undoRecipe.id, new Date().toISOString());
      setUndoRecipe(null);
    } catch {
      setError('Wiederherstellen fehlgeschlagen.');
    }
  }

  if (loading) {
    return (
      <main className={styles.container} aria-busy="true" aria-label="Rezepte werden geladen">
        <div className={styles.header}>
          <div className="skeleton" style={{ height: '1.15rem', width: '35%' }} />
          <div className="skeleton" style={{ height: '2.75rem', width: '40%' }} />
        </div>
        <div className={styles.searchWrap}>
          <div className="skeleton" style={{ height: '2.75rem' }} />
        </div>
        <div className={styles.list}>
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton skeleton-card" />
          ))}
        </div>
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
        <h1>Rezepte</h1>
        <div className={styles.headerActions}>
          <SyncStatusBadge />
          <ThemeToggle />
          <Link href="/lists" className={styles.headerLink}>
            Liste
          </Link>
          <Link href="/household" className={styles.headerLink}>
            Haushalt
          </Link>
        </div>
      </header>

      {householdId === null ? (
        <div className={styles.searchWrap}>
          <p className={styles.hint} data-testid="recipe-no-household">
            Noch kein Haushalt angelegt. Rezepte brauchen einen Haushalt –{' '}
            <Link href="/household">jetzt anlegen</Link>.
          </p>
        </div>
      ) : null}

      <div className={styles.searchWrap}>
        <input
          type="search"
          className={styles.searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rezepte durchsuchen (Titel, Tags) …"
          aria-label="Rezepte durchsuchen"
          data-testid="recipe-search"
        />
      </div>

      {error !== null ? (
        <div className={styles.searchWrap}>
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        </div>
      ) : null}

      <div className={styles.list}>
        {filtered.map(({ recipe, ingredientCount }) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            ingredientCount={ingredientCount}
            canWrite={canWrite}
            onDelete={(candidate) => void handleDelete(candidate)}
          />
        ))}

        {filtered.length === 0 ? (
          <div className={styles.emptyState} data-testid="recipe-empty">
            <p className={styles.emptyTitle}>
              {entries.length === 0 ? 'Noch keine Rezepte' : 'Keine Rezepte gefunden'}
            </p>
            <p className={styles.emptyText}>
              {entries.length === 0
                ? 'Lege dein erstes Rezept an – Zutaten lassen sich direkt auf die Einkaufsliste übertragen.'
                : `Für „${query.trim()}“ wurde nichts gefunden.`}
            </p>
            {entries.length === 0 ? (
              canWrite && householdId !== null ? (
                <Link href="/recipes/new" className={styles.emptyAction}>
                  Erstes Rezept anlegen
                </Link>
              ) : null
            ) : (
              <button type="button" className={styles.emptyAction} onClick={() => setQuery('')}>
                Suche zurücksetzen
              </button>
            )}
          </div>
        ) : null}
      </div>

      {undoRecipe !== null ? (
        <div className={styles.undoToast} role="status">
          <span>„{undoRecipe.fields.title}“ gelöscht</span>
          <button type="button" onClick={() => void handleUndo()}>
            Rückgängig
          </button>
        </div>
      ) : null}

      {canWrite && householdId !== null ? (
        <div className={styles.stickyBar}>
          <Link href="/recipes/new" className={styles.primaryBtn} data-testid="recipe-new">
            + Neues Rezept
          </Link>
        </div>
      ) : null}
    </main>
  );
}
