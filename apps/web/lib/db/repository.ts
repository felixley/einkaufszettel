import {
  CATEGORY_KEY_TO_ID,
  SEED_CATEGORY_RULES,
  type SeedCategoryRule,
} from '@/lib/data/category-seed';
import {
  applyCheck,
  categorize,
  createRuleFromManualChange,
  enqueue,
  latestTimestamp,
  learnFromManualChange,
  normalizeName,
  resolveRow,
  summarizeDuplicate,
  type AddToListEntry,
  type AddToListRequest,
  type CategoryKey,
  type CategoryRule,
  type ConflictResolution,
  type DeleteEntry,
  type DuplicatePreview,
  type FieldTimestamps,
  type ListItem,
  type ListItemFields,
  type ListItemRowData,
  type Outbox,
  type OutboxEntry,
  type ReplayResult,
  type UpsertEntry,
} from '@einkaufszettel/core';
import type { EinkaufszettelDB } from './database';
import type {
  LocalCategoryRuleRow,
  LocalListItemRow,
  LocalOutboxRow,
  NewListItemInput,
} from './types';
import { uuidv7 } from './uuid';

/** Ereignis, auf das der Sync-Worker sofort reagiert (statt bis zum Intervall zu warten). */
export const OUTBOX_CHANGED_EVENT = 'einkaufszettel:outbox-changed';

export type ListItemPatch = Partial<
  Pick<ListItemFields, 'name' | 'name_normalized' | 'quantity' | 'unit' | 'category_id' | 'note'>
>;

export interface MergeResult {
  item: ListItem;
  resolution: ConflictResolution;
}

function stampFields(fields: ListItemFields, at: string): FieldTimestamps<ListItemFields> {
  const stamps: FieldTimestamps<ListItemFields> = {};
  for (const key of Object.keys(fields) as (keyof ListItemFields)[]) stamps[key] = at;
  return stamps;
}

export function rowToListItem(row: LocalListItemRow): ListItem {
  return {
    id: row.id,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    field_updated_at: row.field_updated_at,
    fields: {
      list_id: row.list_id,
      name: row.name,
      name_normalized: row.name_normalized,
      quantity: row.quantity,
      unit: row.unit,
      category_id: row.category_id,
      checked: row.checked,
      checked_by: row.checked_by,
      source_recipe_id: row.source_recipe_id,
      note: row.note,
    },
  };
}

export function listItemToRow(item: ListItem): LocalListItemRow {
  return {
    ...item.fields,
    id: item.id,
    updated_at: item.updated_at,
    deleted_at: item.deleted_at,
    field_updated_at: item.field_updated_at,
  };
}

export function rowToOutboxEntry(row: LocalOutboxRow): OutboxEntry {
  return {
    id: row.id,
    table: row.table,
    op: row.op,
    client_ts: row.client_ts,
    attempts: row.attempts,
    payload: row.payload,
  } as OutboxEntry;
}

export function outboxEntryToRow(entry: OutboxEntry): LocalOutboxRow {
  return {
    id: entry.id,
    table: entry.table,
    op: entry.op,
    client_ts: entry.client_ts,
    attempts: entry.attempts,
    payload: entry.payload,
  };
}

export function rowDataFromFields(id: string, fields: ListItemFields): ListItemRowData {
  return { id, ...fields };
}

function notifyOutboxChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
}

function errorToString(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unbekannter Fehler';
  }
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export async function readOutbox(db: EinkaufszettelDB): Promise<Outbox> {
  const rows = await db.outbox.toArray();
  return { entries: rows.map(rowToOutboxEntry) };
}

/** Schreibt den Outbox-Stand zurück; entfernt quittierte und aktualisierte Zeilen. */
export async function writeOutbox(db: EinkaufszettelDB, outbox: Outbox): Promise<void> {
  const nextIds = new Set(outbox.entries.map((entry) => entry.id));
  const existingIds = (await db.outbox.toCollection().primaryKeys()) as string[];
  const removed = existingIds.filter((id) => !nextIds.has(id));
  if (removed.length > 0) await db.outbox.bulkDelete(removed);
  if (outbox.entries.length > 0) await db.outbox.bulkPut(outbox.entries.map(outboxEntryToRow));
}

/** Legt einen Eintrag idempotent ab; setzt eine laufende Transaktion voraus. */
export async function enqueueOutbox(db: EinkaufszettelDB, entry: OutboxEntry): Promise<Outbox> {
  const current = await readOutbox(db);
  const next = enqueue(current, entry);
  await writeOutbox(db, next);
  return next;
}

/** Persistiert das Ergebnis von `replayOutbox` (Quittungen, Fehlerzähler, Dead-Letter). */
export async function saveReplayResult(
  db: EinkaufszettelDB,
  result: ReplayResult,
  now: string,
): Promise<void> {
  await db.transaction('rw', db.outbox, db.dead_letter, async () => {
    if (result.applied.length > 0) await db.outbox.bulkDelete([...result.applied]);

    const failedIds = new Set(result.failed.map((failure) => failure.id));
    for (const entry of result.outbox.entries) {
      if (failedIds.has(entry.id)) await db.outbox.update(entry.id, { attempts: entry.attempts });
    }

    for (const id of result.deadLettered) {
      const deadEntry = result.deadLetter.entries.find((candidate) => candidate.id === id);
      if (deadEntry === undefined) continue;
      const failure = result.failed.find((candidate) => candidate.id === id);
      await db.outbox.delete(id);
      await db.dead_letter.put({
        id,
        entry: outboxEntryToRow(deadEntry),
        failed_at: now,
        error: errorToString(failure?.error),
      });
    }
  });
}

export async function countPending(db: EinkaufszettelDB): Promise<number> {
  return db.outbox.count();
}

export async function countDeadLetters(db: EinkaufszettelDB): Promise<number> {
  return db.dead_letter.count();
}

// ---------------------------------------------------------------------------
// Lokale Schreibvorgänge (Dexie + Outbox atomar)
// ---------------------------------------------------------------------------

/**
 * Legt einen Artikel lokal an und reiht den Upsert in die Outbox ein.
 * UI-Pfad: erst Dexie, dann Outbox (PLAN.md §4.2).
 */
export async function createItemLocal(
  db: EinkaufszettelDB,
  input: NewListItemInput,
  now: string,
): Promise<ListItem> {
  const fields: ListItemFields = {
    list_id: input.list_id,
    name: input.name,
    name_normalized: input.name_normalized ?? normalizeName(input.name),
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
    category_id: input.category_id ?? null,
    checked: input.checked ?? false,
    checked_by: input.checked_by ?? null,
    source_recipe_id: input.source_recipe_id ?? null,
    note: input.note ?? null,
  };
  const item: ListItem = {
    id: input.id ?? uuidv7(),
    updated_at: now,
    deleted_at: null,
    field_updated_at: stampFields(fields, now),
    fields,
  };

  await db.transaction('rw', db.list_items, db.outbox, async () => {
    await db.list_items.put(listItemToRow(item));
    const entry: UpsertEntry = {
      id: uuidv7(),
      table: 'list_items',
      op: 'upsert',
      client_ts: now,
      attempts: 0,
      payload: {
        row: rowDataFromFields(item.id, fields),
        changed_fields: Object.keys(fields),
      },
    };
    await enqueueOutbox(db, entry);
  });
  notifyOutboxChanged();
  return item;
}

/** Ändert einzelne Felder; identische Werte erzeugen keinen Outbox-Eintrag. */
export async function updateItemLocal(
  db: EinkaufszettelDB,
  id: string,
  patch: ListItemPatch,
  now: string,
): Promise<ListItem | null> {
  return db.transaction('rw', db.list_items, db.outbox, async () => {
    const row = await db.list_items.get(id);
    if (row === undefined || row.deleted_at !== null) return null;

    const current = rowToListItem(row);
    const fields: ListItemFields = { ...current.fields };
    const stamps: FieldTimestamps<ListItemFields> = { ...current.field_updated_at };
    const changed: string[] = [];

    const assign = <K extends keyof ListItemFields>(key: K, value: ListItemFields[K]): void => {
      if (Object.is(fields[key], value)) return;
      fields[key] = value;
      stamps[key] = now;
      changed.push(key);
    };

    if (patch.name !== undefined) {
      assign('name', patch.name);
      assign('name_normalized', patch.name_normalized ?? normalizeName(patch.name));
    } else if (patch.name_normalized !== undefined) {
      assign('name_normalized', patch.name_normalized);
    }
    if (patch.quantity !== undefined) assign('quantity', patch.quantity);
    if (patch.unit !== undefined) assign('unit', patch.unit);
    if (patch.category_id !== undefined) assign('category_id', patch.category_id);
    if (patch.note !== undefined) assign('note', patch.note);

    if (changed.length === 0) return current;

    const item: ListItem = {
      ...current,
      updated_at: latestTimestamp(current.updated_at, now),
      field_updated_at: stamps,
      fields,
    };
    await db.list_items.put(listItemToRow(item));
    const entry: UpsertEntry = {
      id: uuidv7(),
      table: 'list_items',
      op: 'upsert',
      client_ts: now,
      attempts: 0,
      payload: { row: rowDataFromFields(id, fields), changed_fields: changed },
    };
    await enqueueOutbox(db, entry);
    notifyOutboxChanged();
    return item;
  });
}

/** Setzt `checked` idempotent über die core-Regel; wiederholtes Abhaken ist ein No-op. */
export async function checkItemLocal(
  db: EinkaufszettelDB,
  id: string,
  checked: boolean,
  now: string,
  by: string | null = null,
): Promise<ListItem | null> {
  return db.transaction('rw', db.list_items, db.outbox, async () => {
    const row = await db.list_items.get(id);
    if (row === undefined) return null;

    const current = rowToListItem(row);
    const next = applyCheck(current, checked, { at: now, by });
    if (next === current) return current;

    const changed: string[] = [];
    if (next.fields.checked !== current.fields.checked) changed.push('checked');
    if (next.fields.checked_by !== current.fields.checked_by) changed.push('checked_by');
    if (changed.length === 0) return current;

    await db.list_items.put(listItemToRow(next));
    const entry: UpsertEntry = {
      id: uuidv7(),
      table: 'list_items',
      op: 'upsert',
      client_ts: now,
      attempts: 0,
      payload: { row: rowDataFromFields(id, next.fields), changed_fields: changed },
    };
    await enqueueOutbox(db, entry);
    notifyOutboxChanged();
    return next;
  });
}

/** Soft-Delete; ein Delete verdrängt in der Outbox alle offenen Upserts derselben Zeile. */
export async function deleteItemLocal(
  db: EinkaufszettelDB,
  id: string,
  now: string,
): Promise<boolean> {
  return db.transaction('rw', db.list_items, db.outbox, async () => {
    const row = await db.list_items.get(id);
    if (row === undefined) return false;
    if (row.deleted_at !== null) return true;

    const item = rowToListItem(row);
    const deleted: ListItem = {
      ...item,
      deleted_at: now,
      updated_at: latestTimestamp(item.updated_at, now),
    };
    await db.list_items.put(listItemToRow(deleted));
    const entry: DeleteEntry = {
      id: uuidv7(),
      table: 'list_items',
      op: 'delete',
      client_ts: now,
      attempts: 0,
      payload: { id },
    };
    await enqueueOutbox(db, entry);
    notifyOutboxChanged();
    return true;
  });
}

/** Reiht die RPC `add_to_list` ein (Mengen-Aggregation serverseitig, PLAN.md §4.2). */
export async function enqueueAddToListLocal(
  db: EinkaufszettelDB,
  request: AddToListRequest,
  now: string,
): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const entry: AddToListEntry = {
      id: uuidv7(),
      table: 'list_items',
      op: 'add_to_list',
      client_ts: now,
      attempts: 0,
      payload: request,
    };
    await enqueueOutbox(db, entry);
  });
  notifyOutboxChanged();
}

// ---------------------------------------------------------------------------
// Remote-Stand einmischen (Realtime / Pull)
// ---------------------------------------------------------------------------

/**
 * Übernimmt eine Server-Zeile in Dexie, ohne einen neuen Outbox-Eintrag zu
 * erzeugen. Feldweises LWW läuft über `resolveRow`; Delete gewinnt gegen Edit.
 *
 * Der Server liefert keine Feld-Zeitstempel. Für Felder, deren Wert sich nicht
 * geändert hat, bleibt der lokale Zeitstempel erhalten; nur tatsächlich
 * abweichende Felder werden mit `updated_at` des Servers gestempelt. So gehen
 * parallele Änderungen an unterschiedlichen Feldern nicht verloren.
 */
export async function mergeRemoteItem(
  db: EinkaufszettelDB,
  remote: ListItem,
): Promise<MergeResult> {
  return db.transaction('rw', db.list_items, db.outbox, async () => {
    const row = await db.list_items.get(remote.id);
    if (row === undefined) {
      await db.list_items.put(listItemToRow(remote));
      return { item: remote, resolution: remote.deleted_at === null ? 'remote' : 'deleted' };
    }

    const local = rowToListItem(row);
    const dirtyFields = await pendingChangedFields(db, remote.id);
    const normalizedRemote: ListItem = {
      ...remote,
      fields: { ...remote.fields },
      field_updated_at: normalizeRemoteStamps(local, remote, dirtyFields),
    };
    // Noch nicht übertragene lokale Änderungen nicht durch ein Realtime-Event
    // überschreiben: Serverzeile hat für diese Felder den alten Stand.
    const remoteFields = normalizedRemote.fields as unknown as Record<
      keyof ListItemFields,
      unknown
    >;
    const localFields = local.fields as unknown as Record<keyof ListItemFields, unknown>;
    for (const field of dirtyFields) remoteFields[field] = localFields[field];
    if (local.deleted_at !== null) normalizedRemote.deleted_at = local.deleted_at;

    const result = resolveRow(local, normalizedRemote);
    await db.list_items.put(listItemToRow(result.row));
    await syncPendingUpsertPayloads(db, result.row);
    return { item: result.row, resolution: result.resolution };
  });
}

function rowIdOf(entry: OutboxEntry): string | null {
  if (entry.op === 'delete') return entry.payload.id;
  if (entry.op === 'upsert') return entry.payload.row.id;
  return null;
}

/**
 * Hält offene Upserts mit dem zusammengeführten Stand synchron. Sonst würde
 * ein Replay den gerade eingemischten Remote-Stand mit dem alten lokalen
 * Payload wieder überschreiben.
 */
async function syncPendingUpsertPayloads(db: EinkaufszettelDB, merged: ListItem): Promise<void> {
  const outbox = await readOutbox(db);

  if (merged.deleted_at !== null) {
    const withoutUpserts: Outbox = {
      entries: outbox.entries.filter(
        (entry) => !(entry.op === 'upsert' && rowIdOf(entry) === merged.id),
      ),
    };
    const hasDelete = withoutUpserts.entries.some(
      (entry) => entry.op === 'delete' && rowIdOf(entry) === merged.id,
    );
    if (hasDelete) {
      await writeOutbox(db, withoutUpserts);
      return;
    }
    const deleteEntry: DeleteEntry = {
      id: uuidv7(),
      table: 'list_items',
      op: 'delete',
      client_ts: merged.deleted_at,
      attempts: 0,
      payload: { id: merged.id },
    };
    await writeOutbox(db, enqueue(withoutUpserts, deleteEntry));
    return;
  }

  let changed = false;
  const entries = outbox.entries.map((entry): OutboxEntry => {
    if (entry.op !== 'upsert' || rowIdOf(entry) !== merged.id) return entry;
    changed = true;
    return {
      ...entry,
      payload: {
        row: rowDataFromFields(merged.id, merged.fields),
        changed_fields: Object.keys(merged.fields),
      },
    };
  });
  if (changed) await writeOutbox(db, { entries });
}

/** Felder, für die in der Outbox noch ein Upsert auf diese Zeile wartet. */
async function pendingChangedFields(
  db: EinkaufszettelDB,
  rowId: string,
): Promise<Set<keyof ListItemFields>> {
  const dirty = new Set<keyof ListItemFields>();
  const entries = await db.outbox.toArray();
  for (const entry of entries) {
    if (entry.op !== 'upsert' || entry.table !== 'list_items') continue;
    const payload = entry.payload as { row?: { id?: string }; changed_fields?: readonly string[] };
    if (payload.row?.id !== rowId) continue;
    for (const field of payload.changed_fields ?? []) dirty.add(field as keyof ListItemFields);
  }
  return dirty;
}

function normalizeRemoteStamps(
  local: ListItem,
  remote: ListItem,
  dirtyFields: ReadonlySet<keyof ListItemFields>,
): FieldTimestamps<ListItemFields> {
  const stamps: FieldTimestamps<ListItemFields> = { ...remote.field_updated_at };
  for (const key of Object.keys(remote.fields) as (keyof ListItemFields)[]) {
    if (dirtyFields.has(key) || Object.is(remote.fields[key], local.fields[key])) {
      stamps[key] = local.field_updated_at[key] ?? local.updated_at;
    }
  }
  return stamps;
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

export async function getItem(db: EinkaufszettelDB, id: string): Promise<ListItem | null> {
  const row = await db.list_items.get(id);
  return row === undefined ? null : rowToListItem(row);
}

/** Aktive (nicht soft-gelöschte) Artikel, optional auf eine Liste begrenzt. */
export async function getActiveItems(db: EinkaufszettelDB, listId?: string): Promise<ListItem[]> {
  const rows =
    listId === undefined
      ? await db.list_items.toArray()
      : await db.list_items.where('list_id').equals(listId).toArray();
  return rows
    .filter((row) => row.deleted_at === null)
    .map(rowToListItem)
    .sort((a, b) => a.fields.name.localeCompare(b.fields.name, 'de'));
}

export async function getDeadLetters(db: EinkaufszettelDB) {
  return db.dead_letter.toArray();
}

// ---------------------------------------------------------------------------
// Kategorisierung (A-7 / T2.7)
// ---------------------------------------------------------------------------

/** Meta-Schlüssel, der die geladene Seed-Version der globalen Regeln festhält. */
const CATEGORY_SEED_META_KEY = 'category_rules_seed_version';
const CATEGORY_SEED_VERSION = `v1:${SEED_CATEGORY_RULES.length}`;

export interface CategoryRuleCorrectionInput {
  articleName: string;
  categoryKey: CategoryKey;
  householdId: string;
}

export interface LearnedCategoryRule {
  rule: CategoryRule;
  /** true, wenn eine neue Zeile angelegt wurde; false bei Aktualisierung. */
  created: boolean;
}

export interface AddItemOptions {
  /**
   * Haushalts-ID für gelernte Regeln. `null`/`undefined` = nur globale
   * Seed-Regeln, keine Haushaltsregel anlegen.
   */
  householdId?: string | null;
}

export interface AddItemResult {
  item: ListItem;
  preview: DuplicatePreview;
  /** true = neue Zeile, false = Menge einer bestehenden Zeile addiert. */
  created: boolean;
}

function categoryRuleFromRow(row: LocalCategoryRuleRow): CategoryRule {
  return {
    keyword: row.keyword,
    categoryKey: row.category_key,
    householdId: row.household_id,
  };
}

function categoryRuleRowFromSeed(rule: SeedCategoryRule, now: string): LocalCategoryRuleRow {
  return {
    id: rule.id,
    household_id: null,
    keyword: rule.keyword,
    category_key: rule.categoryKey,
    category_id: CATEGORY_KEY_TO_ID[rule.categoryKey],
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

/**
 * Legt die globalen Seed-Regeln (T1.5) einmalig in Dexie ab, damit die
 * Kategorisierung offline ohne Backend läuft. Die IDs sind fest, der Vorgang
 * ist daher idempotent. Globale Regeln wandern **nicht** in die Outbox — sie
 * existieren serverseitig bereits per Seed.
 *
 * @returns Anzahl der geschriebenen Regeln (0, wenn schon aktuell).
 */
export async function ensureCategoryRulesSeeded(
  db: EinkaufszettelDB,
  now: string,
): Promise<number> {
  const meta = await db.meta.get(CATEGORY_SEED_META_KEY);
  if (meta?.value === CATEGORY_SEED_VERSION) return 0;

  const rows = SEED_CATEGORY_RULES.map((rule) => categoryRuleRowFromSeed(rule, now));
  await db.transaction('rw', db.category_rules, db.meta, async () => {
    await db.category_rules.bulkPut(rows);
    await db.meta.put({ key: CATEGORY_SEED_META_KEY, value: CATEGORY_SEED_VERSION });
  });
  return rows.length;
}

/**
 * Alle anwendbaren Regeln: globale Seed-Regeln plus die Regeln des Haushalts.
 *
 * Solange der Seed noch nicht in Dexie liegt (frischer Browser, Aufruf vor
 * `ensureCategoryRulesSeeded`), werden die globalen Regeln direkt aus dem
 * generierten Seed-Modul geliefert — so ist die Kategorisierung nie leer.
 */
export async function getCategoryRules(
  db: EinkaufszettelDB,
  householdId?: string | null,
): Promise<CategoryRule[]> {
  const rows = (await db.category_rules.toArray()).filter((row) => row.deleted_at === null);
  const global = rows.filter((row) => row.household_id === null).map(categoryRuleFromRow);
  const local =
    householdId === undefined || householdId === null
      ? []
      : rows.filter((row) => row.household_id === householdId).map(categoryRuleFromRow);

  const base =
    global.length > 0
      ? global
      : SEED_CATEGORY_RULES.map((rule) => ({
          keyword: rule.keyword,
          categoryKey: rule.categoryKey,
          householdId: null,
        }));

  return [...base, ...local];
}

/**
 * Kategorisiert einen Artikelnamen über die Regeln (T2.7).
 * Liefert den Schlüssel plus Trefferinformation (für UI-Hinweise).
 */
export async function categorizeItemNameLocal(
  db: EinkaufszettelDB,
  name: string,
  householdId?: string | null,
): Promise<ReturnType<typeof categorize>> {
  const rules = await getCategoryRules(db, householdId);
  return categorize(name, rules);
}

/**
 * Lernt aus einer manuellen Kategorie-Korrektur eine Haushaltsregel (T2.7).
 *
 * Nutzt die reinen core-Verträge (`createRuleFromManualChange` +
 * `learnFromManualChange`): eine bestehende Haushaltsregel mit gleichem
 * normalisiertem Keyword wird ersetzt. Persistiert wird nur der Unterschied —
 * eine unveränderte Korrektur erzeugt keinen Outbox-Eintrag.
 */
export async function learnCategoryRuleLocal(
  db: EinkaufszettelDB,
  input: CategoryRuleCorrectionInput,
  now: string,
): Promise<LearnedCategoryRule> {
  const createdRule = createRuleFromManualChange(input);
  const rows = (await db.category_rules.toArray()).filter((row) => row.deleted_at === null);
  const householdRules = rows
    .filter((row) => row.household_id === input.householdId)
    .map(categoryRuleFromRow);

  // core-Semantik anwenden: ersetzt eine bestehende Haushaltsregel.
  const merged = learnFromManualChange(householdRules, input);
  const rule = merged.find(
    (candidate) =>
      candidate.householdId === input.householdId && candidate.keyword === createdRule.keyword,
  );
  if (rule === undefined) {
    throw new Error('Gelernte Regel fehlt im Ergebnis von learnFromManualChange.');
  }

  const categoryId = CATEGORY_KEY_TO_ID[rule.categoryKey];
  const existing = rows.find(
    (row) => row.household_id === input.householdId && row.keyword === rule.keyword,
  );

  const row: LocalCategoryRuleRow =
    existing === undefined
      ? {
          id: uuidv7(),
          household_id: input.householdId,
          keyword: rule.keyword,
          category_key: rule.categoryKey,
          category_id: categoryId,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        }
      : {
          ...existing,
          category_key: rule.categoryKey,
          category_id: categoryId,
          updated_at: now,
        };

  if (existing !== undefined && existing.category_key === rule.categoryKey) {
    return { rule, created: false };
  }

  await db.transaction('rw', db.category_rules, db.outbox, async () => {
    await db.category_rules.put(row);
    const entry: UpsertEntry = {
      id: uuidv7(),
      table: 'category_rules',
      op: 'upsert',
      client_ts: now,
      attempts: 0,
      payload: {
        // Server-Spalten der Tabelle `category_rules` (FK ist `category_id`).
        row: {
          id: row.id,
          household_id: row.household_id,
          keyword: row.keyword,
          category_id: row.category_id,
          updated_at: now,
        } as unknown as ListItemRowData,
        changed_fields: ['keyword', 'category_id', 'updated_at'],
      },
    };
    await enqueueOutbox(db, entry);
  });
  notifyOutboxChanged();
  return { rule, created: existing === undefined };
}

/**
 * Speichert eine manuelle Kategorie-Korrektur am Artikel und lernt daraus eine
 * Haushaltsregel. Der Artikel-Update läuft über `updateItemLocal` (Outbox),
 * die Regel über `learnCategoryRuleLocal`.
 */
export async function correctItemCategoryLocal(
  db: EinkaufszettelDB,
  itemId: string,
  categoryKey: CategoryKey,
  householdId: string,
  now: string,
): Promise<ListItem | null> {
  const item = await getItem(db, itemId);
  if (item === null) return null;
  const updated = await updateItemLocal(db, itemId, { category_id: categoryKey }, now);
  await learnCategoryRuleLocal(
    db,
    { articleName: item.fields.name, categoryKey, householdId },
    now,
  );
  return updated;
}

/**
 * Add-Flow mit Duplikat-Zusammenfassung (T2.8) und Auto-Kategorisierung (T2.7).
 *
 * - gleicher `name_normalized` + gleiche Dimension → Menge wird auf der
 *   bestehenden Zeile addiert, `preview.hint` macht die Zusammenfassung sichtbar;
 * - andere Dimension → eigene Zeile, Hinweis im `preview.hint`;
 * - neue Zeile bekommt die Kategorie aus `categorize()` (sofern der Aufrufer
 *   keine Kategorie mitgibt).
 */
export async function addItemLocal(
  db: EinkaufszettelDB,
  input: NewListItemInput,
  now: string,
  options: AddItemOptions = {},
): Promise<AddItemResult> {
  const active = await getActiveItems(db, input.list_id);
  const preview = summarizeDuplicate(active, {
    name: input.name,
    name_normalized: input.name_normalized ?? normalizeName(input.name),
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
  });

  if (preview.kind === 'aggregate' && preview.targetId !== null) {
    const updated = await updateItemLocal(
      db,
      preview.targetId,
      { quantity: preview.quantity },
      now,
    );
    if (updated !== null) return { item: updated, preview, created: false };
  }

  // Die UI arbeitet mit Kategorie-Schlüsseln (`milch_eier`); die Server-UUID
  // entsteht erst an der Sync-Grenze (siehe `categoryKeyToDbId`).
  let categoryId = input.category_id ?? null;
  if (categoryId === null) {
    const result = await categorizeItemNameLocal(db, input.name, options.householdId ?? null);
    categoryId = result.categoryKey;
  }

  const item = await createItemLocal(db, { ...input, category_id: categoryId }, now);
  return { item, preview, created: true };
}

// Die Kategorie-Übersetzung liegt in `@/lib/data/category-map` (kein Zyklus mit
// der Sync-Schicht); hier nur re-exportiert für Aufrufer des Repositories.
export { categoryDbIdToKey, categoryKeyToDbId } from '@/lib/data/category-map';
