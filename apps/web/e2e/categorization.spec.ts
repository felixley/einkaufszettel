import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const PASSWORD = 'geheim1234';

function uniqueEmail(label: string): string {
  return `cat-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function addItem(page: Page, name: string, quantity?: string, unit?: string): Promise<void> {
  await page.getByLabel('Neuer Artikel').fill(name);
  if (quantity !== undefined) await page.getByLabel('Menge').fill(quantity);
  if (unit !== undefined) await page.getByLabel('Einheit').selectOption(unit);
  await page.getByRole('button', { name: '+' }).click();
  await expect(page.getByTestId('list-item').filter({ hasText: name }).first()).toBeVisible();
}

test.describe('Kategorisierung + Duplikate (A-7/A-8)', () => {
  test('A-7: neue Artikel werden automatisch kategorisiert', async ({ page }) => {
    const email = uniqueEmail('auto');
    await registerAndLogin(page, email);

    await addItem(page, 'Bananen', '3', 'Stk');

    const group = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Obst & Gemüse' }) });
    await expect(group).toBeVisible();
    await expect(group.getByText('Bananen')).toBeVisible();
    // Gruppierung nach Kategorie ist sichtbar, keine „Sonstiges“-Zeile.
    await expect(
      page.locator('section').filter({ has: page.getByRole('heading', { name: 'Sonstiges' }) }),
    ).toBeHidden();
  });

  test('A-8: gleicher Name + gleiche Dimension addiert Menge mit Hinweis', async ({ page }) => {
    const email = uniqueEmail('dup');
    await registerAndLogin(page, email);

    await addItem(page, 'Tomaten', '1', 'kg');
    await expect(page.getByTestId('add-hint')).toBeHidden();

    await addItem(page, 'Tomaten', '500', 'g');

    // Sichtbarer Hinweis auf die Zusammenfassung.
    await expect(page.getByTestId('add-hint')).toContainText('Menge wird addiert');
    const rows = page.getByTestId('list-item').filter({ hasText: 'Tomaten' });
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('1.5 kg');
  });

  test('A-8: gleicher Name, andere Dimension ergibt eigene Zeile', async ({ page }) => {
    const email = uniqueEmail('dim');
    await registerAndLogin(page, email);

    await addItem(page, 'Tomaten', '1', 'kg');
    await addItem(page, 'Tomaten', '2', 'Stk');

    await expect(page.getByTestId('add-hint')).toContainText('anderer Dimension');
    await expect(page.getByTestId('list-item').filter({ hasText: 'Tomaten' })).toHaveCount(2);
  });

  test('A-7: manuelle Kategorie-Korrektur wird als Haushaltsregel gelernt', async ({ page }) => {
    const email = uniqueEmail('learn');
    await registerAndLogin(page, email);

    // Haushalt anlegen, damit die gelernte Regel einen Haushaltsbezug hat.
    await gotoHydrated(page, '/household');
    const createCard = page.getByTestId('create-household-card');
    if (await createCard.isVisible()) {
      await page.getByLabel('Haushaltsname').fill('E2E Kategorisierung');
      await page.getByTestId('create-household').click();
      await expect(page.getByTestId('create-household-card')).toBeHidden();
    }

    await gotoHydrated(page, '/lists');
    await addItem(page, 'Zauberpulver');

    // Manuelle Korrektur in der Detailansicht (Link, nicht die Zeile klicken).
    await page.getByRole('link', { name: 'Zauberpulver' }).first().click();
    await expect(page).toHaveURL(/\/list\//);
    await page.getByLabel('Kategorie').selectOption('gewuerze_oele');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page).toHaveURL(/\/lists$/);

    const spiceGroup = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Gewürze & Öle' }) });
    await expect(spiceGroup.getByText('Zauberpulver')).toBeVisible();

    // Nächster Artikel gleichen Namens erbt die gelernte Regel. Eine Einheit
    // erzwingt eine eigene Zeile (andere Dimension als der erste, einheitenlose
    // Artikel), sonst würde A-8 die Menge zusammenfassen.
    await addItem(page, 'Zauberpulver', '2', 'Stk');
    await expect(spiceGroup.getByText('Zauberpulver')).toHaveCount(2);
  });
});
