export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthError {
  code: string;
  message: string;
}

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; error: AuthError };

export type SimpleResult = { ok: true } | { ok: false; error: AuthError };

/**
 * Abstraktion ueber den Auth-Anbieter. Die UI kennt nur dieses Interface.
 * - `supabase`: echter GoTrue-Stack (Self-hosted Supabase), wenn konfiguriert.
 * - `mock`: Offline-/Dev-Adapter (E2E ohne Netz, dokumentierte Abweichung).
 */
export interface AuthAdapter {
  readonly mode: 'supabase' | 'mock';
  signUp(email: string, password: string): Promise<AuthResult>;
  signIn(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<SimpleResult>;
  requestPasswordReset(email: string): Promise<SimpleResult>;
  /** Setzt ein neues Passwort (nach Klick auf den Reset-Link bzw. im Mock-Modus). */
  completePasswordReset(email: string, newPassword: string): Promise<SimpleResult>;
  getCurrentUser(): Promise<AuthUser | null>;
}
