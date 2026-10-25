import { MockAuthAdapter } from './mock';
import { isMockAuth } from './mode';
import { SupabaseAuthAdapter } from './supabase';
import type { AuthAdapter } from './types';

export type { AuthAdapter, AuthError, AuthResult, AuthUser, SimpleResult } from './types';
export { isMockAuth } from './mode';
export { MOCK_SESSION_COOKIE } from './session';
export {
  normalizeEmail,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from './validation';

let adapter: AuthAdapter | null = null;

/** Liefert den zum Build-Zeitpunkt konfigurierten Auth-Adapter (Singleton). */
export function getAuthAdapter(): AuthAdapter {
  if (adapter) return adapter;
  adapter = isMockAuth() ? new MockAuthAdapter() : new SupabaseAuthAdapter();
  return adapter;
}
