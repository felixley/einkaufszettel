#!/usr/bin/env node
/**
 * Statische Pruefung der Security-Baseline (T5.3b).
 *
 * Prueft caddy/Caddyfile und caddy/Dockerfile ohne Docker/caddy-Binary:
 * Security-Header, CSP-Direktiven, Rate-Limit-Zonen und gepinnte Plugins.
 * Exitcode 0 = alle Checks bestanden, 1 = mindestens ein Check fehlgeschlagen.
 *
 * Aufruf: node scripts/check-security-config.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Entfernt ganze Kommentarzeilen und Inline-Kommentare hinter ` #`. */
function stripCaddyComments(text) {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .map((line) => line.replace(/\s+#.*$/, ''))
    .join('\n');
}

const rawCaddyfile = readFileSync(resolve(root, 'caddy/Caddyfile'), 'utf8');
const rawDockerfile = readFileSync(resolve(root, 'caddy/Dockerfile'), 'utf8');
const caddyfile = stripCaddyComments(rawCaddyfile);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
}

/** Liefert den Wert einer Header-Direktive aus dem `header`-Block. */
function headerValue(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = caddyfile.match(new RegExp(`^[ \\t]*${escaped}[ \\t]+"([^"]*)"`, 'm'));
  return match ? match[1] : null;
}

const headerBlock = /^[ \t]*header[ \t]*\{[^}]*\}/m.test(caddyfile);
check('header-Block im Caddyfile vorhanden', headerBlock);

// --- HSTS ---
const hsts = headerValue('Strict-Transport-Security');
const hstsMaxAge = hsts?.match(/max-age=(\d+)/i)?.[1];
check(
  'HSTS mit max-age >= 31536000 und includeSubDomains',
  Boolean(hsts) && Number(hstsMaxAge) >= 31536000 && /includeSubDomains/i.test(hsts),
  hsts ?? 'fehlt',
);

// --- Basale Header ---
check('X-Content-Type-Options: nosniff', headerValue('X-Content-Type-Options') === 'nosniff');
check('X-Frame-Options: DENY', headerValue('X-Frame-Options') === 'DENY');

const referrer = headerValue('Referrer-Policy');
check(
  'Referrer-Policy restriktiv (strict-origin-when-cross-origin oder no-referrer)',
  referrer === 'strict-origin-when-cross-origin' || referrer === 'no-referrer',
  referrer ?? 'fehlt',
);

const permissions = headerValue('Permissions-Policy') ?? '';
check(
  'Permissions-Policy deaktiviert Kamera/Mikrofon/Geolocation',
  ['camera=()', 'microphone=()', 'geolocation=()'].every((entry) => permissions.includes(entry)),
  permissions || 'fehlt',
);

// --- CSP ---
const csp = headerValue('Content-Security-Policy');
const directives = new Map();
if (csp) {
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), values.join(' '));
  }
}

function directive(name) {
  return directives.get(name.toLowerCase()) ?? null;
}

function containsSelf(name) {
  return (directive(name) ?? '').split(/\s+/).includes("'self'");
}

check('CSP default-src self', containsSelf('default-src'));
check('CSP script-src self', containsSelf('script-src'));
check(
  'CSP script-src ohne unsafe-eval',
  Boolean(directive('script-src')) && !/unsafe-eval/.test(directive('script-src')),
);
check('CSP style-src self', containsSelf('style-src'));
check('CSP img-src self', containsSelf('img-src'));
check('CSP connect-src self', containsSelf('connect-src'));
check('CSP worker-src self (PWA)', containsSelf('worker-src'));
check('CSP object-src none', directive('object-src') === "'none'");
check('CSP base-uri self', directive('base-uri') === "'self'");
check('CSP form-action self', directive('form-action') === "'self'");
check('CSP frame-ancestors none', directive('frame-ancestors') === "'none'");

const scriptSrc = directive('script-src') ?? '';
const usesUnsafeInline = scriptSrc.split(/\s+/).includes("'unsafe-inline'");
if (usesUnsafeInline) {
  let securityDoc = '';
  try {
    securityDoc = readFileSync(resolve(root, 'docs/SECURITY.md'), 'utf8');
  } catch {
    securityDoc = '';
  }
  const justified = securityDoc.includes('unsafe-inline');
  check(
    "CSP 'unsafe-inline' fuer script-src in docs/SECURITY.md begruendet",
    justified,
    justified ? '' : 'docs/SECURITY.md fehlt oder erwaehnt unsafe-inline nicht',
  );
}

// --- Rate-Limit-Zonen ---
const zones = new Map();
for (const match of caddyfile.matchAll(
  /zone[ \t]+([A-Za-z0-9_-]+)[ \t]*\{((?:[^{}]|\{[^{}]*\})*)\}/g,
)) {
  const [, name, body] = match;
  zones.set(name, {
    key: body.match(/^[ \t]*key[ \t]+(\S+)/m)?.[1] ?? null,
    window: body.match(/^[ \t]*window[ \t]+(\S+)/m)?.[1] ?? null,
    events: body.match(/^[ \t]*events[ \t]+(\d+)/m)?.[1] ?? null,
  });
}

const expectedZones = [
  { name: 'auth_ip', events: '20', window: '1m' },
  { name: 'add_to_list_ip', events: '60', window: '1m' },
  { name: 'invite_ip', events: '10', window: '1m' },
];

for (const expected of expectedZones) {
  const zone = zones.get(expected.name);
  check(
    `Rate-Limit-Zone ${expected.name} (${expected.events}/${expected.window}, key {remote_host})`,
    Boolean(zone) &&
      zone.key === '{remote_host}' &&
      zone.window === expected.window &&
      zone.events === expected.events,
    zone ? JSON.stringify(zone) : 'fehlt',
  );
}

// --- Dockerfile: gepinnte Module ---
check(
  'Dockerfile pinnt caddy-ratelimit@v0.1.0',
  rawDockerfile.includes('github.com/mholt/caddy-ratelimit@v0.1.0'),
);
check('Dockerfile pinnt xcaddy build v2.11.7', /xcaddy build v2\.11\.7/.test(rawDockerfile));
check(
  'Dockerfile pinnt lego-deprecated auf Commit',
  /lego-deprecated@v0\.0\.0-\d{14}-[0-9a-f]{12}/.test(rawDockerfile),
);

// --- Grobe Syntax-/Hygiene-Checks ---
const openBraces = (caddyfile.match(/\{/g) ?? []).length;
const closeBraces = (caddyfile.match(/\}/g) ?? []).length;
check(
  'Caddyfile Klammern ausgeglichen',
  openBraces === closeBraces,
  `${openBraces} oeffnend / ${closeBraces} schliessend`,
);
check(
  'kein CORS-Wildcard im Caddyfile',
  !/Access-Control-Allow-Origin[ \t]+"?\*"?/i.test(caddyfile),
);

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  const mark = result.ok ? 'PASS' : 'FAIL';
  const suffix = result.detail ? ` (${result.detail})` : '';
  console.log(`[${mark}] ${result.name}${suffix}`);
}

console.log('');
console.log(`Security config check: ${results.length - failed.length}/${results.length} passed`);

if (failed.length > 0) {
  console.error(`${failed.length} Check(s) fehlgeschlagen.`);
  process.exitCode = 1;
}
