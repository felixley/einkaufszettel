'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from '@/lib/auth/validation';

export default function ResetPasswordPage() {
  const { completePasswordReset, mode } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    if (emailParam) setEmail(emailParam);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    const confirmationError = validatePasswordConfirmation(password, confirmation);
    if (confirmationError) {
      setError(confirmationError);
      return;
    }
    setPending(true);
    try {
      const result = await completePasswordReset(email.trim(), password);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.replace(`/login?reset=1&email=${encodeURIComponent(email.trim())}`);
    } catch {
      setError('Passwort konnte nicht geändert werden. Bitte erneut versuchen.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <h1>Neues Passwort setzen</h1>
      <p className="muted">
        Setze ein neues Passwort für dein Konto.
        {mode === 'mock' ? <span className="badge"> Dev-Mock-Auth </span> : null}
      </p>

      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="stack" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="reset-email">E-Mail-Adresse</label>
          <input
            id="reset-email"
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
        <div>
          <label htmlFor="reset-password">Neues Passwort (mind. 8 Zeichen)</label>
          <input
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="reset-confirmation">Neues Passwort wiederholen</label>
          <input
            id="reset-confirmation"
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? 'Wird gespeichert …' : 'Passwort speichern'}
        </button>
      </form>

      <div className="link-row">
        <Link href="/login">Zurück zur Anmeldung</Link>
      </div>
    </main>
  );
}
