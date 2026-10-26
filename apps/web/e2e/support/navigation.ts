import type { Page, Request } from '@playwright/test';

/**
 * Navigations-Hilfen fuer die E2E-Suite (D24).
 *
 * Warum das noetig ist: Der Next.js-App-Router haelt nach einem
 * `router.refresh()` bzw. `router.replace()` (z. B. nach „Haushalt anlegen“ in
 * `app/household/page.tsx` oder nach dem Login) noch einen RSC-Fetch fuer die
 * aktuelle Route offen. Wird in diesem Fenster ein `page.goto()` abgesetzt,
 * bricht der Fetch ab; der Router faellt dann auf eine *Browser*-Navigation zur
 * alten Route zurueck und unterbricht damit unser `goto`:
 *
 *   page.goto: Navigation to "http://localhost:3210/lists" is interrupted
 *   by another navigation to "http://localhost:3210/household"
 *   [browser] Failed to fetch RSC payload for http://localhost:3210/household.
 *   Falling back to browser navigation. TypeError: Load failed
 *
 * In Chromium gewinnt die angesteuerte Navigation das Rennen (deshalb faellt es
 * dort nicht auf); in WebKit gewinnt die Fallback-Navigation und Playwright
 * bricht mit „interrupted by another navigation“ ab (CI-Run 40393343034:
 * 9 Fehlschlaege, nur webkit/mobile-webkit).
 *
 * `waitForLoadState('networkidle')` hilft hier *nicht*: der Lifecycle-Zustand
 * ist pro Dokument „sticky“, der Aufruf kehrt sofort zurueck, auch wenn ein
 * Fetch gerade unterwegs ist (gemessen: 5 ms, waehrend `/household?_rsc=…`
 * noch offen war). Deshalb verfolgt diese Datei die wirklich offenen
 * Dokument-/fetch-/xhr-Anfragen selbst und wartet auf ein ruhiges Fenster.
 *
 * Zwei Massnahmen, beide hier zentral:
 * 1. `settlePage` wartet vor *und* nach jeder Navigation, bis keine solche
 *    Anfrage mehr laeuft — eine schwebende RSC-/Refresh-Navigation kann dann
 *    nicht mehr abgebrochen werden.
 * 2. `gotoHydrated` wiederholt ein `goto`, das trotzdem von einer anderen
 *    Navigation unterbrochen wurde (Backstop fuer Codepfade, die die Suite
 *    nicht abwartet).
 */

/**
 * Obergrenze fuer `settlePage`. Der Mock-Sync pollt `/api/mock/sync` alle 1,5 s
 * (`lib/sync/mock-realtime.ts`) und ist in Millisekunden beantwortet, das
 * ruhige Fenster kommt also praktisch sofort. Die Obergrenze greift nur, wenn
 * ein Test absichtlich eine Anfrage offen haelt (z. B. `dead-letter.spec.ts`)
 * oder offline ist — `settlePage` schluckt sie und darf nie selbst einen Test
 * rot machen.
 */
const SETTLE_TIMEOUT_MS = 2_000;

/** Wie lange der Verkehr ruhig sein muss, damit er als „fertig“ gilt. */
const QUIET_MS = 120;

/** Poll-Intervall der Ruhepruefung. */
const POLL_MS = 20;

/** Anzahl Versuche inkl. Erstversuch fuer `gotoWithRetry`. */
const GOTO_ATTEMPTS = 3;

/**
 * Nur Navigations- und Datenverkehr ist relevant: `document` (echte
 * Navigationen/Reloads), `fetch`/`xhr` (RSC-Payloads, Mock-API).
 * WebSockets (HMR) und Skript-/Style-Ressourcen bewusst nicht — sie bleiben
 * dauerhaft bzw. beliebig lange offen und wuerden nur Rauschen erzeugen.
 */
const TRACKED_RESOURCE_TYPES = new Set(['document', 'fetch', 'xhr']);

/** Dev-Server-Traffic, der nichts mit der Navigation zu tun hat. */
const IGNORED_URL = /\/_next\/(?:webpack-hmr|.*hot-update)|__nextjs_original-stack-frame/;

/** Offene Anfragen je Page (Referenzzaehler, gleiche URL kann mehrfach laufen). */
const inFlightByPage = new WeakMap<Page, Map<string, number>>();

function requestKey(request: Request): string {
  return `${request.method()} ${request.url()}`;
}

function trackerOf(page: Page): Map<string, number> {
  const existing = inFlightByPage.get(page);
  if (existing) return existing;

  const inFlight = new Map<string, number>();
  const increment = (request: Request): void => {
    if (!TRACKED_RESOURCE_TYPES.has(request.resourceType())) return;
    if (IGNORED_URL.test(request.url())) return;
    // Anfragen, die der Service Worker selbst stellt (Precache/App-Shell,
    // `e2e/pwa.spec.ts`/`offline.spec.ts`), gehoeren nicht zum
    // Navigationsverkehr der Seite: sie koennen unser `goto` nicht
    // unterbrechen, und auf sie zu warten wuerde die Seiten-Timings
    // verschieben. `request.serviceWorker()` ist genau fuer diese
    // Unterscheidung gedacht.
    if (request.serviceWorker()) return;
    const key = requestKey(request);
    inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
  };
  const decrement = (request: Request): void => {
    const key = requestKey(request);
    const count = inFlight.get(key);
    if (count === undefined) return;
    if (count <= 1) inFlight.delete(key);
    else inFlight.set(key, count - 1);
  };

  page.on('request', increment);
  page.on('requestfinished', decrement);
  page.on('requestfailed', decrement);
  inFlightByPage.set(page, inFlight);
  return inFlight;
}

/** Namen der aktuell offenen Anfragen (fuer Fehlerdiagnose). */
export function pendingRequests(page: Page): string[] {
  return [...trackerOf(page).keys()];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Wartet auf ein ruhiges Fenster im Dokument-/Datenverkehr der Seite.
 * Timeout wird bewusst geschluckt: die Funktion ist eine Entschaerfung, kein
 * eigenstaendiger Nachweis.
 */
export async function settlePage(page: Page): Promise<void> {
  const inFlight = trackerOf(page);
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let quietSince: number | null = null;

  while (Date.now() < deadline) {
    if (inFlight.size === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= QUIET_MS) return;
    } else {
      quietSince = null;
    }
    await sleep(POLL_MS);
  }
}

/** Wartet auf die Auth-Hydration (`<html data-auth-ready>`). */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.authReady === 'true');
}

async function gotoWithRetry(page: Page, path: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(path);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const interrupted = message.includes('interrupted by another navigation');
      if (!interrupted || attempt >= GOTO_ATTEMPTS) throw error;
      // Die kollidierende Navigation zu Ende laufen lassen, dann erneut ansteuern.
      await settlePage(page);
    }
  }
}

/**
 * Navigiert auf `path` und wartet, bis die Seite hydratisiert ist.
 *
 * Reihenfolge ist wesentlich: erst die Seite beruhigen (schwebende
 * Client-Navigationen und RSC-Fetches abwarten), dann navigieren, dann
 * Hydration abwarten und die Seite erneut beruhigen, damit der naechste Schritt
 * nicht in einen noch laufenden Refresh laeuft.
 */
export async function gotoHydrated(page: Page, path: string): Promise<void> {
  await settlePage(page);
  await gotoWithRetry(page, path);
  await waitForHydration(page);
  await settlePage(page);
}
