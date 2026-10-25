import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const PASSWORD = 'geheim1234';

function uniqueEmail(label: string): string {
  return `list-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

function isMockMode(): boolean {
  if (process.env.NEXT_PUBLIC_AUTH_MOCK === 'true') return true;
  if (process.env.NEXT_PUBLIC_AUTH_MOCK === 'false') return false;
  return !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

async function login(page: Page, email: string): Promise<void> {
  await gotoHydrated(page, '/login');
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/lists$/);
}

test.describe('Listen-UI (T2.6)', () => {
  test('Artikel hinzufuegen, abhaken, loeschen und Undo', async ({ page }) => {
    const email = uniqueEmail('ui');
    await registerAndLogin(page, email);

    // 1. Add item
    const addInput = page.getByLabel('Neuer Artikel');
    await addInput.fill('Testartikel');
    await page.getByRole('button', { name: '+' }).click();
    await expect(page.getByText('Testartikel')).toBeVisible();

    // 2. Check off item (moves to Erledigt)
    const item = page.getByTestId('list-item').filter({ hasText: 'Testartikel' });
    await item.getByRole('button', { name: 'Abhaken' }).click();
    await expect(page.getByText('Erledigt (1)')).toBeVisible();

    // 3. Uncheck item
    const checkedItem = page.getByTestId('list-item').filter({ hasText: 'Testartikel' });
    await checkedItem.getByRole('button', { name: 'Abhaken rückgängig' }).click();
    await expect(page.getByText('Erledigt (1)')).toBeHidden();

    // 4. Delete item and verify Undo toast
    const activeItem = page.getByTestId('list-item').filter({ hasText: 'Testartikel' });
    await activeItem.getByTestId('delete-btn').click();
    await expect(page.getByText('„Testartikel“ gelöscht')).toBeVisible();
    await expect(page.getByTestId('list-item').filter({ hasText: 'Testartikel' })).toBeHidden();

    // 5. Undo delete
    await page.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(page.getByText('Testartikel')).toBeVisible();
  });

  /**
   * A-6: Aenderung von A erscheint bei B in <2 s ohne Reload — mit gemessener
   * Latenz. Laeuft in CI (Mock-Modus) und gegen ein echtes Backend.
   *
   * Mock-Modus (CI): Es gibt keinen Server; zwei Tabs im SELBEN Browser-Kontext
   * teilen IndexedDB, und Dexie liveQuery propagiert Aenderungen ueber
   * BroadcastChannel. Dokumentierte Abweichung zu „zwei Browser-Kontexte“:
   * im Mock-Lauf sind es zwei Tabs eines Kontexts. Gegen ein echtes Backend
   * laeuft derselbe Test mit zwei Browser-Kontexten (Supabase-Realtime).
   */
  test('Zwei Kontexte: Aenderung in <2s beim anderen (gemessene Latenz)', async ({ browser }) => {
    const mock = isMockMode();
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `sync-${runId}@example.com`;
    const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3210';

    let pageA: Page;
    let pageB: Page;
    const contexts: BrowserContext[] = [];

    if (mock) {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      pageA = await context.newPage();
      await registerAndLogin(pageA, email);
      // Zweiter Tab im selben Kontext: Session (localStorage/Cookie) ist geteilt.
      pageB = await context.newPage();
      await gotoHydrated(pageB, '/lists');
      await expect(
        pageB.getByRole('heading', { name: 'Einkaufsliste', exact: true }),
      ).toBeVisible();
    } else {
      // Echtes Backend: zwei Kontexte. Der zweite Kontext loggt sich mit
      // denselben Zugangsdaten ein, statt erneut zu registrieren — GoTrue lehnt
      // eine Doppel-Registrierung ab (D8.3).
      const contextA = await browser.newContext({ baseURL });
      contexts.push(contextA);
      pageA = await contextA.newPage();
      await registerAndLogin(pageA, email);

      const contextB = await browser.newContext({ baseURL });
      contexts.push(contextB);
      pageB = await contextB.newPage();
      await login(pageB, email);
    }

    try {
      // Latenz ab dem Klick in A bis zur Sichtbarkeit in B messen.
      const started = Date.now();
      await pageA.getByLabel('Neuer Artikel').fill('Sync-Testartikel');
      await pageA.getByRole('button', { name: '+' }).click();
      await expect(pageA.getByText('Sync-Testartikel')).toBeVisible();

      await expect(pageB.getByText('Sync-Testartikel')).toBeVisible({ timeout: 2000 });
      const elapsed = Date.now() - started;
      // Sichtbar im CI-Log als Nachweis der gemessenen Latenz (A-6).
      console.log(`A-6 Latenz (${mock ? 'mock/two-tabs' : 'real/two-contexts'}): ${elapsed} ms`);
      expect(elapsed).toBeLessThan(2000);
      test.info().annotations.push({ type: 'latency_ms', description: String(elapsed) });
    } finally {
      for (const context of contexts) await context.close();
    }
  });
});
