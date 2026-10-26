/**
 * Reine Auswahl-Logik für die Service-Worker-Cache-Strategie (T4.1).
 *
 * Bewusst framework- und browserfrei, damit sie in Vitest (Node) getestet
 * werden kann. Der Service Worker (`public/sw.js`) enthält dieselbe Logik in
 * JavaScript; die Unit-Tests sichern die Entscheidungen hier ab.
 */

export type CacheStrategy = 'network-only' | 'network-first' | 'stale-while-revalidate';

/** Pfade, die niemals in einen Cache geschrieben werden dürfen. */
export const NEVER_CACHE_PREFIXES = ['/rest/v1/', '/auth/v1/', '/api/'] as const;

export interface RequestLike {
  method?: string;
  mode?: string;
  url: string;
}

function pathnameOf(url: string): string {
  try {
    return new URL(url, 'https://einkaufszettel.local').pathname;
  } catch {
    return url;
  }
}

export function isNeverCachedPath(pathname: string): boolean {
  return NEVER_CACHE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function chooseCacheStrategy(request: RequestLike): CacheStrategy {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method !== 'GET') return 'network-only';

  const pathname = pathnameOf(request.url);
  if (isNeverCachedPath(pathname)) return 'network-only';

  // Navigationen: zuerst Netz, bei Ausfall die gecachte App-Shell.
  if (request.mode === 'navigate') return 'network-first';

  // Statische Next-Assets und Icons: sofort aus dem Cache, parallel aktualisieren.
  if (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/manifest.webmanifest'
  ) {
    return 'stale-while-revalidate';
  }

  // Alles andere (z. B. fremde Origins) nicht ungefragt cachen.
  return 'network-only';
}
