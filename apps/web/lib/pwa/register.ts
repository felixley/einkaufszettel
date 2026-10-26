/**
 * Fehlertolerante Service-Worker-Registrierung (T4.1).
 *
 * - Läuft ausschließlich im Browser (kein SSR-Crash).
 * - Registriert nur in einem sicheren Kontext (HTTPS oder localhost).
 * - Schaltet sich in Tests per Env-Flag oder `?sw=off` ab; `?sw=on` erzwingt
 *   die Registrierung auch dann, wenn das Env-Flag gesetzt ist.
 */

const SW_PATH = '/sw.js';
const SW_SCOPE = '/';

export function isServiceWorkerEnabled(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('sw') === 'off') return false;
    if (params.get('sw') === 'on') return true;
  } catch {
    // ignorieren – dann gilt das Env-Flag
  }

  return process.env.NEXT_PUBLIC_PWA_DISABLED !== 'true';
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null;
  if (!isServiceWorkerEnabled()) return null;
  if (!('serviceWorker' in navigator)) return null;
  if (!window.isSecureContext) return null;

  try {
    return await navigator.serviceWorker.register(SW_PATH, {
      scope: SW_SCOPE,
      updateViaCache: 'none',
    });
  } catch (error) {
    // PWA ist Progressive Enhancement: ohne SW bleibt die App nutzbar.
    console.warn('[pwa] Service Worker konnte nicht registriert werden.', error);
    return null;
  }
}
