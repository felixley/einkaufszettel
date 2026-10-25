/**
 * Provisorische Namensnormalisierung für die Sync-Aggregation.
 *
 * Die vollständige Normalisierung (Plural-/Synonymliste) gehört zu T3.1. Bis
 * dahin gilt: trimmen, Kleinschreibung, Mehrfach-Whitespace zusammenfassen.
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
