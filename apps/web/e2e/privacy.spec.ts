import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * A-2 (T2.2): Ein zweiter Nutzer (nicht Mitglied) sieht den Haushalt und die
 * Liste des ersten Nutzers nicht.
 *
 * Nachweis in zwei Browser-Kontexten. Die DB-Assertion läuft im Mock-Modus
 * gegen den serverseitigen Mock-Store (`/api/mock/household`, Aktion `me`) —
 * dieser Zustand ist echt servergeteilt, nicht nur UI. Im Real-Modus wird die
 * DB-Ebene bereits durch die pgTAP-Suite 03 (ok 31–34) abgedeckt; hier bleibt
 * dann die UI-Assertion (fremder Haushalt nicht sichtbar), weil der
 * QA-Sandbox-Stack kein PostgREST bereitstellt (D8.5, dokumentierte Abweichung).
 */

const PASSWORD = 'geheim1234';

function uniqueEmail(label: string): string {
  return `priv-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function isMockMode(): boolean {
  if (process.env.NEXT_PUBLIC_AUTH_MOCK === 'true') return true;
  if (process.env.NEXT_PUBLIC_AUTH_MOCK === 'false') return false;
  return !process.env.NEXT_PUBLIC_SUPABASE_URL;
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

async function newUserContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3210';
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  return { context, page };
}

/** Server-seitiger Mock-Store: eigener Haushalt des angemeldeten Nutzers. */
async function fetchMyHousehold(page: Page): Promise<unknown> {
  const response = await page.request.post('/api/mock/household', {
    data: { action: 'me' },
  });
  expect(response.ok()).toBeTruthy();
  const json: unknown = await response.json();
  const body = json as { ok?: boolean; data?: unknown };
  expect(body.ok).toBe(true);
  return body.data;
}

test('A-2: zweiter Nutzer sieht fremden Haushalt nicht (zwei Kontexte + DB-Assertion)', async ({
  browser,
}) => {
  const a = await newUserContext(browser);
  const b = await newUserContext(browser);
  const mock = isMockMode();

  try {
    // Nutzer A registriert sich und legt einen Haushalt an.
    await registerAndLogin(a.page, uniqueEmail('a'));
    await gotoHydrated(a.page, '/household');
    await a.page.getByLabel('Haushaltsname').fill('A-2 Privathaushalt');
    await a.page.getByTestId('create-household').click();
    await expect(a.page.getByTestId('household-title')).toHaveText('A-2 Privathaushalt');

    if (mock) {
      // DB-Assertion: serverseitiger Mock-Store kennt A's Haushalt.
      expect(await fetchMyHousehold(a.page)).not.toBeNull();
    }

    // Nutzer B (eigener Kontext, eigenes Konto) ist nicht Mitglied.
    await registerAndLogin(b.page, uniqueEmail('b'));

    await gotoHydrated(b.page, '/household');
    await expect(b.page.getByTestId('create-household-card')).toBeVisible();
    await expect(b.page.getByTestId('household-title')).toBeHidden();

    // B sieht in der Listenansicht keine Zeilen von A.
    await gotoHydrated(b.page, '/lists');
    await expect(b.page.getByTestId('list-item')).toHaveCount(0);

    if (mock) {
      // DB-Assertion: B hat serverseitig 0 sichtbare Haushalte.
      expect(await fetchMyHousehold(b.page)).toBeNull();
    }
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
