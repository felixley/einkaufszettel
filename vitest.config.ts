import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Next.js-Alias `@/*` auch für Vitest auflösen (Apps liegen unter apps/web).
    // Core wird in Tests direkt aus dem Quellcode geladen, damit `pnpm test`
    // keinen vorherigen Core-Build voraussetzt.
    alias: [
      {
        find: /^@einkaufszettel\/core\/testing\/(.*)$/,
        replacement: fromRoot('./packages/core/src/testing/$1.ts'),
      },
      { find: /^@einkaufszettel\/core$/, replacement: fromRoot('./packages/core/src/index.ts') },
      { find: '@', replacement: fromRoot('./apps/web') },
    ],
  },
  test: {
    environment: 'node',
    include: ['tooling/**/*.test.ts', 'packages/**/*.test.ts', 'apps/**/*.test.ts'],
  },
});
