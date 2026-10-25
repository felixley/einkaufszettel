import 'fake-indexeddb/auto';

import type { CategoryKey } from '@einkaufszettel/core';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { EinkaufszettelDB } from './database';
import {
  addItemLocal,
  categorizeItemNameLocal,
  correctItemCategoryLocal,
  createItemLocal,
  ensureCategoryRulesSeeded,
  getCategoryRules,
  learnCategoryRuleLocal,
  readOutbox,
} from './repository';

const T1 = '2026-01-01T00:00:01.000Z';
const T2 = '2026-01-01T00:00:02.000Z';
const T3 = '2026-01-01T00:00:03.000Z';
const HOUSEHOLD = '0192f1a2-0000-7000-8000-0000000000aa';

let db: EinkaufszettelDB;

beforeEach(async () => {
  db = new EinkaufszettelDB(`einkaufszettel-cat-test-${crypto.randomUUID()}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('Kategorisierung: Seed + Regeln (A-7/T2.7)', () => {
  it('seedet die globalen Regeln genau einmal', async () => {
    const first = await ensureCategoryRulesSeeded(db, T1);
    expect(first).toBe(389);
    expect(await db.category_rules.count()).toBe(389);

    const second = await ensureCategoryRulesSeeded(db, T2);
    expect(second).toBe(0);
    expect(await db.category_rules.count()).toBe(389);
    // Seed-Regeln sind global und wandern nicht in die Outbox.
    expect((await readOutbox(db)).entries).toHaveLength(0);
  });

  it('liefert globale Regeln auch ohne vorherigen Seed', async () => {
    const rules = await getCategoryRules(db, null);
    expect(rules.length).toBeGreaterThanOrEqual(380);
    expect(rules.every((rule) => rule.householdId === null)).toBe(true);
  });

  it('kategorisiert Artikelnamen regelbasiert', async () => {
    const result = await categorizeItemNameLocal(db, 'Bananen');
    expect(result.categoryKey).toBe('obst_gemuese');
    expect(result.fallbackUsed).toBe(false);
  });

  it('legt bei manueller Korrektur eine Haushaltsregel an und lernt sie', async () => {
    const learned = await learnCategoryRuleLocal(
      db,
      { articleName: 'Zauberpulver', categoryKey: 'gewuerze_oele', householdId: HOUSEHOLD },
      T1,
    );
    expect(learned.created).toBe(true);
    expect(learned.rule).toMatchObject({
      keyword: 'zauberpulver',
      categoryKey: 'gewuerze_oele',
      householdId: HOUSEHOLD,
    });

    const rows = await db.category_rules.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      household_id: HOUSEHOLD,
      keyword: 'zauberpulver',
      category_key: 'gewuerze_oele',
    });

    const outbox = await readOutbox(db);
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({ table: 'category_rules', op: 'upsert' });

    // Zweite gleiche Korrektur ist ein No-op (kein neuer Outbox-Eintrag).
    const again = await learnCategoryRuleLocal(
      db,
      { articleName: 'Zauberpulver', categoryKey: 'gewuerze_oele', householdId: HOUSEHOLD },
      T2,
    );
    expect(again.created).toBe(false);
    expect((await readOutbox(db)).entries).toHaveLength(1);

    // Geänderte Kategorie aktualisiert dieselbe Zeile statt zu duplizieren.
    const changed = await learnCategoryRuleLocal(
      db,
      { articleName: 'Zauberpulver', categoryKey: 'sonstiges', householdId: HOUSEHOLD },
      T3,
    );
    expect(changed.created).toBe(false);
    const afterRows = await db.category_rules.toArray();
    expect(afterRows).toHaveLength(1);
    expect(afterRows[0]?.category_key).toBe('sonstiges');

    const learnedRules = await getCategoryRules(db, HOUSEHOLD);
    expect(learnedRules.some((rule) => rule.keyword === 'zauberpulver')).toBe(true);
  });

  it('korrigiert die Kategorie eines Artikels und legt eine Regel an', async () => {
    const item = await createItemLocal(
      db,
      { list_id: 'liste-1', name: 'Zauberpulver', quantity: 1, unit: 'Stk' },
      T1,
    );
    expect(item.fields.category_id).toBeNull();

    const updated = await correctItemCategoryLocal(db, item.id, 'gewuerze_oele', HOUSEHOLD, T2);
    expect(updated?.fields.category_id).toBe('gewuerze_oele');

    const rules = await getCategoryRules(db, HOUSEHOLD);
    expect(rules).toContainEqual({
      keyword: 'zauberpulver',
      categoryKey: 'gewuerze_oele',
      householdId: HOUSEHOLD,
    });
  });
});

describe('Add-Flow: Duplikate + Auto-Kategorisierung (A-8/T2.8)', () => {
  it('addiert Mengen bei gleichem Namen und gleicher Dimension', async () => {
    const first = await addItemLocal(
      db,
      { list_id: 'liste-1', name: 'Tomaten', quantity: 1, unit: 'kg' },
      T1,
    );
    expect(first.created).toBe(true);
    expect(first.item.fields.category_id).toBe('obst_gemuese');

    const second = await addItemLocal(
      db,
      { list_id: 'liste-1', name: 'Tomaten', quantity: 500, unit: 'g' },
      T2,
    );
    expect(second.created).toBe(false);
    expect(second.preview.kind).toBe('aggregate');
    expect(second.preview.hint).toBe('Artikel steht bereits auf der Liste – Menge wird addiert.');
    expect(second.item.id).toBe(first.item.id);
    expect(second.item.fields.quantity).toBe(1.5);
    expect(second.item.fields.unit).toBe('kg');

    // Nur eine aktive Zeile. Die Outbox verdichtet Anlegen + Mengenänderung
    // derselben Zeile zu genau einem Upsert (PLAN.md §4.2).
    expect(await db.list_items.count()).toBe(1);
    const outbox = await readOutbox(db);
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]).toMatchObject({ table: 'list_items', op: 'upsert' });
    const changedFields = (outbox.entries[0]?.payload as unknown as { changed_fields: string[] })
      .changed_fields;
    expect(changedFields).toContain('quantity');
  });

  it('legt bei anderer Dimension eine eigene Zeile an und weist darauf hin', async () => {
    await addItemLocal(db, { list_id: 'liste-1', name: 'Tomaten', quantity: 1, unit: 'kg' }, T1);
    const second = await addItemLocal(
      db,
      { list_id: 'liste-1', name: 'Tomaten', quantity: 2, unit: 'Stk' },
      T2,
    );

    expect(second.created).toBe(true);
    expect(second.preview.kind).toBe('new-line');
    expect(second.preview.hint).toContain('anderer Dimension');
    expect(await db.list_items.count()).toBe(2);
  });

  it('kategorisiert neue Zeilen automatisch über die Regeln', async () => {
    const result = await addItemLocal(
      db,
      { list_id: 'liste-1', name: 'Bananen', quantity: 3, unit: 'Stk' },
      T1,
    );
    expect(result.item.fields.category_id).toBe('obst_gemuese');
  });

  it('respektiert eine gelernte Haushaltsregel bei neuen Artikeln', async () => {
    await learnCategoryRuleLocal(
      db,
      {
        articleName: 'Zauberpulver',
        categoryKey: 'drogerie' as CategoryKey,
        householdId: HOUSEHOLD,
      },
      T1,
    );
    const result = await addItemLocal(
      db,
      { list_id: 'liste-1', name: 'Zauberpulver', quantity: 1, unit: 'Stk' },
      T2,
      { householdId: HOUSEHOLD },
    );
    expect(result.item.fields.category_id).toBe('drogerie');
  });
});
