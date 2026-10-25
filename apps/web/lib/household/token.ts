/**
 * Einladungstoken (PLAN.md §4.5, T2.3).
 *
 * Der Browser erzeugt den Roh-Token (32 Byte Zufall = 256 Bit, deutlich ueber
 * den geforderten 128 Bit) und schickt an den Server ausschliesslich den
 * SHA-256-Hash. Der Roh-Token steht nur im Link/QR und wird nirgends gespeichert.
 */

const TOKEN_BYTES = 32;
const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]+$/;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

/** Erzeugt einen frischen Roh-Token als base64url-String (43 Zeichen). */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** SHA-256 als Kleinbuchstaben-Hex (64 Zeichen) – das ist der DB-Wert. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Baut die Einladungs-URL. Der Token ist das Bearer-Geheimnis im Pfad. */
export function buildInviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/u, '')}/invite/${token}`;
}

/** Nur fuer Tests/Diagnose: Token aus einer Einladungs-URL extrahieren. */
export function inviteTokenFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = /^\/invite\/([^/]+)\/?$/u.exec(parsed.pathname);
  const token = match?.[1];
  if (!token || !BASE64URL_ALPHABET.test(token)) return null;
  return token;
}
