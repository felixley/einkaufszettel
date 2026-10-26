'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AddToShoppingListDialog } from '@/components/recipes/AddToShoppingListDialog';
import { RecipeForm } from '@/components/recipes/RecipeForm';
import type { RecipeFormInitial, RecipeFormValues } from '@/components/recipes/RecipeForm';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { useAuth } from '@/context/AuthContext';
import { getDb } from '@/lib/db/database';
import { useActiveListItems, useRecipe, useRecipeIngredients } from '@/lib/db/hooks';
import {
  deleteRecipeLocal,
  restoreRecipeLocal,
  saveRecipeWithIngredientsLocal,
} from '@/lib/db/recipes';
import type { Recipe } from '@/lib/db/types';
import { formatQuantity } from '@/lib/recipes/ingredient-line';
import { getHouseholdAdapter, type HouseholdRole } from '@/lib/household';
import styles from '../recipes.module.css';

export default function RecipeDetailPage() {
  const params = useParams<{ recipeId: string }>();
  const router = useRouter();
  const recipeId = params.recipeId;
  const { user, loading: authLoading } = useAuth();
  const recipe = useRecipe(recipeId);
  const ingredients = useRecipeIngredients(recipeId);

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletedRecipe, setDeletedRecipe] = useState<Recipe | null>(null);
  const [role, setRole] = useState<HouseholdRole | null>(null);
  const [showAddToList, setShowAddToList] = useState(false);
  const [transferHint, setTransferHint] = useState<string | null>(null);
  const activeItems = useActiveListItems();
  // Im Mock-/E2E-Modus ist die Liste wie im manuellen Add-Flow fest verdrahtet;
  // sobald echte Listendaten vorliegen, wird deren list_id übernommen.
  const listId = activeItems[0]?.fields.list_id ?? 'default-list-id';

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?next=/recipes/${recipeId}`);
    }
  }, [authLoading, user, router, recipeId]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void getHouseholdAdapter()
      .getMyHousehold()
      .then((result) => {
        if (active && result.ok) setRole(result.data?.role ?? null);
      })
      .catch(() => {
        /* offline: Rolle unbekannt, UI bleibt nutzbar. */
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function handleSave(values: RecipeFormValues) {
    if (recipe === null || recipe === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const db = getDb();
      const updated = await saveRecipeWithIngredientsLocal(
        db,
        recipe.id,
        {
          title: values.title,
          base_servings: values.base_servings,
          tags: values.tags,
          instructions: values.instructions,
        },
        values.ingredients,
        new Date().toISOString(),
      );
      if (updated !== null) setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (recipe === null || recipe === undefined) return;
    setError(null);
    try {
      const db = getDb();
      const target = recipe;
      await deleteRecipeLocal(db, target.id, new Date().toISOString());
      setDeletedRecipe(target);
      setEditing(false);
    } catch {
      setError('Löschen fehlgeschlagen.');
    }
  }

  async function handleUndoDelete() {
    if (deletedRecipe === null) return;
    setError(null);
    try {
      const db = getDb();
      await restoreRecipeLocal(db, deletedRecipe.id, new Date().toISOString());
      setDeletedRecipe(null);
    } catch {
      setError('Wiederherstellen fehlgeschlagen.');
    }
  }

  if (authLoading) {
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

  if (recipe === undefined) {
    return (
      <main className={styles.container}>
        <p className={styles.centered}>Lade Rezept …</p>
      </main>
    );
  }

  if (deletedRecipe !== null) {
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
            <h1>Rezept gelöscht</h1>
          </div>
        </header>
        <div className={styles.detailWrap}>
          <p className={styles.detailMeta}>
            „{deletedRecipe.fields.title}“ wurde gelöscht. Du kannst das rückgängig machen.
          </p>
          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void handleUndoDelete()}
            >
              Rückgängig
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => router.push('/recipes')}
            >
              Zur Rezeptliste
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (recipe === null) {
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
            <h1>Rezept</h1>
          </div>
        </header>
        <div className={styles.detailWrap}>
          <p className={styles.errorText} role="alert">
            Rezept nicht gefunden.
          </p>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => router.push('/recipes')}
          >
            Zur Rezeptliste
          </button>
        </div>
      </main>
    );
  }

  const canWrite = role === null || role !== 'viewer';
  const initial: RecipeFormInitial = {
    title: recipe.fields.title,
    base_servings: recipe.fields.base_servings,
    tags: recipe.fields.tags,
    instructions: recipe.fields.instructions,
    ingredients: ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.fields.name,
      quantity: ingredient.fields.quantity,
      unit: ingredient.fields.unit,
    })),
  };

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
          <h1>Rezept</h1>
        </div>
        <div className={styles.headerActions}>
          <SyncStatusBadge />
        </div>
      </header>

      {editing ? (
        <>
          <RecipeForm
            initial={initial}
            submitLabel="Änderungen speichern"
            busy={busy}
            error={error}
            onSubmit={(values) => void handleSave(values)}
            onCancel={() => {
              setEditing(false);
              setError(null);
            }}
          />
        </>
      ) : (
        <div className={styles.detailWrap}>
          <h2 className={styles.detailTitle} data-testid="recipe-detail-title">
            {recipe.fields.title}
          </h2>
          <p className={styles.detailMeta}>
            {recipe.fields.base_servings !== null
              ? `${recipe.fields.base_servings} Portionen`
              : 'Portionen offen'}
            {' · '}
            {ingredients.length} {ingredients.length === 1 ? 'Zutat' : 'Zutaten'}
          </p>
          {recipe.fields.tags.length > 0 ? (
            <div className={styles.tagRow}>
              {recipe.fields.tags.map((tag) => (
                <span key={tag} className={styles.tag}>
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}

          <h3 className={styles.sectionTitle} style={{ marginTop: '1.25rem' }}>
            Zutaten
          </h3>
          {ingredients.length === 0 ? (
            <p className={styles.hint}>Keine Zutaten hinterlegt.</p>
          ) : (
            <ul className={styles.ingredientList} data-testid="recipe-ingredients">
              {ingredients.map((ingredient) => (
                <li key={ingredient.id} className={styles.ingredientItem}>
                  <span>{ingredient.fields.name}</span>
                  <span className={styles.ingredientQty}>
                    {formatQuantity(ingredient.fields.quantity, ingredient.fields.unit)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {recipe.fields.instructions !== null ? (
            <>
              <h3 className={styles.sectionTitle} style={{ marginTop: '1.25rem' }}>
                Zubereitung
              </h3>
              <p className={styles.instructionsText}>{recipe.fields.instructions}</p>
            </>
          ) : null}

          {ingredients.length > 0 ? (
            <button
              type="button"
              className={styles.primaryBtn}
              style={{ width: '100%', marginTop: '1.25rem' }}
              onClick={() => {
                setShowAddToList(true);
                setTransferHint(null);
              }}
              data-testid="recipe-add-to-list"
            >
              Auf die Einkaufsliste
            </button>
          ) : null}

          {transferHint !== null ? (
            <p className={styles.hint} role="status" data-testid="recipe-transfer-hint">
              {transferHint}
            </p>
          ) : null}

          {error !== null ? (
            <p className={styles.errorText} role="alert">
              {error}
            </p>
          ) : null}

          {canWrite ? (
            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.primaryBtn}
                style={{ width: 'auto', flex: '1 1 10rem' }}
                onClick={() => {
                  setEditing(true);
                  setError(null);
                }}
                data-testid="recipe-edit"
              >
                Bearbeiten
              </button>
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void handleDelete()}
                data-testid="recipe-delete-detail"
              >
                Löschen
              </button>
            </div>
          ) : (
            <p className={styles.hint} style={{ marginTop: '1rem' }}>
              Du hast nur Leserechte in diesem Haushalt.
            </p>
          )}
        </div>
      )}

      {showAddToList ? (
        <AddToShoppingListDialog
          recipe={recipe}
          ingredients={ingredients}
          listId={listId}
          existingItems={activeItems}
          canWrite={canWrite}
          onClose={() => setShowAddToList(false)}
          onTransferred={(count) => {
            setTransferHint(`${count} ${count === 1 ? 'Zutat' : 'Zutaten'} übertragen.`);
          }}
        />
      ) : null}
    </main>
  );
}
