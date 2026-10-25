import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Sandbox-Guard: zeigt `PLAYWRIGHT_BROWSERS_PATH` auf ein Verzeichnis mit einer
 * *anderen* Chromium-Revision, findet Playwright den erwarteten Browser nicht.
 * Die Env-Variable laesst sich hier nicht nachtraeglich umbiegen (Playwright
 * cached den Pfad beim ersten Zugriff), deshalb suchen wir die Binary selbst
 * und setzen sie explizit als `executablePath`. Auf CI/Dev-Rechnern mit
 * korrekt installierten Browsern findet die Suche nichts und Playwright bleibt
 * beim Standardverhalten.
 */
function resolveChromiumExecutable(): string | undefined {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), '.cache', 'ms-playwright'),
  ].filter((value): value is string => Boolean(value));
  const layouts = [
    {
      prefix: 'chromium_headless_shell-',
      relative: join('chrome-headless-shell-linux64', 'chrome-headless-shell'),
    },
    { prefix: 'chromium-', relative: join('chrome-linux64', 'chrome') },
  ];
  for (const { prefix, relative } of layouts) {
    for (const root of roots) {
      if (!existsSync(root)) continue;
      for (const entry of readdirSync(root)) {
        if (!entry.startsWith(prefix)) continue;
        const candidate = join(root, entry, relative);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

const chromiumExecutablePath = resolveChromiumExecutable();

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
    ...(chromiumExecutablePath
      ? { launchOptions: { executablePath: chromiumExecutablePath } }
      : {}),
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
