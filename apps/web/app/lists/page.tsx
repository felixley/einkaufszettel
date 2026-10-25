'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

export default function ListsPage() {
  const { user, loading, signOut, mode } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);

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

      <div className="card">
        <h2>Angemeldet</h2>
        <p className="muted">{user.email}</p>
        {mode === 'mock' ? <p className="hint">Dev-Mock-Auth – Session nur lokal im Browser.</p> : null}
      </div>

      <div className="card">
        <h2>Nächste Schritte</h2>
        <p className="hint">
          Diese Route ist geschützt (Middleware + Client-Guard). Die eigentliche Listen-UI
          folgt in T2.6; Haushalte/Listen in T2.2, Einladungen in T2.3.
        </p>
      </div>

      <div className="link-row">
        <Link href="/">Zurück zur Startseite</Link>
      </div>
    </main>
  );
}
