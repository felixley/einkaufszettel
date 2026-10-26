import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gotoHydrated } from './support/navigation';

const PASSWORD = 'geheim1234';

/**
 * Barrierefreiheit (T4.6): axe-core als zusaetzliche E2E-Suite.
 *
 * Geprüft werden die zentralen, oeffentlich erreichbaren Seiten in Hell und
 * Dunkel sowie der Dead-Letter-Dialog. Massstab sind die WCAG-A/AA-Regeln
 * (2.0/2.1/2.2) — nicht "best practice", damit der Lauf stabil und
 * nachvollziehbar bleibt. Jeder Verstoss wird mit Regel, Impact, Hilfe-Link
 * und betroffenen Knoten geloggt, damit ein Rot sofort reproduzierbar ist.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function uniqueEmail(label: string): string {
  return `a11y-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
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

/**
 * Setzt die Theme-Wahl auf „system“ und die Media-Preference auf hell/dunkel.
 * Das Inline-Script im Root-Layout uebersetzt das vor dem ersten Paint in
 * `data-theme`; so pruefen wir beide Farbwelten ohne Klick-Kette.
 */
async function useColorScheme(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  // Init-Script statt page.evaluate: laeuft auch auf about:blank und vor jedem
  // Paint, damit ThemeScript die Wahl „system“ schon beim ersten Rendern sieht.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('einkaufszettel-theme', 'system');
    } catch {
      /* about:blank / opaque origin: kein Storage, ThemeScript faengt das ab. */
    }
  });
}

function describeViolations(
  violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations'],
): string {
  if (violations.length === 0) return 'keine axe-Verstoesse';
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 3)
        .map((node) => `      ${node.target.join(' ')} — ${node.failureSummary ?? ''}`)
        .join('\n');
      return [
        `  • [${violation.impact ?? 'n/a'}] ${violation.id}: ${violation.help}`,
        `    ${violation.helpUrl}`,
        nodes,
        violation.nodes.length > 3 ? `    … und ${violation.nodes.length - 3} weitere Knoten` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

async function expectNoA11yViolations(page: Page, contextLabel: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  // Sichtbar im CI-Log als Beleg, welche Seiten/Regeln tatsaechlich liefen.
  console.log(
    `[a11y] ${contextLabel}: ${results.violations.length} Verstoesse, ` +
      `${results.passes.length} Regeln bestanden, ${results.incomplete.length} unklar`,
  );
  expect(
    results.violations,
    `${contextLabel} — axe-Verstoesse:\n${describeViolations(results.violations)}`,
  ).toHaveLength(0);
}

test.describe('Barrierefreiheit (T4.6, axe-core)', () => {
  test('Login (hell): keine WCAG-A/AA-Verstoesse', async ({ page }) => {
    await useColorScheme(page, 'light');
    await gotoHydrated(page, '/login');
    await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
    await expectNoA11yViolations(page, 'Login / hell');
  });

  test('Registrierung (dunkel): keine WCAG-A/AA-Verstoesse', async ({ page }) => {
    await useColorScheme(page, 'dark');
    await gotoHydrated(page, '/register');
    await expect(page.getByRole('heading', { name: /Konto anlegen/i })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectNoA11yViolations(page, 'Registrierung / dunkel');
  });

  test('Liste mit Artikel (hell + dunkel): keine WCAG-A/AA-Verstoesse', async ({ page }) => {
    await useColorScheme(page, 'light');
    await registerAndLogin(page, uniqueEmail('list'));

    await page.getByLabel('Neuer Artikel').fill('A11y-Testartikel');
    await page.getByRole('button', { name: '+' }).click();
    await expect(
      page.getByTestId('list-item').filter({ hasText: 'A11y-Testartikel' }),
    ).toBeVisible();
    // Sync-Badge abwarten, damit Live-Region-Updates nicht mitten in den Lauf fallen.
    await expect(page.getByTestId('sync-status')).toContainText(
      /Synchronisiert|Ausstehend|Offline/,
    );

    await expectNoA11yViolations(page, 'Liste / hell');

    await useColorScheme(page, 'dark');
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.authReady === 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectNoA11yViolations(page, 'Liste / dunkel');
  });

  test('Rezepte (hell): keine WCAG-A/AA-Verstoesse', async ({ page }) => {
    await useColorScheme(page, 'light');
    await registerAndLogin(page, uniqueEmail('recipes'));
    await page.getByRole('link', { name: 'Rezepte' }).click();
    await expect(page.getByRole('heading', { name: 'Rezepte', exact: true })).toBeVisible();
    await expectNoA11yViolations(page, 'Rezepte / hell');
  });

  test('Haushalt (hell): keine WCAG-A/AA-Verstoesse', async ({ page }) => {
    await useColorScheme(page, 'light');
    await registerAndLogin(page, uniqueEmail('household'));
    await gotoHydrated(page, '/household');
    await expect(page.getByRole('heading', { name: 'Haushalt', exact: true })).toBeVisible();
    await expectNoA11yViolations(page, 'Haushalt / hell');
  });

  test('Kein horizontales Scrollen bei 320 px in Hell und Dunkel', async ({ page }) => {
    await useColorScheme(page, 'light');
    await registerAndLogin(page, uniqueEmail('reflow'));
    await page.setViewportSize({ width: 320, height: 640 });

    for (const scheme of ['light', 'dark'] as const) {
      await useColorScheme(page, scheme);
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.authReady === 'true');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `horizontaler Overflow im Theme ${scheme}`).toBeLessThanOrEqual(1);
    }
  });
});
