import { createBrowserClient } from '@supabase/ssr';
import type { AuthAdapter, AuthError, AuthResult, AuthUser, SimpleResult } from './types';

function authError(code: string, message: string): AuthError {
  return { code, message };
}

interface AuthApiErrorLike {
  code?: unknown;
  message?: unknown;
}

function mapError(error: AuthApiErrorLike | null): AuthError {
  if (!error) return authError('unknown', 'Unbekannter Auth-Fehler.');
  const message = typeof error.message === 'string' ? error.message : 'Unbekannter Auth-Fehler.';
  const code = typeof error.code === 'string' ? error.code : 'auth_error';
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return authError('invalid_credentials', 'E-Mail-Adresse oder Passwort ist falsch.');
  }
  if (code === 'user_already_exists' || /already registered/i.test(message)) {
    return authError('user_exists', 'Fuer diese E-Mail-Adresse existiert bereits ein Konto.');
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return authError('email_not_confirmed', 'Bitte zuerst die E-Mail-Adresse bestaetigen.');
  }
  return authError(code, message);
}

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase ist nicht konfiguriert (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY fehlen).',
    );
  }
  return createBrowserClient(url, anonKey);
}

export class SupabaseAuthAdapter implements AuthAdapter {
  readonly mode = 'supabase' as const;
  private readonly client = createSupabaseBrowserClient();

  async signUp(email: string, password: string): Promise<AuthResult> {
    const redirectTo =
      typeof window === 'undefined' ? undefined : `${window.location.origin}/login?registered=1`;
    const { data, error } = redirectTo
      ? await this.client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })
      : await this.client.auth.signUp({ email, password });
    if (error) return { ok: false, error: mapError(error) };
    const user = data.user;
    if (!user) {
      return {
        ok: false,
        error: authError('confirmation_required', 'Bitte die Bestaetigungs-E-Mail pruefen.'),
      };
    }
    return { ok: true, user: { id: user.id, email: user.email ?? email } };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: mapError(error) };
    const user = data.user;
    if (!user) return { ok: false, error: authError('no_user', 'Kein Benutzer in der Antwort.') };
    return { ok: true, user: { id: user.id, email: user.email ?? email } };
  }

  async signOut(): Promise<SimpleResult> {
    const { error } = await this.client.auth.signOut();
    if (error) return { ok: false, error: mapError(error) };
    return { ok: true };
  }

  async requestPasswordReset(email: string): Promise<SimpleResult> {
    const redirectTo =
      typeof window === 'undefined' ? undefined : `${window.location.origin}/reset-password`;
    const { error } = redirectTo
      ? await this.client.auth.resetPasswordForEmail(email, { redirectTo })
      : await this.client.auth.resetPasswordForEmail(email);
    if (error) return { ok: false, error: mapError(error) };
    return { ok: true };
  }

  async completePasswordReset(_email: string, newPassword: string): Promise<SimpleResult> {
    const { error } = await this.client.auth.updateUser({ password: newPassword });
    if (error) {
      const mapped = mapError(error);
      if (mapped.code === 'auth_error' || mapped.code === 'session_not_found') {
        return {
          ok: false,
          error: {
            code: 'invalid_reset_session',
            message: 'Reset-Link ungueltig oder abgelaufen.',
          },
        };
      }
      return { ok: false, error: mapped };
    }
    return { ok: true };
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? '' };
  }
}
