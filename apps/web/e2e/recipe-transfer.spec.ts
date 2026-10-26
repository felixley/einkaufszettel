import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const PASSWORD = 'geheim1234';

interface LocalListRow {
  id: string;
  list_id: string;
  name: string;
  name_normalized: string;
  quantity: number | null;
  unit: string | null;
  source_recipe_id: string | null;
  deleted_at: string | null;
}

function uniqueEmail(label: string): string {
  return `recipe-transfer-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

async function fillRecipeForm(page: Page, title: string, ingredients: string[]): Promise<void> {
  await page.getByLabel('Titel', { exact: true }).fill(title);
  await page.getByLabel('Portionen (Basis)').fill('4');
  await page.getByLabel('Tags (kommagetrennt)').fill('test');

  for (let index = 0; index < ingredients.length; index += 1) {
    if (index > 0) {
      await page.getByRole('button', { name: '+ Zutat hinzufügen' }).click();
    }
    await page
      .getByRole('textbox', { name: `Zutat ${index + 1}`, exact: true })
      .fill(ingredients[index] ?? '');
  }

  await page.getByLabel('Zubereitung').fill('Alles zusammen kochen.');
}

async function createRecipe(page: Page, title: string, ingredients: string[]): Promise<string> {
  await gotoHydrated(page, '/recipes/new');
  await expect(page.getByTestId('recipe-form')).toBeVisible();
  await fillRecipeForm(page, title, ingredients);
  await page.getByTestId('recipe-save').click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]+$/);
  const match = /\/recipes\/([0-9a-f-]+)$/.exec(page.url());
  if (match?.[1] === undefined) throw new Error('Rezept-ID nicht aus der URL gelesen.');
  return match[1];
}

async function readListItems(page: Page): Promise<LocalListRow[]> {
  return page.evaluate<LocalListRow[]>(async () => {
    return await new Promise<LocalListRow[]>((resolve, reject) => {
      const request = indexedDB.open('einkaufszettel');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction('list_items', 'readonly');
          const getAll = tx.objectStore('list_items').getAll();
          getAll.onsuccess = () => resolve(getAll.result as LocalListRow[]);
          getAll.onerror = () => reject(getAll.error);
        } catch (error) {
          reject(error);
        }
      };
    });
  });
}

test.describe('Auf die Einkaufsliste (T3.4)', () => {
  test('skaliert, zeigt „Bereits auf Liste“ und addiert bei zweiter Übertragung', async ({
    page,
  }) => {
    const email = uniqueEmail('double');
    await registerAndLogin(page, email);
    await createHousehold(page, 'Transfer-Haushalt');

    const recipeId = await createRecipe(page, 'Transfer Pasta', [
      '500 g Spaghetti',
      '2 Dosen Tomaten',
      '1 Prise Salz',
    ]);
    await expect(page.getByTestId('recipe-detail-title')).toHaveText('Transfer Pasta');

    // 1. Übertragung mit 6 Portionen (Basis 4) → 750 g Spaghetti.
    await page.getByTestId('recipe-add-to-list').click();
    await expect(page.getByTestId('add-to-list-dialog')).toBeVisible();
    await expect(page.getByTestId('transfer-servings')).toHaveText('4 Portionen');
    await page.getByRole('button', { name: 'Portionen erhöhen' }).click();
    await page.getByRole('button', { name: 'Portionen erhöhen' }).click();
    await expect(page.getByTestId('transfer-servings')).toHaveText('6 Portionen');
    await expect(page.getByTestId('transfer-row').filter({ hasText: 'Spaghetti' })).toContainText(
      '750 g',
    );
    await page.getByTestId('transfer-submit').click();
    await expect(page.getByTestId('transfer-success')).toContainText('3 Zutaten');
    await page.getByTestId('transfer-done').click();
    await expect(page.getByTestId('add-to-list-dialog')).toBeHidden();

    let rows = await readListItems(page);
    const spaghetti = rows.find((row) => row.name === 'Spaghetti');
    expect(spaghetti?.quantity).toBe(750);
    expect(spaghetti?.unit).toBe('g');
    expect(spaghetti?.source_recipe_id).toBe(recipeId);
    expect(spaghetti?.deleted_at).toBeNull();

    // Liste zeigt den skalierten Artikel.
    await gotoHydrated(page, '/lists');
    await expect(page.getByTestId('list-item').filter({ hasText: 'Spaghetti' })).toContainText(
      '750 g',
    );

    // 2. Übertragung mit Basis 4 → 500 g; Hinweis und Aggregation.
    await gotoHydrated(page, `/recipes/${recipeId}`);
    await page.getByTestId('recipe-add-to-list').click();
    await expect(page.getByTestId('transfer-servings')).toHaveText('4 Portionen');
    const secondRow = page.getByTestId('transfer-row').filter({ hasText: 'Spaghetti' });
    await expect(secondRow).toContainText('Bereits auf Liste');
    await expect(secondRow).toContainText('wird zu 1,25 kg');
    await page.getByTestId('transfer-submit').click();
    await expect(page.getByTestId('transfer-success')).toContainText('3 Zutaten');
    await page.getByTestId('transfer-done').click();

    rows = await readListItems(page);
    const spaghettiRows = rows.filter((row) => row.name === 'Spaghetti');
    expect(spaghettiRows).toHaveLength(1);
    expect(spaghettiRows[0]?.quantity).toBe(1250);
    expect(spaghettiRows[0]?.source_recipe_id).toBe(recipeId);

    const tomatoRows = rows.filter((row) => row.name === 'Tomaten');
    expect(tomatoRows).toHaveLength(1);
    expect(tomatoRows[0]?.quantity).toBe(5);
    expect(tomatoRows[0]?.unit).toBe('Dose');
  });

  test('inkompatible Einheit erzeugt eine eigene Zeile', async ({ page }) => {
    const email = uniqueEmail('incompatible');
    await registerAndLogin(page, email);
    await createHousehold(page, 'Einheiten-Haushalt');

    // Bestehende Zeile mit gleichem Namen, aber Masse-Einheit.
    await gotoHydrated(page, '/lists');
    await page.getByLabel('Neuer Artikel').fill('Eier');
    await page.getByLabel('Menge').fill('1');
    await page.getByLabel('Einheit').selectOption('kg');
    await page.locator('form').getByRole('button', { name: '+' }).click();
    await expect(page.getByTestId('list-item').filter({ hasText: 'Eier' })).toContainText('1 kg');

    const recipeId = await createRecipe(page, 'Eierkuchen', ['2 Stk Eier']);
    await expect(page.getByTestId('recipe-detail-title')).toHaveText('Eierkuchen');

    await page.getByTestId('recipe-add-to-list').click();
    const eggRow = page.getByTestId('transfer-row').filter({ hasText: 'Eier' });
    await expect(eggRow).toContainText('Eigene Zeile');
    await page.getByTestId('transfer-submit').click();
    await expect(page.getByTestId('transfer-success')).toContainText('1 Zutat');
    await page.getByTestId('transfer-done').click();

    const rows = await readListItems(page);
    const eggRows = rows.filter((row) => row.name === 'Eier');
    expect(eggRows).toHaveLength(2);

    const massRow = eggRows.find((row) => row.unit === 'kg');
    const pieceRow = eggRows.find((row) => row.unit === 'Stk');
    expect(massRow?.quantity).toBe(1);
    expect(pieceRow?.quantity).toBe(2);
    expect(pieceRow?.source_recipe_id).toBe(recipeId);
  });
});
