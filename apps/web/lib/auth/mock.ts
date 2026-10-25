import {
  MOCK_SESSION_COOKIE,
  MOCK_SESSION_MAX_AGE_SECONDS,
  base64UrlEncode,
  type MockSession,
} from './session';
import type { AuthAdapter, AuthError, AuthResult, AuthUser, SimpleResult } from './types';
import { normalizeEmail } from './validation';

export { MOCK_SESSION_COOKIE, decodeMockSession } from './session';

const USERS_KEY = 'ez_mock_users_v1';
const SESSION_KEY = 'ez_mock_session_v1';

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
}

async function hashPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function readUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StoredUser =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as StoredUser).id === 'string' &&
        typeof (entry as StoredUser).email === 'string' &&
        typeof (entry as StoredUser).passwordHash === 'string',
    );
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function writeSession(session: MockSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  document.cookie = `${MOCK_SESSION_COOKIE}=${base64UrlEncode(
    JSON.stringify(session),
  )}; Path=/; Max-Age=${MOCK_SESSION_MAX_AGE_SECONDS}; SameSite=Lax`;
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  document.cookie = `${MOCK_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function readSession(): MockSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<MockSession>;
    if (
      typeof candidate.sub !== 'string' ||
      typeof candidate.email !== 'string' ||
      typeof candidate.exp !== 'number' ||
      candidate.exp <= Date.now()
    ) {
      clearSession();
      return null;
    }
    return { sub: candidate.sub, email: candidate.email, exp: candidate.exp };
  } catch {
    return null;
  }
}

const notAvailable: AuthError = {
  code: 'storage_unavailable',
  message: 'Lokaler Speicher ist nicht verfuegbar (Mock-Auth nur im Browser).',
};

function toUser(session: MockSession): AuthUser {
  return { id: session.sub, email: session.email };
}

export class MockAuthAdapter implements AuthAdapter {
  readonly mode = 'mock' as const;

  async signUp(email: string, password: string): Promise<AuthResult> {
    if (typeof localStorage === 'undefined' || typeof document === 'undefined') {
      return { ok: false, error: notAvailable };
    }
    const normalized = normalizeEmail(email);
    const users = readUsers();
    if (users.some((user) => user.email === normalized)) {
      return {
        ok: false,
        error: {
          code: 'user_exists',
          message: 'Fuer diese E-Mail-Adresse existiert bereits ein Konto.',
        },
      };
    }
    const user: StoredUser = {
      id: crypto.randomUUID(),
      email: normalized,
      passwordHash: await hashPassword(password),
    };
    writeUsers([...users, user]);
    return { ok: true, user: { id: user.id, email: user.email } };
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    if (typeof localStorage === 'undefined' || typeof document === 'undefined') {
      return { ok: false, error: notAvailable };
    }
    const normalized = normalizeEmail(email);
    const users = readUsers();
    const user = users.find((entry) => entry.email === normalized);
    const passwordHash = await hashPassword(password);
    if (!user || user.passwordHash !== passwordHash) {
      return {
        ok: false,
        error: { code: 'invalid_credentials', message: 'E-Mail-Adresse oder Passwort ist falsch.' },
      };
    }
    const session: MockSession = {
      sub: user.id,
      email: user.email,
      exp: Date.now() + MOCK_SESSION_MAX_AGE_SECONDS * 1000,
    };
    writeSession(session);
    return { ok: true, user: toUser(session) };
  }

  async signOut(): Promise<SimpleResult> {
    clearSession();
    return { ok: true };
  }

  async requestPasswordReset(email: string): Promise<SimpleResult> {
    const normalized = normalizeEmail(email);
    const users = readUsers();
    if (!users.some((user) => user.email === normalized)) {
      // Keine Existenz-Pruefung nach aussen (Anti-Enumeration), wie bei GoTrue.
      return { ok: true };
    }
    return { ok: true };
  }

  async completePasswordReset(email: string, newPassword: string): Promise<SimpleResult> {
    if (typeof localStorage === 'undefined') {
      return { ok: false, error: notAvailable };
    }
    const normalized = normalizeEmail(email);
    const users = readUsers();
    const index = users.findIndex((entry) => entry.email === normalized);
    if (index === -1) {
      // Keine Enumeration: gleiche Antwort wie bei existierendem Konto.
      return { ok: true };
    }
    const user = users[index];
    if (!user) return { ok: true };
    const updated: StoredUser = { ...user, passwordHash: await hashPassword(newPassword) };
    const next = [...users];
    next[index] = updated;
    writeUsers(next);
    clearSession();
    return { ok: true };
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const session = readSession();
    return session ? toUser(session) : null;
  }
}
