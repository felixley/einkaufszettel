'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getHouseholdAdapter } from '@/lib/household';
import type { HouseholdSummary } from '@/lib/household/types';
import { ROLE_LABELS } from '@/lib/household/types';
import { MemberManagementPanel } from '@/components/household/MemberManagementPanel';

export default function HouseholdPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [household, setHousehold] = useState<HouseholdSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [name, setName] = useState('Mein Haushalt');
  const [creating, setCreating] = useState(false);
  // Nur der erste Ladevorgang je Nutzer zeigt "Lade Haushalt …". Spaetere
  // Refreshes (z. B. nach einem Rollenwechsel im MemberManagementPanel) laufen
  // still, damit die Seite nicht in den Ladezustand kippt und das Panel samt
  // Erfolgs-Hinweis (member-info) nicht unmountet wird.
  const loadedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login?next=/household');
    }
  }, [authLoading, user, router]);

  const load = useCallback(async (): Promise<void> => {
    if (!user) {
      setLoading(false);
      return;
    }
    if (loadedForUserRef.current !== user.id) {
      setLoading(true);
    }
    setError(null);
    const result = await getHouseholdAdapter().getMyHousehold();
    if (result.ok) {
      setHousehold(result.data);
    } else {
      setError(result.error.message);
    }
    loadedForUserRef.current = user.id;
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!name.trim()) {
      setError('Bitte einen Haushaltsnamen eingeben.');
      return;
    }
    setCreating(true);
    setError(null);
    const result = await getHouseholdAdapter().createHousehold(name);
    if (result.ok) {
      setHousehold(result.data);
      setInfo('Haushalt angelegt.');
      router.refresh();
    } else {
      setError(result.error.message);
    }
    setCreating(false);
  }

  if (authLoading || loading) {
    return (
      <main>
        <p className="muted">Lade Haushalt …</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main>
        <p className="alert error" role="alert">
          Nicht angemeldet. Du wirst zur Anmeldung weitergeleitet …
        </p>
        <Link className="button" href="/login?next=/household">
          Zur Anmeldung
        </Link>
      </main>
    );
  }

  return (
    <main data-testid="household-page">
      <div className="topbar">
        <h1>Haushalt</h1>
        <Link
          href="/lists"
          className="button secondary"
          style={{ width: 'auto', minHeight: '2.75rem', padding: '0.5rem 0.9rem' }}
        >
          Zur Liste
        </Link>
      </div>

      {error ? (
        <p className="alert error" role="alert" data-testid="household-error">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="alert success" role="status" data-testid="household-info">
          {info}
        </p>
      ) : null}

      {household === null ? (
        <div className="card" data-testid="create-household-card">
          <h2>Noch kein Haushalt</h2>
          <p className="muted">
            Lege einen Haushalt an. Du wirst Owner und kannst danach weitere Personen einladen.
          </p>
          <form className="stack" onSubmit={(event) => void handleCreate(event)}>
            <div>
              <label htmlFor="household-name">Haushaltsname</label>
              <input
                id="household-name"
                name="householdName"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="organization"
              />
            </div>
            <button type="submit" disabled={creating} data-testid="create-household">
              {creating ? 'Haushalt wird angelegt …' : 'Haushalt anlegen'}
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginTop: 0 }}>
            <div className="topbar" style={{ marginBottom: 0 }}>
              <div>
                <h2 style={{ marginBottom: '0.15rem' }} data-testid="household-title">
                  {household.name}
                </h2>
                <p className="hint" style={{ margin: 0 }}>
                  Deine Rolle:{' '}
                  <strong data-testid="household-role">{ROLE_LABELS[household.role]}</strong>
                </p>
              </div>
              <span className="badge">{ROLE_LABELS[household.role]}</span>
            </div>
          </div>

          <MemberManagementPanel
            household={household}
            onLeft={() => {
              setHousehold(null);
              setInfo('Du hast den Haushalt verlassen.');
            }}
            onHouseholdChanged={() => {
              void load();
            }}
          />
        </>
      )}

      <div className="link-row">
        <Link href="/">Zur Startseite</Link>
        <Link href="/lists">Zu den Listen</Link>
      </div>
    </main>
  );
}
