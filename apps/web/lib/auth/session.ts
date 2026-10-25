/**
 * Session-Cookie des Mock-Adapters. Bewusst NICHT signiert (Dev/E2E only).
 * Wird von der Middleware (Edge) und vom Browser-Adapter geteilt.
 */
export const MOCK_SESSION_COOKIE = 'ez_mock_session';
export const MOCK_SESSION_MAX_AGE_SECONDS = 60 * 60; // 1 h

export interface MockSession {
  sub: string;
  email: string;
  exp: number;
}

export function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function base64UrlDecode(value: string): string {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeMockSession(raw: string | undefined | null): MockSession | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(raw));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<MockSession>;
    if (
      typeof candidate.sub !== 'string' ||
      typeof candidate.email !== 'string' ||
      typeof candidate.exp !== 'number'
    ) {
      return null;
    }
    if (candidate.exp <= Date.now()) return null;
    return { sub: candidate.sub, email: candidate.email, exp: candidate.exp };
  } catch {
    return null;
  }
}
