'use client';

/**
 * Offline-Hinweis mit Retry (T4.1). Wird von `/offline` gerendert; die
 * statische Service-Worker-Variante liegt zusätzlich unter `/offline.html`.
 */
export function OfflineFallback() {
  return (
    <main>
      <h1>Keine Verbindung</h1>
      <p className="muted">
        Diese Seite ist gerade nicht offline verfügbar. Sobald du wieder Netz hast, kannst du weiter
        einkaufen.
      </p>
      <p className="hint">Prüfe deine Verbindung und versuche es erneut.</p>
      <div className="stack">
        <button type="button" className="button" onClick={() => window.location.reload()}>
          Erneut versuchen
        </button>
        <a className="button secondary" href="/">
          Zur Startseite
        </a>
      </div>
    </main>
  );
}
