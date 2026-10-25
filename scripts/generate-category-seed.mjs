#!/usr/bin/env node
/**
 * Erzeugt `apps/web/lib/data/category-seed.ts` aus `supabase/seed.sql`.
 *
 * Hintergrund: `packages/core` liest die Seed-Regeln in Tests direkt aus der
 * SQL-Datei. Die Web-App läuft im Browser und kann kein `fs` nutzen — sie
 * braucht dieselben Regeln als TS-Modul, damit die Auto-Kategorisierung auch
 * offline (ohne Backend) funktioniert. Der Generator hält beide Quellen
 * synchron; `apps/web/lib/data/category-seed.test.ts` prüft die Parität.
 *
 * Aufruf: node scripts/generate-category-seed.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEED_URL = new URL('../supabase/seed.sql', import.meta.url);
const TARGET_URL = new URL('../apps/web/lib/data/category-seed.ts', import.meta.url);

const CATEGORY_PATTERN =
  /\('([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',\s*null,\s*'([a-z_]+)',\s*'([^']*)',\s*(\d+)\)/g;
const RULE_PATTERN =
  /\('([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'::uuid,\s*'([^']+)'::text,\s*'([a-z_]+)'::text\)/g;

const sql = readFileSync(SEED_URL, 'utf8');

const categories = [];
for (const match of sql.matchAll(CATEGORY_PATTERN)) {
  categories.push({
    id: match[1],
    key: match[2],
    label: match[3],
    sortOrder: Number(match[4]),
  });
}

const rules = [];
for (const match of sql.matchAll(RULE_PATTERN)) {
  rules.push({ id: match[1], keyword: match[2], categoryKey: match[3] });
}

if (categories.length !== 13) {
  throw new Error(`Erwartet 13 Kategorien, gefunden ${categories.length}`);
}
if (rules.length < 380) {
  throw new Error(`Erwartet >= 380 Regeln, gefunden ${rules.length}`);
}

const keyToId = {};
const idToKey = {};
for (const category of categories) {
  keyToId[category.key] = category.id;
  idToKey[category.id] = category.key;
}

const lines = [];
lines.push('/**');
lines.push(' * GENERIERT — nicht von Hand bearbeiten.');
lines.push(' * Quelle: `supabase/seed.sql` (Kategorien + globale Keyword-Regeln).');
lines.push(' * Neu erzeugen: `node scripts/generate-category-seed.mjs`.');
lines.push(' */');
lines.push("import type { CategoryKey } from '@einkaufszettel/core';");
lines.push('');
lines.push('export interface SeedCategory {');
lines.push('  readonly id: string;');
lines.push('  readonly key: CategoryKey;');
lines.push('  readonly label: string;');
lines.push('  readonly sortOrder: number;');
lines.push('}');
lines.push('');
lines.push('export interface SeedCategoryRule {');
lines.push('  readonly id: string;');
lines.push('  readonly keyword: string;');
lines.push('  readonly categoryKey: CategoryKey;');
lines.push('}');
lines.push('');
lines.push('export const SEED_CATEGORIES: readonly SeedCategory[] = [');
for (const category of categories) {
  lines.push(
    `  { id: '${category.id}', key: '${category.key}', label: ${JSON.stringify(
      category.label,
    )}, sortOrder: ${category.sortOrder} },`,
  );
}
lines.push('];');
lines.push('');
lines.push('export const SEED_CATEGORY_RULES: readonly SeedCategoryRule[] = [');
for (const rule of rules) {
  lines.push(
    `  { id: '${rule.id}', keyword: ${JSON.stringify(rule.keyword)}, categoryKey: '${
      rule.categoryKey
    }' },`,
  );
}
lines.push('];');
lines.push('');
lines.push('export const CATEGORY_KEY_TO_ID = {');
for (const category of categories) {
  lines.push(`  ${category.key}: '${category.id}',`);
}
lines.push('} as const satisfies Readonly<Record<CategoryKey, string>>;');
lines.push('');
lines.push('export const CATEGORY_ID_TO_KEY = {');
for (const category of categories) {
  lines.push(`  '${category.id}': '${category.key}',`);
}
lines.push('} as const satisfies Readonly<Record<string, CategoryKey>>;');
lines.push('');

const targetPath = fileURLToPath(TARGET_URL);
writeFileSync(targetPath, lines.join('\n'), 'utf8');
console.log(
  `category-seed.ts geschrieben: ${categories.length} Kategorien, ${rules.length} Regeln -> ${targetPath}`,
);
