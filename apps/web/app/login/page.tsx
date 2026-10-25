'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '@/context/AuthContext';
import { validateEmail, validatePassword } from '@/lib/auth/validation';

function safeNextTarget(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/lists';
  return value;
}

export default function LoginPage() {
  const { signIn, mode } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [next, setNext] = useState('/lists');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(safeNextTarget(params.get('next')));
    if (params.get('registered') === '1') {
      setInfo('Konto angelegt. Bitte jetzt anmelden.');
    }
    if (params.get('reset') === '1') {
      setInfo('Passwort geändert. Bitte mit dem neuen Passwort anmelden.');
    }
    const emailParam = params.get('email');
    if (emailParam) setEmail(emailParam);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);
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
    setPending(true);
    try {
      const result = await signIn(email, password);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Anmeldung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <h1>Anmelden</h1>
      <p className="muted">
        Melde dich an, um deine Einkaufslisten zu sehen.
        {mode === 'mock' ? <span className="badge"> Dev-Mock-Auth </span> : null}
      </p>

      {info ? <p className="alert success">{info}</p> : null}
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="stack" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="login-email">E-Mail-Adresse</label>
          <input
            id="login-email"
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
          <label htmlFor="login-password">Passwort</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" disabled={pending}>
          {pending ? 'Anmeldung läuft …' : 'Anmelden'}
        </button>
      </form>

      <div className="link-row">
        <Link href="/forgot-password">Passwort vergessen?</Link>
        <Link href="/register">Neu registrieren</Link>
      </div>
      <div className="link-row">
        <Link href="/">Zurück zur Startseite</Link>
      </div>
    </main>
  );
}
