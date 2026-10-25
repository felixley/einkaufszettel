'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { useAuth } from '@/context/AuthContext';
import { useActiveItemCount } from '@/lib/db/hooks';

export default function ListsPage() {
  const { user, loading, signOut, mode } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const localItemCount = useActiveItemCount();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?next=/lists');
    }
  }, [loading, user, router]);

  async function handleLogout() {
    setPending(true);
    try {
      await signOut();
      router.replace('/login');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main>
        <p className="muted">Lade Sitzung …</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main>
        <p className="alert error" role="alert">
          Nicht angemeldet. Du wirst zur Anmeldung weitergeleitet …
        </p>
        <Link className="button" href="/login?next=/lists">
          Zur Anmeldung
        </Link>
      </main>
    );
  }

  return (
    <main>
      <div className="topbar">
        <h1>Einkaufslisten</h1>
        <button type="button" onClick={handleLogout} disabled={pending}>
          {pending ? 'Abmelden …' : 'Abmelden'}
        </button>
      </div>

      <div className="sync-row">
        <SyncStatusBadge />
      </div>

      <div className="card">
        <h2>Angemeldet</h2>
        <p className="muted">{user.email}</p>
        {mode === 'mock' ? (
          <p className="hint">Dev-Mock-Auth – Session nur lokal im Browser.</p>
        ) : null}
      </div>

      <Link className="button" href="/household" data-testid="household-link">
        Haushalt und Mitglieder verwalten
      </Link>

      <div className="card">
        <h2>Lokale Daten</h2>
        <p className="muted">
          {localItemCount} Artikel in Dexie gespeichert. Die Oberfläche liest ausschließlich aus der
          lokalen Datenbank; Schreibvorgänge laufen über die Outbox.
        </p>
        <p className="hint">
          Die eigentliche Listen-UI folgt in T2.6. Sync-Status, Outbox und Realtime sind auf dieser
          Route bereits sichtbar.
        </p>
      </div>

      <div className="link-row">
        <Link href="/">Zurück zur Startseite</Link>
      </div>
    </main>
  );
}
