import type { SyncAdapter } from '@einkaufszettel/core';

/**
 * Adapter für den Dev-Mock-Modus: Es gibt keinen Server, also werden
 * Outbox-Einträge quittiert, ohne etwas zu übertragen. Der Status zeigt
 * bewusst „Nur lokal (Dev)“, damit niemand einen echten Sync annimmt.
 *
 * Die Methoden nehmen bewusst keine Parameter an: TypeScript erlaubt
 * Implementierungen mit weniger Parametern als das Interface; so entstehen
 * keine ungenutzten Variablen.
 */
export class LocalOnlySyncAdapter implements SyncAdapter {
  upsert(): void {
    // Kein Server im Mock-Modus.
  }

  softDelete(): void {
    // Kein Server im Mock-Modus.
  }

  addToList(): void {
    // Kein Server im Mock-Modus.
  }
}
