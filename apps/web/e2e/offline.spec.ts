import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gotoHydrated } from './support/navigation';

/** Wartezeit fuer einen einzelnen Kontrollnachweis (`navigator.serviceWorker.controller`). */
const SW_CONTROL_TIMEOUT_MS = 8_000;

/**
 * Laedt die Seite neu, bis der Service Worker sie kontrolliert.
 *
 * `clients.claim()` laeuft im `activate`-Handler des Workers asynchron zur
 * Seite. Faellt `page.reload()` in dieses Fenster, entsteht ein Dokument, das
 * der `claim()`-Aufruf nicht mehr erreicht: es bleibt dauerhaft unkontrolliert
 * (`navigator.serviceWorker.controller === null`), obwohl die Registrierung
 * aktiv ist — der Offline-Reload waere dann kein SW-Nachweis, und der Test lief
 * bisher in den 60-s-Timeout (beobachtet in vollen Chromium-Lane-Laeufen,
 * nie in Einzellaeufen). Ein weiterer Reload landet garantiert kontrolliert,
 * weil die Registrierung dann vollstaendig aktiv ist. Statt zu raten wird der
 * Nachweis hier wiederholt und andernfalls mit klarer Meldung abgebrochen.
 */
async function reloadUnderServiceWorkerControl(page: Page): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.reload();
    const controlled = await page
      .waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, {
        timeout: SW_CONTROL_TIMEOUT_MS,
      })
      .then(
        () => true,
        () => false,
      );
    if (controlled) {
      if (attempt > 1) {
        console.log('[sw] Seite erst nach %d Reloads vom Service Worker kontrolliert', attempt);
      }
      return;
    }
  }
  throw new Error(
    'Service Worker hat die Seite nach drei Reloads nicht kontrolliert (navigator.serviceWorker.controller bleibt null).',
  );
}

/**
 * Szenario A (T4.2b) — „Supermarkt ohne Netz“.
 *
 * Beweist gegen den laufenden Dev-Mock-Sync-Server (T4.2a):
 * 1. Offline-Schreibvorgänge (Hinzufügen, Abhaken, Löschen) landen in Dexie
 *    und in der Outbox; der Status zeigt „offline“ mit Ausstehend-Zähler.
 * 2. Ein Offline-Reload rendert die App-Shell (Service Worker, T4.1) und die
 *    Daten bleiben in Dexie erhalten.
 * 3. Nach Reconnect spielt der Worker die Outbox ab; der Status geht auf 0 und
 *    ein GET auf die Mock-Sync-API liefert den korrekten Serverstand
 *    (Milch/Butter aktiv, Brot als Tombstone).
 */

const PASSWORD = 'geheim1234';

function uniqueEmail(label: string): string {
  return `offline-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function registerAndLogin(page: Page, email: string): Promise<void> {
  await gotoHydrated(page, '/register');
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
  await page.getByLabel('Passwort (mind. 8 Zeichen)', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Passwort wiederholen', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Konto anlegen' }).click();
  await expect(page).toHaveURL(/\/login\?registered=1/);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/lists$/);
}

/** Liest die Sync-Scope-ID (Mock: Nutzer-ID) aus der Session in localStorage. */
async function readScope(page: Page): Promise<string> {
  const sub = await page.evaluate(() => {
    const raw = window.localStorage.getItem('ez_mock_session_v1');
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as { sub?: unknown };
      return typeof parsed.sub === 'string' ? parsed.sub : null;
    } catch {
      return null;
    }
  });
  if (sub === null) throw new Error('Kein Mock-Session-Scope in localStorage gefunden.');
  return sub;
}

interface LocalRow {
  id: string;
  name: string;
  checked: boolean;
  deleted_at: string | null;
  quantity: number | null;
  unit: string | null;
}

/** Liest die Dexie-Tabelle `list_items` direkt über IndexedDB (ohne App-Import). */
async function readLocalRows(page: Page): Promise<LocalRow[]> {
  const rows = await page.evaluate(
    () =>
      new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = indexedDB.open('einkaufszettel');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('list_items', 'readonly');
          const all = tx.objectStore('list_items').getAll();
          all.onsuccess = () => {
            resolve(all.result as Array<Record<string, unknown>>);
            db.close();
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );
  return rows as unknown as LocalRow[];
}

async function addItem(page: Page, name: string, quantity?: number, unit?: string): Promise<void> {
  await page.getByLabel('Neuer Artikel').fill(name);
  if (quantity !== undefined) {
    await page.getByLabel('Menge', { exact: true }).fill(String(quantity));
  }
  if (unit !== undefined) {
    await page.getByLabel('Einheit', { exact: true }).selectOption(unit);
  }
  await page.getByRole('button', { name: '+' }).click();
  await expect(page.getByTestId('list-item').filter({ hasText: name })).toBeVisible();
}

async function pendingCount(page: Page): Promise<string | null> {
  return page.getByTestId('sync-status').getAttribute('data-pending-count');
}

test('Szenario A: Supermarkt ohne Netz — Offline-CRUD, Offline-Reload, Reconnect-Sync', async ({
  page,
  context,
  request,
  browserName,
}) => {
  // T5.1: WebKit bricht bei aktivem Service Worker die Navigation nach
  // `context.setOffline(true)` ab (microsoft/playwright#42775); der
  // Offline-Reload-Schritt ist dort nicht verlaesslich pruefbar. Die
  // Offline-CRUD-Pfade ohne SW-Reload deckt `multiDeviceOffline.spec.ts` und
  // `recipes.spec.ts` auch in WebKit ab. Folgekarte fuer einen WebKit-tauglichen
  // SW-Reload siehe docs/TESTLOG-T5.1.md.
  test.skip(
    browserName === 'webkit',
    'WebKit: setOffline + Service-Worker-Navigation fehlerhaft (playwright#42775).',
  );
  const email = uniqueEmail('supermarkt');
  await registerAndLogin(page, email);
  const scope = await readScope(page);

  // Service Worker aktivieren (T4.1) und Seite kontrollieren lassen, damit ein
  // Offline-Reload die gecachte App-Shell rendert.
  await gotoHydrated(page, '/lists?sw=on');
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active);
  });
  await reloadUnderServiceWorkerControl(page);
  await page.waitForFunction(() => document.documentElement.dataset.authReady === 'true');

  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'synced');

  // Online-Basisartikel, damit ein Offline-Delete einen Server-Tombstone trifft.
  // Bewusst gegen den Server pollen statt gegen den Badge: bei schnellem Erfolg
  // springt `data-pending-count` nie sichtbar auf 1 (250-ms-Debounce + Replay),
  // ein `toBe('0')` wäre also schon vor dem POST wahr (Race).
  await addItem(page, 'Brot');
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/mock/sync?scope=${encodeURIComponent(scope)}`);
        if (!response.ok()) return null;
        const body = (await response.json()) as {
          ok: boolean;
          data?: {
            rows: Array<{ deleted_at: string | null; fields: { name: string } }>;
          };
        };
        return (
          body.data?.rows.filter((row) => row.deleted_at === null).map((row) => row.fields.name) ??
          null
        );
      },
      { timeout: 20_000 },
    )
    .toContain('Brot');

  // --- Offline gehen -------------------------------------------------------
  await context.setOffline(true);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'offline');

  // Offline: hinzufügen, abhaken, löschen.
  await addItem(page, 'Milch', 2, 'l');
  await addItem(page, 'Butter', 250, 'g');
  await page
    .getByTestId('list-item')
    .filter({ hasText: 'Butter' })
    .getByRole('button', { name: 'Abhaken' })
    .click();
  await expect(page.getByText('Erledigt (1)')).toBeVisible();
  await page.getByTestId('list-item').filter({ hasText: 'Brot' }).getByTestId('delete-btn').click();
  await expect(page.getByTestId('list-item').filter({ hasText: 'Brot' })).toBeHidden();
  await expect(page.getByText('„Brot“ gelöscht')).toBeVisible();

  // Status: offline, drei Outbox-Einträge (Milch, Butter, Brot-Delete).
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'offline');
  await expect.poll(() => pendingCount(page)).toBe('3');

  // Dexie enthält den Offline-Stand sofort (Local-first).
  const offlineRows = await readLocalRows(page);
  expect(
    offlineRows
      .filter((row) => row.deleted_at === null)
      .map((row) => row.name)
      .sort(),
  ).toEqual(['Butter', 'Milch']);
  expect(offlineRows.find((row) => row.name === 'Brot')?.deleted_at).toBeTruthy();
  expect(offlineRows.find((row) => row.name === 'Butter')?.checked).toBe(true);

  // --- Offline-Reload: App-Shell + Dexie-Daten ------------------------------
  await page.reload();
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
  const rowsAfterReload = await readLocalRows(page);
  expect(
    rowsAfterReload
      .filter((row) => row.deleted_at === null)
      .map((row) => row.name)
      .sort(),
  ).toEqual(['Butter', 'Milch']);

  // --- Reconnect: Outbox wird abgespielt ------------------------------------
  await context.setOffline(false);
  await gotoHydrated(page, '/lists');
  await expect.poll(() => pendingCount(page), { timeout: 25_000 }).toBe('0');
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'synced');

  const finalResponse = await request.get(`/api/mock/sync?scope=${encodeURIComponent(scope)}`);
  expect(finalResponse.ok()).toBeTruthy();
  const finalBody = (await finalResponse.json()) as {
    ok: boolean;
    data: {
      rows: Array<{
        id: string;
        deleted_at: string | null;
        fields: { name: string; quantity: number | null; unit: string | null; checked: boolean };
      }>;
    };
  };
  expect(finalBody.ok).toBe(true);

  const active = finalBody.data.rows.filter((row) => row.deleted_at === null);
  expect(active.map((row) => row.fields.name).sort()).toEqual(['Butter', 'Milch']);
  const milch = active.find((row) => row.fields.name === 'Milch');
  expect(milch?.fields.quantity).toBe(2);
  expect(milch?.fields.unit).toBe('l');
  const butter = active.find((row) => row.fields.name === 'Butter');
  expect(butter?.fields.quantity).toBe(250);
  expect(butter?.fields.unit).toBe('g');
  expect(butter?.fields.checked).toBe(true);
  expect(finalBody.data.rows.find((row) => row.fields.name === 'Brot')?.deleted_at).toBeTruthy();

  // UI zeigt den finalen, synchronisierten Stand.
  await expect(page.getByTestId('list-item').filter({ hasText: 'Milch' })).toBeVisible();
  await expect(page.getByText('Erledigt (1)')).toBeVisible();
});
