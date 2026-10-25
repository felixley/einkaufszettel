import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

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

async function newUserContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3210';
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  return { context, page };
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

  test('Zwei Browser-Kontexte: Aenderung in <2s beim anderen (nur mit echtem Backend)', async ({
    browser,
  }) => {
    // Der Mock-Modus verwendet einen LocalOnlySyncAdapter (No-op).
    // Ein echter Cross-Kontext-Sync ist nur mit Supabase-Backend moeglich.
    test.skip(
      !process.env.NEXT_PUBLIC_SUPABASE_URL,
      'Kein echtes Backend konfiguriert (Mock-Modus) – Cross-Kontext-Sync nicht testbar.',
    );

    const user1 = await newUserContext(browser);
    const user2 = await newUserContext(browser);
    const email = uniqueEmail('sync');

    try {
      await registerAndLogin(user1.page, email);
      await registerAndLogin(user2.page, email);

      // Add item in context 1
      await user1.page.getByLabel('Neuer Artikel').fill('Sync-Testartikel');
      await user1.page.getByRole('button', { name: '+' }).click();
      await expect(user1.page.getByText('Sync-Testartikel')).toBeVisible();

      // Should appear in context 2 within 2s
      await expect(user2.page.getByText('Sync-Testartikel')).toBeVisible({ timeout: 2000 });
    } finally {
      await user1.context.close();
      await user2.context.close();
    }
  });
});
