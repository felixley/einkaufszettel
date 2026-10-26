import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const PASSWORD = 'geheim1234';

function uniqueEmail(label: string): string {
  return `recipe-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function createHousehold(page: Page, name: string): Promise<void> {
  await gotoHydrated(page, '/household');
  await expect(page.getByTestId('create-household-card')).toBeVisible();
  await page.getByLabel('Haushaltsname').fill(name);
  await page.getByTestId('create-household').click();
  await expect(page.getByTestId('household-title')).toHaveText(name);
}

async function openRecipes(page: Page): Promise<void> {
  await gotoHydrated(page, '/recipes');
  await expect(page.getByRole('heading', { name: 'Rezepte' })).toBeVisible();
}

async function fillRecipeForm(
  page: Page,
  title: string,
  ingredients: string[],
  instructions = 'Alles zusammen kochen.',
): Promise<void> {
  await page.getByLabel('Titel', { exact: true }).fill(title);
  await page.getByLabel('Portionen (Basis)').fill('4');
  await page.getByLabel('Tags (kommagetrennt)').fill('vegetarisch, italienisch');

  // Erste Zutat ist bereits ein leeres Feld; weitere über den Button ergänzen.
  for (let index = 0; index < ingredients.length; index += 1) {
    if (index > 0) {
      await page.getByRole('button', { name: '+ Zutat hinzufügen' }).click();
    }
    await page
      .getByRole('textbox', { name: `Zutat ${index + 1}`, exact: true })
      .fill(ingredients[index] ?? '');
  }

  await page.getByLabel('Zubereitung').fill(instructions);
}

test.describe('Rezept-UI (T3.2)', () => {
  test('Rezept anlegen, bearbeiten, suchen, löschen und Undo', async ({ page }) => {
    const email = uniqueEmail('crud');
    await registerAndLogin(page, email);
    await createHousehold(page, 'Rezept-Haushalt');

    await openRecipes(page);
    await page.getByTestId('recipe-new').click();
    await expect(page).toHaveURL(/\/recipes\/new$/);

    await fillRecipeForm(page, 'Pasta Pomodoro', [
      '500 g Spaghetti',
      '2 Dosen Tomaten',
      '1 Prise Salz',
    ]);
    await page.getByTestId('recipe-save').click();
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]+$/);
    await expect(page.getByTestId('recipe-detail-title')).toHaveText('Pasta Pomodoro');
    await expect(page.getByTestId('recipe-ingredients')).toContainText('Spaghetti');
    await expect(page.getByTestId('recipe-ingredients')).toContainText('Tomaten');

    // Bearbeiten: Titel ändern und eine Zutat ergänzen.
    await page.getByTestId('recipe-edit').click();
    await expect(page.getByTestId('recipe-form')).toBeVisible();
    await page.getByLabel('Titel', { exact: true }).fill('Pasta Pomodoro Deluxe');
    await page.getByRole('button', { name: '+ Zutat hinzufügen' }).click();
    await page.getByRole('textbox', { name: 'Zutat 4', exact: true }).fill('1 Bund Basilikum');
    await page.getByTestId('recipe-save').click();
    await expect(page.getByTestId('recipe-detail-title')).toHaveText('Pasta Pomodoro Deluxe');
    await expect(page.getByTestId('recipe-ingredients')).toContainText('Basilikum');

    // Suchen
    await gotoHydrated(page, '/recipes');
    const search = page.getByTestId('recipe-search');
    await search.fill('deluxe');
    await expect(
      page.getByTestId('recipe-card').filter({ hasText: 'Pasta Pomodoro Deluxe' }),
    ).toBeVisible();
    await expect(page.getByTestId('recipe-empty')).toBeHidden();

    await search.fill('nichtvorhanden');
    await expect(page.getByTestId('recipe-empty')).toBeVisible();
    await search.fill('');

    // Löschen (Soft-Delete) in der Liste und Undo
    await expect(page.getByTestId('recipe-card')).toHaveCount(1);
    await page.getByTestId('recipe-delete').click();
    await expect(page.getByTestId('recipe-empty')).toBeVisible();
    await expect(page.getByText('„Pasta Pomodoro Deluxe“ gelöscht')).toBeVisible();
    await page.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(page.getByTestId('recipe-card')).toHaveCount(1);
  });

  test('Offline angelegtes Rezept synchronisiert nach Reconnect', async ({ page, context }) => {
    const email = uniqueEmail('offline');
    await registerAndLogin(page, email);
    await createHousehold(page, 'Offline-Haushalt');

    await openRecipes(page);
    // Haushalt cachen + Sync-Badge sehen.
    await expect(page.getByTestId('recipe-new')).toBeVisible();
    await expect(page.getByTestId('sync-status')).toBeVisible();

    // Formular noch online öffnen (Next-Link-Navigation braucht Netz), dann
    // offline speichern — das ist der Offline-Schreibpfad aus der Spezifikation.
    await gotoHydrated(page, '/recipes/new');
    await expect(page.getByTestId('recipe-form')).toBeVisible();
    await context.setOffline(true);

    await fillRecipeForm(page, 'Offline Kuchen', ['250 g Mehl', '3 Stk Eier']);
    await page.getByTestId('recipe-save').click();

    // Offline-Bestätigung statt Navigation
    await expect(page.getByTestId('recipe-saved-offline')).toBeVisible();
    await expect
      .poll(async () => page.getByTestId('sync-status').getAttribute('data-pending-count'))
      .not.toBe('0');

    await context.setOffline(false);
    await expect
      .poll(async () => page.getByTestId('sync-status').getAttribute('data-pending-count'), {
        timeout: 20_000,
      })
      .toBe('0');

    await gotoHydrated(page, '/recipes');
    await expect(
      page.getByTestId('recipe-card').filter({ hasText: 'Offline Kuchen' }),
    ).toBeVisible();
  });
});
