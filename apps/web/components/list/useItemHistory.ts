'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { getDb, indexedDbAvailable } from '@/lib/db/database';

export interface ItemHistoryEntry {
  /** Zuletzt verwendete Schreibweise. */
  name: string;
  /** Normalisierter Schlüssel für die Dublettenvermeidung. */
  key: string;
  quantity: number | null;
  unit: string | null;
  /** Wie oft der Artikel bereits eingetragen wurde. */
  count: number;
  /** Zeitstempel der letzten Verwendung (ISO). */
  lastUsed: string;
}

/**
 * Artikel-Historie aus Dexie für die Autovervollständigung (T4.5).
 * Bewusst in-memory dedupliziert: die Liste ist klein (Haushaltsumfang) und
 * so funktioniert die Suche auch ohne zusätzlichen Index.
 */
export function useItemHistory(): ItemHistoryEntry[] {
  const history = useLiveQuery(async () => {
    if (!indexedDbAvailable()) return [];
    const rows = await getDb().list_items.toArray();
    const byKey = new Map<string, ItemHistoryEntry>();

    for (const row of rows) {
      const key = row.name_normalized?.trim();
      if (!key) continue;
      const previous = byKey.get(key);
      if (previous === undefined) {
        byKey.set(key, {
          name: row.name,
          key,
          quantity: row.quantity,
          unit: row.unit,
          count: 1,
          lastUsed: row.updated_at,
        });
        continue;
      }
      previous.count += 1;
      if (row.updated_at > previous.lastUsed) {
        previous.name = row.name;
        previous.quantity = row.quantity;
        previous.unit = row.unit;
        previous.lastUsed = row.updated_at;
      }
    }

    return [...byKey.values()].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed));
  }, []);

  return history ?? [];
}
