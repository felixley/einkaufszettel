import type { CategoryKey } from '@einkaufszettel/core';
import { CATEGORY_ID_TO_KEY, CATEGORY_KEY_TO_ID } from './category-seed';

/**
 * Brücke zwischen UI- und Server-Repräsentation der Kategorie.
 *
 * Die UI speichert bewusst den sprechenden Schlüssel (`milch_eier`) in
 * `list_items.category_id`, weil Gruppierung, Anzeige und Offline-Regeln damit
 * ohne Server-Mapping funktionieren. Die Tabelle referenziert dagegen
 * `categories.id` (UUID). Übersetzt wird ausschließlich an der Sync-Grenze.
 *
 * Unbekannte Werte werden unverändert durchgereicht, damit weder Altdaten noch
 * künftige haushaltseigene Kategorien verloren gehen.
 */
export function categoryKeyToDbId(value: string | null): string | null {
  if (value === null) return null;
  const known = CATEGORY_KEY_TO_ID[value as CategoryKey];
  return known ?? value;
}

export function categoryDbIdToKey(value: string | null): string | null {
  if (value === null) return null;
  const known = (CATEGORY_ID_TO_KEY as Readonly<Record<string, CategoryKey>>)[value];
  return known ?? value;
}
