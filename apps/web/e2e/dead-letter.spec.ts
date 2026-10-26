import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const PASSWORD = 'geheim1234';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

/**
 * Injiziert Serverfehler in den Dev-Mock-Sync (T4.2a) und zählt die
 * fehlgeschlagenen POST-Versuche. GET (Polling-Realtime) bleibt intakt.
 */
async function failMockSync(page: Page): Promise<() => number> {
  let failures = 0;
  await page.route('**/api/mock/sync**', async (route) => {
    if (route.request().method() === 'POST') {
      failures += 1;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: { code: 'server_error', message: 'Injected failure' },
        }),
      });
      return;
    }
    await route.continue();
  });
  return () => failures;
}

/** Erzeugt durch wiederholte manuelle Trigger einen Dead-Letter-Eintrag. */
async function reachDeadLetter(page: Page): Promise<void> {
  const badge = page.getByTestId('sync-status');
  await expect(badge).toBeVisible();

  await page.getByLabel('Neuer Artikel').fill('DeadLetter-Test');
  await page.getByRole('button', { name: '+' }).click();
  await expect(page.getByText('DeadLetter-Test')).toBeVisible();

  // Der automatische Outbox-Trigger versucht sofort; danach manuell wiederholen.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const label = (await badge.textContent()) ?? '';
    if (label.includes('nicht synchronisiert')) return;
    await badge.click();
    await page.waitForTimeout(600);
  }
  await expect(badge).toContainText('nicht synchronisiert');
}

test.describe('Dead-Letter-Anzeige (T4.3)', () => {
  test('Badge öffnet Panel, „Erneut versuchen“ synchronisiert', async ({ page }) => {
    await registerAndLogin(page, uniqueEmail('dl-retry'));
    const failures = await failMockSync(page);
    await reachDeadLetter(page);
    expect(failures()).toBeGreaterThanOrEqual(5);

    const badge = page.getByTestId('sync-status');
    await badge.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Fehlgeschlagene Sync-Einträge');
    await expect(dialog.getByTestId('dead-letter-item')).toHaveCount(1);
    await expect(dialog).toContainText('Injected failure');

    // Fehlerinjektion beenden: Retry soll jetzt durchlaufen.
    await page.unroute('**/api/mock/sync**');
    await dialog.getByRole('button', { name: /erneut versuchen/i }).click();

    await expect(dialog).toContainText('Keine fehlgeschlagenen Einträge', { timeout: 15_000 });
    await expect(badge).toContainText('Synchronisiert', { timeout: 15_000 });
    await expect(dialog.getByTestId('dead-letter-item')).toHaveCount(0);
  });

  test('„Verwerfen“ entfernt den Eintrag dauerhaft', async ({ page }) => {
    await registerAndLogin(page, uniqueEmail('dl-discard'));
    await failMockSync(page);
    await reachDeadLetter(page);

    const badge = page.getByTestId('sync-status');
    await badge.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('dead-letter-item')).toHaveCount(1);

    await dialog.getByRole('button', { name: /verwerfen/i }).click();

    await expect(dialog).toContainText('Keine fehlgeschlagenen Einträge', { timeout: 15_000 });
    await expect(dialog.getByTestId('dead-letter-item')).toHaveCount(0);
    await expect(badge).toContainText('Synchronisiert', { timeout: 15_000 });
  });
});
