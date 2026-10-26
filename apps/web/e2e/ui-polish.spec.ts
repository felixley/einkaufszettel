import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gotoHydrated } from './support/navigation';

const PASSWORD = 'geheim1234';
const THEME_KEY = 'einkaufszettel-theme';

function uniqueEmail(label: string): string {
  return `ui-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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
  await page.waitForFunction(() => document.documentElement.dataset.authReady === 'true');
}

async function addItem(page: Page, name: string, quantity?: string, unit?: string): Promise<void> {
  await page.getByLabel('Neuer Artikel').fill(name);
  if (quantity !== undefined) await page.getByLabel('Menge').fill(quantity);
  if (unit !== undefined) await page.getByLabel('Einheit').selectOption(unit);
  await page.getByRole('button', { name: '+' }).click();
  await expect(page.getByTestId('list-item').filter({ hasText: name }).first()).toBeVisible();
}

async function dragRow(page: Page, name: string, dx: number): Promise<void> {
  const row = page.getByTestId('list-item').filter({ hasText: name }).first();
  const box = await row.boundingBox();
  if (box === null) throw new Error(`Zeile „${name}“ ist nicht sichtbar.`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY, { steps: 12 });
  await page.mouse.up();
}

test.describe('UI-Polish & Mobile-Ergonomie (T4.4/T4.5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  });

  test('Dark-Toggle wirkt, persistiert und System folgt emulateMedia', async ({ page }) => {
    const email = uniqueEmail('theme');
    await registerAndLogin(page, email);

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', /^(light|dark)$/);
    await expect(html).toHaveAttribute('data-theme-choice', /^(light|dark|system)$/);

    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeVisible();

    // Ausgehend von „System“ zyklisch bis Dunkel klicken (max. 3 Stufen).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if ((await html.getAttribute('data-theme')) === 'dark') break;
      await toggle.click();
    }
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY))
      .toBe('dark');

    // Persistenz nach Reload (Mock-Session liegt ebenfalls in localStorage).
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.authReady === 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Von Dunkel zu System wechseln und Media-Preference folgen lassen.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-theme-choice', 'system');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('Touch-Ziele ≥44 px, Eingabe unten erreichbar, kein H-Scroll bei 320 px', async ({
    page,
  }) => {
    const email = uniqueEmail('touch');
    await registerAndLogin(page, email);
    await addItem(page, 'Messbecher');

    const targets = [
      page.getByTestId('theme-toggle'),
      page.getByRole('button', { name: 'Abhaken' }).first(),
      page.getByTestId('delete-btn').first(),
      page.getByRole('button', { name: '+' }),
    ];

    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box, 'Touch-Ziel muss sichtbar sein').not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }

    // Eingabefeld bleibt am unteren Rand erreichbar (fixed Add-Bar).
    const formBox = await page.locator('form').last().boundingBox();
    const viewport = page.viewportSize();
    expect(formBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(formBox!.y + formBox!.height).toBeGreaterThanOrEqual(viewport!.height - 2);

    // 320 px: keine horizontale Scrollbar, Layout bleibt bedienbar.
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(page.getByTestId('theme-toggle')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('Artikel in ≤2 Taps aus der Historie hinzufügen', async ({ page }) => {
    const email = uniqueEmail('history');
    await registerAndLogin(page, email);
    await addItem(page, 'Milch', '1', 'l');

    // Bestehende Zeile entfernen, damit der neue Eintrag eindeutig prüfbar ist.
    await page
      .getByTestId('list-item')
      .filter({ hasText: 'Milch' })
      .first()
      .getByTestId('delete-btn')
      .click();
    await expect(page.getByTestId('list-item').filter({ hasText: 'Milch' })).toBeHidden();
    await expect(page.getByTestId('list-empty')).toBeVisible();

    const input = page.getByLabel('Neuer Artikel');
    await input.click();
    await input.fill('Mi');

    const option = page.getByRole('option', { name: /Milch/ });
    await expect(option).toBeVisible();
    await option.click(); // Tap 1: Vorschlag übernehmen (Menge/Einheit aus Historie)
    await expect(input).toHaveValue('Milch');
    await expect(page.getByLabel('Menge')).toHaveValue('1');
    await expect(page.getByLabel('Einheit')).toHaveValue('l');

    await page.getByRole('button', { name: '+' }).click(); // Tap 2: hinzufügen
    const added = page.getByTestId('list-item').filter({ hasText: 'Milch' }).first();
    await expect(added).toBeVisible();
    await expect(added).toContainText('1 l');
    // Enter/Submit bleibt im Feld (T4.5).
    await expect(input).toBeFocused();
  });

  test('Swipe: rechts abhaken, links löschen (Pointer Events)', async ({ page }) => {
    const email = uniqueEmail('swipe');
    await registerAndLogin(page, email);

    await addItem(page, 'Swipe-Rechts');
    await dragRow(page, 'Swipe-Rechts', 120);
    await expect(page.getByText('Erledigt (1)')).toBeVisible();
    await expect(
      page
        .getByTestId('list-item')
        .filter({ hasText: 'Swipe-Rechts' })
        .first()
        .getByRole('button', { name: 'Abhaken rückgängig' }),
    ).toBeVisible();

    await addItem(page, 'Swipe-Links');
    await dragRow(page, 'Swipe-Links', -120);
    await expect(page.getByTestId('list-item').filter({ hasText: 'Swipe-Links' })).toBeHidden();
    await expect(page.getByText('„Swipe-Links“ gelöscht')).toBeVisible();
  });

  test('prefers-reduced-motion reduziert Animationen', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const email = uniqueEmail('motion');
    await registerAndLogin(page, email);
    await addItem(page, 'Bewegungstest');

    const row = page.getByTestId('list-item').filter({ hasText: 'Bewegungstest' }).first();
    const longestTransitionSeconds = await row.evaluate((element) => {
      const raw = window.getComputedStyle(element).transitionDuration;
      return raw
        .split(',')
        .map((part) => {
          const value = part.trim();
          if (value.endsWith('ms')) return Number.parseFloat(value) / 1000;
          if (value.endsWith('s')) return Number.parseFloat(value);
          return Number.parseFloat(value);
        })
        .reduce((max, current) => Math.max(max, current), 0);
    });

    expect(longestTransitionSeconds).toBeLessThan(0.01);
  });
});
