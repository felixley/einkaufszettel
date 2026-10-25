'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from '@/lib/auth/validation';

export default function RegisterPage() {
  const { signUp, mode } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
      const result = await signUp(email, password);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.replace(`/login?registered=1&email=${encodeURIComponent(email.trim())}`);
    } catch {
      setError('Registrierung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <h1>Konto anlegen</h1>
      <p className="muted">
        E-Mail und Passwort genügen. Kein Social-Login in v1.
        {mode === 'mock' ? <span className="badge"> Dev-Mock-Auth </span> : null}
      </p>

      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="stack" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="register-email">E-Mail-Adresse</label>
          <input
            id="register-email"
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
          <label htmlFor="register-password">Passwort (mind. 8 Zeichen)</label>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="register-confirmation">Passwort wiederholen</label>
          <input
            id="register-confirmation"
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? 'Konto wird angelegt …' : 'Konto anlegen'}
        </button>
      </form>

      <div className="link-row">
        <Link href="/login">Ich habe schon ein Konto</Link>
        <Link href="/">Zurück zur Startseite</Link>
      </div>
    </main>
  );
}
