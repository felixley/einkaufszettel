import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Der Passwort-Reset-Test nutzt die Mock-Route (Link direkt auf der Seite).
 * Gegen ein echtes GoTrue-Backend kommt der Link per Mail, deshalb dort skip
 * (siehe D8.6 in docs/REVIEW.md).
 */
function isMockAuth(): boolean {
  if (process.env.NEXT_PUBLIC_AUTH_MOCK === 'true') return true;
  if (process.env.NEXT_PUBLIC_AUTH_MOCK === 'false') return false;
  return !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/** Navigiert und wartet, bis React hydratisiert ist (sonst nativer Form-Submit). */
async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => document.documentElement.dataset.authReady === 'true');
}

test('geschuetzte Route ohne Session leitet auf /login', async ({ page }) => {
  await gotoHydrated(page, '/lists');
  await expect(page).toHaveURL(/\/login\?next=%2Flists/);
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
});

test('Register -> Login -> Logout', async ({ page }) => {
  const email = uniqueEmail();
  const password = 'geheim1234';

  await gotoHydrated(page, '/register');
  await expect(page.getByRole('heading', { name: 'Konto anlegen' })).toBeVisible();
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
  await page.getByLabel('Passwort (mind. 8 Zeichen)', { exact: true }).fill(password);
  await page.getByLabel('Passwort wiederholen', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Konto anlegen' }).click();

  await expect(page).toHaveURL(/\/login\?registered=1/);
  await expect(page.getByText('Konto angelegt. Bitte jetzt anmelden.')).toBeVisible();
  await expect(page.getByLabel('E-Mail-Adresse', { exact: true })).toHaveValue(email);

  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Anmelden' }).click();

  await expect(page).toHaveURL(/\/lists$/);
  // T2.6-UI rendert die Ueberschrift in Singular; die E-Mail wird dort nicht
  // mehr angezeigt (D8.1).
  await expect(page.getByRole('heading', { name: 'Einkaufsliste', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible();

  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
});

test('Passwort-Reset (Mock): neues Passwort setzen und anmelden', async ({ page }) => {
  test.skip(!isMockAuth(), 'Mock-only: echter Reset-Link kommt per GoTrue-Mail.');
  const email = uniqueEmail();
  const password = 'geheim1234';
  const newPassword = 'neuespasswort9';

  await gotoHydrated(page, '/register');
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
  await page.getByLabel('Passwort (mind. 8 Zeichen)', { exact: true }).fill(password);
  await page.getByLabel('Passwort wiederholen', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Konto anlegen' }).click();
  await expect(page).toHaveURL(/\/login\?registered=1/);

  await gotoHydrated(page, '/forgot-password');
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Reset-Link senden' }).click();
  await expect(
    page.getByText('Wenn ein Konto mit dieser Adresse existiert, ist eine E-Mail unterwegs.'),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Passwort jetzt neu setzen' }).click();
  await expect(page).toHaveURL(/\/reset-password\?email=/);
  await page.waitForFunction(() => document.documentElement.dataset.authReady === 'true');
  await page.getByLabel('Neues Passwort (mind. 8 Zeichen)', { exact: true }).fill(newPassword);
  await page.getByLabel('Neues Passwort wiederholen', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Passwort speichern' }).click();

  await expect(page).toHaveURL(/\/login\?reset=1/);
  await expect(
    page.getByText('Passwort geändert. Bitte mit dem neuen Passwort anmelden.'),
  ).toBeVisible();
  await expect(page.getByLabel('E-Mail-Adresse', { exact: true })).toHaveValue(email);

  await page.getByLabel('Passwort', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(page.getByRole('heading', { name: 'Einkaufsliste', exact: true })).toBeVisible();
});
