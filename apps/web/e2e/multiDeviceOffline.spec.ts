import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

/**
 * Szenario B (T4.2b) — „zwei Geräte offline, dann online“.
 *
 * Zwei getrennte Browser-Kontexte teilen Nutzer/Sync-Scope (per storageState),
 * haben aber getrennte IndexedDB-Instanzen („zwei Geräte“). Beide gehen offline,
 * legen je einen Artikel an, gehen nacheinander wieder online. Danach muss jedes
 * Gerät beide Änderungen sehen — ohne Duplikate, ohne Verlust. Der Dev-Mock-
 * Server (T4.2a) ist die gemeinsame Gegenstelle; die Realtime-Quelle pollt.
 */

const PASSWORD = 'geheim1234';

function uniqueEmail(label: string): string {
  return `multi-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => document.documentElement.dataset.authReady === 'true');
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

test('Szenario B: zwei Geräte offline, dann online — beide sehen beide Änderungen', async ({
  browser,
  request,
}) => {
  const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3210';
  const email = uniqueEmail('zwei-geraete');

  const contextA: BrowserContext = await browser.newContext({ baseURL });
  const pageA = await contextA.newPage();
  let contextB: BrowserContext | undefined;

  try {
    await registerAndLogin(pageA, email);
    const scope = await readScope(pageA);
    await expect(pageA.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'synced');

    // „Zweites Gerät“: gleiche Session (gleicher Nutzer ⇒ gleicher Sync-Scope),
    // aber frische IndexedDB. storageState kopiert Cookies + localStorage,
    // nicht IndexedDB — genau das Verhalten zweier getrennter Geräte.
    const storageState = await contextA.storageState();
    contextB = await browser.newContext({ baseURL, storageState });
    const pageB = await contextB.newPage();
    await gotoHydrated(pageB, '/lists');
    await expect(pageB.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'synced');

    // Gerät A legt online „Brot“ an; Gerät B sieht es über die Polling-Realtime.
    await addItem(pageA, 'Brot');
    await expect.poll(() => pendingCount(pageA), { timeout: 20_000 }).toBe('0');
    await expect(pageB.getByTestId('list-item').filter({ hasText: 'Brot' })).toBeVisible({
      timeout: 15_000,
    });

    // --- Beide Geräte offline ------------------------------------------------
    await contextA.setOffline(true);
    await contextB.setOffline(true);
    await expect(pageA.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'offline');
    await expect(pageB.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'offline');

    // Jedes Gerät ändert offline lokal.
    await addItem(pageA, 'Milch-A', 1, 'l');
    await addItem(pageB, 'Butter-B', 250, 'g');
    await expect.poll(() => pendingCount(pageA)).toBe('1');
    await expect.poll(() => pendingCount(pageB)).toBe('1');

    // --- Nacheinander wieder online ------------------------------------------
    await contextA.setOffline(false);
    await expect.poll(() => pendingCount(pageA), { timeout: 25_000 }).toBe('0');
    await expect(pageA.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'synced');

    await contextB.setOffline(false);
    await expect.poll(() => pendingCount(pageB), { timeout: 25_000 }).toBe('0');
    await expect(pageB.getByTestId('sync-status')).toHaveAttribute('data-sync-state', 'synced');

    // --- Konvergenz: beide Geräte sehen alle drei Artikel, keine Duplikate ----
    for (const [label, page] of [
      ['Gerät A', pageA],
      ['Gerät B', pageB],
    ] as const) {
      for (const name of ['Brot', 'Milch-A', 'Butter-B']) {
        await expect(
          page.getByTestId('list-item').filter({ hasText: name }),
          `${label} sieht ${name}`,
        ).toBeVisible({ timeout: 20_000 });
      }
      await expect(page.getByTestId('list-item'), `${label} ohne Duplikate`).toHaveCount(3);
    }

    // Serverstand: genau drei aktive Zeilen, keine Duplikate.
    const response = await request.get(`/api/mock/sync?scope=${encodeURIComponent(scope)}`);
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        rows: Array<{
          id: string;
          deleted_at: string | null;
          fields: { name: string; quantity: number | null; unit: string | null };
        }>;
      };
    };
    expect(body.ok).toBe(true);
    const active = body.data.rows.filter((row) => row.deleted_at === null);
    expect(active.map((row) => row.fields.name).sort()).toEqual(['Brot', 'Butter-B', 'Milch-A']);
    expect(active).toHaveLength(3);
  } finally {
    await contextB?.close();
    await contextA.close();
  }
});
