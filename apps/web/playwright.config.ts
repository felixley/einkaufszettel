import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * In manchen Sandboxes zeigt PLAYWRIGHT_BROWSERS_PATH auf ein leeres,
 * schreibgeschuetztes Verzeichnis. Dann auf den Benutzer-Cache ausweichen,
 * in dem `playwright install chromium` die Browser ablegt.
 */
const configuredBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
if (configuredBrowsersPath) {
  try {
    const hasChromium = existsSync(configuredBrowsersPath)
      ? readdirSync(configuredBrowsersPath).some((name) => name.startsWith('chromium-'))
      : false;
    if (!hasChromium) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), '.cache', 'ms-playwright');
    }
  } catch {
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), '.cache', 'ms-playwright');
  }
}

const PORT = Number(process.env.E2E_PORT ?? 3210);
// `localhost` statt 127.0.0.1: Next.js blockt Dev-Ressourcen (HMR/Chunks) als
// cross-origin, wenn Host und Origin nicht uebereinstimmen — dann hydratisiert
// die Seite nie und E2E-Waits laufen in den Timeout.
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_AUTH_MOCK: 'true',
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    },
  },
});
