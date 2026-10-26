'use client';

import Link from 'next/link';
import type { Recipe } from '@/lib/db/types';
import styles from '@/app/recipes/recipes.module.css';

interface Props {
  recipe: Recipe;
  ingredientCount: number;
  canWrite: boolean;
  onDelete: (recipe: Recipe) => void;
}

export function RecipeCard({ recipe, ingredientCount, canWrite, onDelete }: Props) {
  const { title, base_servings: baseServings, tags } = recipe.fields;
  const servingsText = baseServings !== null ? `${baseServings} Portionen` : 'Portionen offen';

  return (
    <div className={styles.card} data-testid="recipe-card">
      <Link href={`/recipes/${recipe.id}`} className={styles.cardLink}>
        <div className={styles.cardTitle}>{title}</div>
        <div className={styles.cardMeta}>
          {servingsText} · {ingredientCount} {ingredientCount === 1 ? 'Zutat' : 'Zutaten'}
        </div>
        {tags.length > 0 ? (
          <div className={styles.tagRow}>
            {tags.map((tag) => (
              <span key={tag} className={styles.tag}>
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
      </Link>
      {canWrite ? (
        <button
          type="button"
          className={styles.deleteBtn}
          aria-label={`Rezept „${title}“ löschen`}
          data-testid="recipe-delete"
          onClick={() => onDelete(recipe)}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
