'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import type { ListItem } from '@einkaufszettel/core';
import { getDb, indexedDbAvailable } from './database';
import { rowToListItem } from './repository';

/**
 * Reaktiver Lesezugriff auf Dexie. Die UI liest ausschließlich hieraus
 * (PLAN.md §4.2); Schreibvorgänge laufen über das Repository.
 */
export function useActiveListItems(listId?: string): ListItem[] {
  const items = useLiveQuery(async () => {
    if (!indexedDbAvailable()) return [];
    const db = getDb();
    const rows =
      listId === undefined
        ? await db.list_items.toArray()
        : await db.list_items.where('list_id').equals(listId).toArray();
    return rows
      .filter((row) => row.deleted_at === null)
      .map(rowToListItem)
      .sort((a, b) => a.fields.name.localeCompare(b.fields.name, 'de'));
  }, [listId]);

  return items ?? [];
}

export function useActiveItemCount(): number {
  const count = useLiveQuery(async () => {
    if (!indexedDbAvailable()) return 0;
    return getDb()
      .list_items.filter((row) => row.deleted_at === null)
      .count();
  }, []);
  return count ?? 0;
}

export function usePendingOutboxCount(): number {
  const count = useLiveQuery(async () => {
    if (!indexedDbAvailable()) return 0;
    return getDb().outbox.count();
  }, []);
  return count ?? 0;
}
