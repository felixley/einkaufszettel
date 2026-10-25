'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { validateEmail } from '@/lib/auth/validation';

export default function ForgotPasswordPage() {
  const { requestPasswordReset, mode } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }
    setPending(true);
    try {
      const result = await requestPasswordReset(email.trim());
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSent(true);
    } catch {
      setError('Anfrage fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <h1>Passwort vergessen</h1>
      <p className="muted">
        Wir senden dir einen Link zum Zurücksetzen, sofern ein Konto existiert.
        {mode === 'mock' ? <span className="badge"> Dev-Mock-Auth </span> : null}
      </p>

      {sent ? (
        <>
          <p className="alert success">
            Wenn ein Konto mit dieser Adresse existiert, ist eine E-Mail unterwegs.
          </p>
          {mode === 'mock' ? (
            <div className="card">
              <h2>Mock-Modus</h2>
              <p className="hint">
                Im Dev-/E2E-Modus wird keine E-Mail versendet. Du kannst das Passwort hier
                direkt neu setzen.
              </p>
              <Link className="button" href={`/reset-password?email=${encodeURIComponent(email.trim())}`}>
                Passwort jetzt neu setzen
              </Link>
            </div>
          ) : null}
        </>
      ) : (
        <form className="stack" onSubmit={handleSubmit} noValidate>
          {error ? (
            <p className="alert error" role="alert">
              {error}
            </p>
          ) : null}
          <div>
            <label htmlFor="forgot-email">E-Mail-Adresse</label>
            <input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <button type="submit" disabled={pending}>
            {pending ? 'Wird gesendet …' : 'Reset-Link senden'}
          </button>
        </form>
      )}

      <div className="link-row">
        <Link href="/login">Zurück zur Anmeldung</Link>
        <Link href="/">Zurück zur Startseite</Link>
      </div>
    </main>
  );
}
