/**
 * Kleiner localStorage-Cache für die Haushalts-ID.
 *
 * Rezepte sind haushaltsgebunden. Damit ein Rezept auch dann offline angelegt
 * werden kann, wenn `getMyHousehold()` (Netzwerk/RPC) nicht erreichbar ist,
 * merken wir uns die zuletzt bekannte ID. Sie ist keine Autorisierung – RLS
 * prüft serverseitig – sondern nur der FK-Wert für den Offline-Datensatz.
 */

const STORAGE_KEY = 'einkaufszettel:household-id';

export function cacheHouseholdId(householdId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, householdId);
  } catch {
    /* Storage voll/privat – Offline-Anlegen bleibt dann ohne Fallback. */
  }
}

export function readCachedHouseholdId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value !== null && value.trim() !== '' ? value : null;
  } catch {
    return null;
  }
}
