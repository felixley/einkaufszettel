'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getHouseholdAdapter, sha256Hex, uuidv7 } from '@/lib/household';
import type { AcceptInviteResult, InvitePreview } from '@/lib/household/types';
import { ROLE_LABELS } from '@/lib/household/types';

const INVALID_MESSAGES: Record<string, string> = {
  expired: 'Diese Einladung ist abgelaufen. Bitte um eine neue Einladung.',
  revoked: 'Diese Einladung wurde widerrufen. Bitte um eine neue Einladung.',
  exhausted: 'Diese Einladung ist bereits aufgebraucht. Bitte um eine neue Einladung.',
  not_found: 'Einladung nicht gefunden. Bitte pruefe den Link.',
};

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const rawToken = params?.['token'];
  const token = Array.isArray(rawToken) ? (rawToken[0] ?? '') : (rawToken ?? '');

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState<AcceptInviteResult | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
    }
  }, [authLoading, user, router, token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('Kein Einladungstoken im Link gefunden.');
      return;
    }
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void sha256Hex(token)
      .then((hash) => getHouseholdAdapter().checkInvite(hash))
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setPreview(result.data);
        else setError(result.error.message);
      })
      .catch(() => {
        if (!cancelled) setError('Einladung konnte nicht geprueft werden.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  async function handleAccept(): Promise<void> {
    if (!token) return;
    setAccepting(true);
    setError(null);
    try {
      const hash = await sha256Hex(token);
      const result = await getHouseholdAdapter().acceptInvite(hash, uuidv7());
      if (result.ok) setAccepted(result.data);
      else setError(result.error.message);
    } catch {
      setError('Beitritt fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setAccepting(false);
    }
  }

  if (authLoading || loading) {
    return (
      <main>
        <p className="muted">Einladung wird geprueft …</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main>
        <p className="alert error" role="alert">
          Nicht angemeldet. Du wirst zur Anmeldung weitergeleitet …
        </p>
        <Link className="button" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
          Zur Anmeldung
        </Link>
      </main>
    );
  }

  return (
    <main data-testid="invite-page">
      <h1>Einladung</h1>

      {error ? (
        <p className="alert error" role="alert" data-testid="invite-error">
          {error}
        </p>
      ) : null}

      {accepted ? (
        <div className="card" data-testid="invite-success">
          <h2>{accepted.alreadyMember ? 'Bereits Mitglied' : 'Beigetreten'}</h2>
          <p>
            {accepted.alreadyMember
              ? `Du bist bereits Mitglied von ${accepted.householdName}.`
              : `Willkommen bei ${accepted.householdName}!`}
          </p>
          <p className="muted">
            Rolle: <strong>{ROLE_LABELS[accepted.role]}</strong>
            {accepted.restoredMember ? ' (Mitgliedschaft wiederhergestellt)' : ''}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <Link className="button" href="/household">
              Zum Haushalt
            </Link>
            <Link className="button secondary" href="/lists">
              Zu den Listen
            </Link>
          </div>
        </div>
      ) : preview?.valid ? (
        <div className="card" data-testid="invite-preview">
          <h2>Beitritt zu {preview.householdName ?? 'einem Haushalt'}</h2>
          <p className="muted">
            Rolle:{' '}
            <strong data-testid="invite-role">
              {preview.role ? ROLE_LABELS[preview.role] : '–'}
            </strong>
          </p>
          <p className="hint">
            Gueltig bis{' '}
            {preview.expiresAt ? new Date(preview.expiresAt).toLocaleString('de-DE') : '–'}
            {typeof preview.remainingUses === 'number'
              ? ` · noch ${preview.remainingUses} Nutzung(en)`
              : ''}
          </p>
          {!preview.householdName ? (
            <p className="hint">
              Der Haushaltsname wird aus Sicherheitsgruenden erst nach dem Beitritt angezeigt.
            </p>
          ) : null}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              marginTop: '0.75rem',
            }}
          >
            <button
              type="button"
              onClick={() => void handleAccept()}
              disabled={accepting}
              data-testid="invite-accept"
            >
              {accepting ? 'Beitritt laeuft …' : 'Haushalt beitreten'}
            </button>
            <Link className="button secondary" href="/lists">
              Abbrechen
            </Link>
          </div>
        </div>
      ) : preview ? (
        <div
          className="card"
          data-testid="invite-invalid"
          data-reason={preview.reason ?? 'not_found'}
        >
          <h2>Einladung nicht gueltig</h2>
          <p className="alert error" role="alert">
            {INVALID_MESSAGES[preview.reason ?? 'not_found'] ?? INVALID_MESSAGES['not_found']}
          </p>
          <p className="hint">
            Bitte wende dich an die Person, die dich eingeladen hat, und lasse dir einen neuen Link
            schicken.
          </p>
          <Link className="button secondary" href="/lists">
            Zu den Listen
          </Link>
        </div>
      ) : (
        <p className="muted">Keine Einladungsdaten verfuegbar.</p>
      )}

      <div className="link-row">
        <Link href="/">Zur Startseite</Link>
      </div>
    </main>
  );
}
