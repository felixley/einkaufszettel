'use client';

import { useMemo, useState } from 'react';
import type { RecipeIngredientDraft } from '@/lib/db/types';
import { formatIngredientLine, parseIngredientLine } from '@/lib/recipes/ingredient-line';
import styles from '@/app/recipes/recipes.module.css';

export interface RecipeFormInitial {
  title: string;
  base_servings: number | null;
  tags: string[];
  instructions: string | null;
  ingredients: RecipeIngredientDraft[];
}

export interface RecipeFormValues {
  title: string;
  base_servings: number | null;
  tags: string[];
  instructions: string | null;
  ingredients: RecipeIngredientDraft[];
}

interface Props {
  initial: RecipeFormInitial | null;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (values: RecipeFormValues) => Promise<void> | void;
  onCancel: (() => void) | null;
}

function initialLines(initial: RecipeFormInitial | null): string[] {
  if (initial === null || initial.ingredients.length === 0) return [''];
  return initial.ingredients.map((ingredient) =>
    formatIngredientLine(ingredient.quantity, ingredient.unit, ingredient.name),
  );
}

export function RecipeForm({ initial, submitLabel, busy, error, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [servingsText, setServingsText] = useState(
    initial?.base_servings !== null && initial?.base_servings !== undefined
      ? String(initial.base_servings)
      : '',
  );
  const [tagsText, setTagsText] = useState(initial?.tags.join(', ') ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [lines, setLines] = useState<string[]>(() => initialLines(initial));
  const [ids, setIds] = useState<Array<string | undefined>>(() =>
    initial === null ? [undefined] : initial.ingredients.map((ingredient) => ingredient.id),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const visibleError = useMemo(() => localError ?? error, [localError, error]);

  function updateLine(index: number, value: string): void {
    setLines((current) => current.map((line, position) => (position === index ? value : line)));
  }

  function addLine(): void {
    setLines((current) => [...current, '']);
    setIds((current) => [...current, undefined]);
  }

  function removeLine(index: number): void {
    setLines((current) => current.filter((_line, position) => position !== index));
    setIds((current) => current.filter((_id, position) => position !== index));
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;

    const problems: string[] = [];
    const trimmedTitle = title.trim();
    if (trimmedTitle === '') problems.push('Titel darf nicht leer sein.');

    const servings =
      servingsText.trim() === '' ? null : Number.parseFloat(servingsText.replace(',', '.'));
    if (servings !== null && (!Number.isFinite(servings) || servings <= 0)) {
      problems.push('Portionen müssen größer als 0 sein.');
    }

    const drafts: RecipeIngredientDraft[] = [];
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed === '') return;
      const parsed = parseIngredientLine(trimmed);
      if (parsed.name.trim() === '') {
        problems.push(`Zutat ${index + 1}: Name fehlt.`);
        return;
      }
      const id = ids[index];
      drafts.push({
        ...(id === undefined ? {} : { id }),
        name: parsed.name.trim(),
        quantity: parsed.quantity,
        unit: parsed.unit,
      });
    });

    if (problems.length > 0) {
      setLocalError(problems.join(' '));
      return;
    }

    setLocalError(null);
    const tags = tagsText
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');
    await onSubmit({
      title: trimmedTitle,
      base_servings: servings,
      tags,
      instructions: instructions.trim() === '' ? null : instructions,
      ingredients: drafts,
    });
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => void handleSubmit(event)}
      data-testid="recipe-form"
    >
      <div className={styles.field}>
        <label className={styles.label} htmlFor="recipe-title">
          Titel
        </label>
        <input
          id="recipe-title"
          className={styles.input}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="z. B. Pasta mit Tomatensauce"
          autoComplete="off"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="recipe-servings">
          Portionen (Basis)
        </label>
        <input
          id="recipe-servings"
          className={styles.input}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={servingsText}
          onChange={(event) => setServingsText(event.target.value)}
          placeholder="z. B. 4"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="recipe-tags">
          Tags (kommagetrennt)
        </label>
        <input
          id="recipe-tags"
          className={styles.input}
          value={tagsText}
          onChange={(event) => setTagsText(event.target.value)}
          placeholder="z. B. vegetarisch, italienisch"
          autoComplete="off"
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Zutaten</span>
        <p className={styles.hint}>
          Eine Zeile pro Zutat, z. B. „250 g Spaghetti“ oder „2 Stk Zwiebeln“.
        </p>
        {lines.map((line, index) => (
          <div key={index} className={styles.ingredientRow}>
            <input
              className={styles.ingredientInput}
              value={line}
              onChange={(event) => updateLine(index, event.target.value)}
              placeholder="Menge, Einheit und Zutat"
              aria-label={`Zutat ${index + 1}`}
              autoComplete="off"
            />
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => removeLine(index)}
              aria-label={`Zutat ${index + 1} entfernen`}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${styles.secondaryBtn} ${styles.addRowBtn}`}
          onClick={addLine}
        >
          + Zutat hinzufügen
        </button>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="recipe-instructions">
          Zubereitung
        </label>
        <textarea
          id="recipe-instructions"
          className={styles.textarea}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="Arbeitsschritte …"
        />
      </div>

      {visibleError !== null ? (
        <p className={styles.errorText} role="alert" data-testid="recipe-form-error">
          {visibleError}
        </p>
      ) : null}

      <div className={styles.actionRow}>
        <button
          type="submit"
          className={styles.primaryBtn}
          disabled={busy}
          data-testid="recipe-save"
        >
          {busy ? 'Speichern …' : submitLabel}
        </button>
        {onCancel !== null ? (
          <button type="button" className={styles.secondaryBtn} onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
        ) : null}
      </div>
    </form>
  );
}
