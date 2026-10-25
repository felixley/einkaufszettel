import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>Einkaufszettel</h1>
      <p className="muted">Kollaborative Einkaufsliste – local-first, offline-fähig.</p>

      <div className="stack">
        <Link className="button" href="/lists">
          Zur Einkaufsliste
        </Link>
        <Link className="button secondary" href="/login">
          Anmelden
        </Link>
        <Link className="button secondary" href="/register">
          Neues Konto anlegen
        </Link>
      </div>

      <div className="card">
        <h2>Status</h2>
        <p className="hint">
          Auth ist implementiert (Registrierung, Login, Logout, Passwort-Reset). Die
          Listen-Oberfläche folgt in T2.6; Haushalte und Einladungen in T2.2–T2.4.
        </p>
      </div>
    </main>
  );
}
