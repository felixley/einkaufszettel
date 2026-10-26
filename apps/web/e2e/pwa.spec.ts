import { expect, test } from '@playwright/test';

/**
 * PWA-Grundlage (T4.1): Manifest ist valide erreichbar und der Service Worker
 * kontrolliert die Seite nach einem Reload. Läuft in beiden Projekten
 * (chromium + mobile-chromium).
 */
test.describe('PWA-Grundlage (T4.1)', () => {
  test('Manifest ist HTTP 200 und enthält die Pflichtfelder', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);

    const contentType = response.headers()['content-type'] ?? '';
    expect(contentType).toContain('manifest');

    const manifest = (await response.json()) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      scope?: string;
      display?: string;
      lang?: string;
      theme_color?: string;
      background_color?: string;
      icons?: Array<{ src: string; sizes?: string; purpose?: string }>;
    };

    expect(manifest.name).toBe('Einkaufszettel');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('de');
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();

    const icons = manifest.icons ?? [];
    expect(icons.some((icon) => icon.sizes === '192x192')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '512x512')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable')).toBe(
      true,
    );
  });

  test('Manifest ist im Dokument verlinkt', async ({ page }) => {
    await page.goto('/?sw=off');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
  });

  test('Service Worker kontrolliert die Seite nach Reload', async ({ page, browserName }) => {
    // T5.1: Playwright dokumentiert Service-Worker-Unterstuetzung nur fuer
    // Chromium-Browser (playwright.dev/docs/service-workers). WebKit-Projekte
    // ueberspringen diesen SW-Kontrollnachweis; der echte WebKit-Lauf ist ein
    // offener Host-/CI-Punkt (siehe docs/TESTLOG-T5.1.md).
    test.skip(
      browserName === 'webkit',
      'WebKit: Service-Worker-Kontrolle nicht garantiert (Playwright-Support nur Chromium).',
    );
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    // `?sw=on` erzwingt die Registrierung auch dann, wenn das Test-Env-Flag
    // `NEXT_PUBLIC_PWA_DISABLED=true` setzt.
    await page.goto('/?sw=on');
    await page.waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registration = await navigator.serviceWorker.getRegistration();
      return Boolean(registration?.active);
    });

    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    expect(consoleErrors).toEqual([]);
  });
});
