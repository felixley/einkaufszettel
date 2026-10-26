# Testlog T4.1 — PWA-Grundlage (Manifest, Icons, Service Worker, Install-Prompt)

Datum: 2026-10-26
Umgebung: Repo `/opt/data/workspace/einkaufszettel`, Node 26.7.0, pnpm 9.15.4,
Next.js 16.4.3 (Turbopack), Vitest 3.2.7, Playwright 1.64.1, Lighthouse 11.7.1.

## Zweck

Nachweis der PWA-Grundlage nach PLAN.md §5 T4.1: valides Manifest, Icons,
Service Worker (App-Shell-Cache + Stale-While-Revalidate), Registrierung,
dezenter Install-Prompt, Offline-Fallback. Kein Push.

## Umgesetzte Dateien

- `apps/web/app/manifest.ts` — Manifest als Metadata-Route (`/manifest.webmanifest`);
  Begründung: Next.js rendert und verlinkt die Datei automatisch, eine Quelle für
  Name/Icons/Theme. Alternative `public/manifest.webmanifest` wäre doppelt zu pflegen.
- `apps/web/public/sw.js` — Service Worker mit versioniertem Cache (`v1`),
  App-Shell-Precache, Network-First für Navigationen, SWR für `/_next/static/*`
  und `/icons/*`, Network-Only für `/rest/v1/*`, `/auth/v1/*`, `/api/*`.
- `apps/web/public/offline.html` — deutsche Offline-Seite mit „Erneut versuchen“.
- `apps/web/public/icons/*.png` — 192/512 + maskable 192/512 + Apple-Touch 180,
  lokal erzeugt (keine externen Assets).
- `apps/web/lib/pwa/cache-strategy.ts` (+ Test) — reine Auswahl-Logik für
  Network-Only / Network-First / Stale-While-Revalidate.
- `apps/web/lib/pwa/register.ts` — fehlertolerante Registrierung (nur Browser,
  nur sicherer Kontext, `?sw=off`/`?sw=on` und `NEXT_PUBLIC_PWA_DISABLED`).
- `apps/web/components/pwa/InstallPrompt.tsx` — `beforeinstallprompt`-Button
  „App installieren“, versteckt nach `appinstalled`/im Standalone-Modus.
- `apps/web/components/pwa/OfflineFallback.tsx` + `app/offline/page.tsx` —
  Offline-Hinweis mit Retry.
- `apps/web/app/layout.tsx` — Manifest-Link/Theme + SW-Registrierung minimal ergänzt.
- `apps/web/e2e/pwa.spec.ts` — Manifest 200/JSON, Link im Dokument, SW-Controller
  nach Reload, keine Konsolenfehler; läuft in beiden Projekten.
- `apps/web/playwright.config.ts` — bestehende Suite fährt mit
  `NEXT_PUBLIC_PWA_DISABLED=true`; `pwa.spec.ts` erzwingt Registrierung per `?sw=on`.

## Build

```bash
cd /opt/data/workspace/einkaufszettel
pnpm --filter @einkaufszettel/web build
```

Ergebnis: exit 0. Routen u. a. `○ /`, `○ /manifest.webmanifest`, `○ /offline`;
TypeScript-Phase erfolgreich. (Ausgabe gekürzt, Original im Terminal-Log.)

## Unit-Tests Cache-Strategie

```bash
pnpm vitest run apps/web/lib/pwa/cache-strategy.test.ts --reporter=verbose
```

Ergebnis: **6 Tests in 1 Datei grün** (API/Auth/PostgREST network-only,
Navigation network-first, `_next/static`/Icons/Manifest SWR, sonstige GETs
network-only, Präfix-Erkennung).

## Playwright (PWA-Spec, beide Projekte)

```bash
pnpm --filter @einkaufszettel/web test:e2e e2e/pwa.spec.ts
```

Ergebnis: **6 Tests grün** (chromium + mobile-chromium):

- Manifest HTTP 200, Content-Type `application/manifest+json`, Pflichtfelder
  `name`, `short_name`, `start_url=/`, `scope=/`, `display=standalone`, `lang=de`,
  Theme/Background, Icons 192/512 + maskable 512.
- `<link rel="manifest" href="/manifest.webmanifest">` im Dokument.
- `navigator.serviceWorker.controller` nach Reload vorhanden; keine Konsolenfehler.

## Lighthouse (Produktions-Build)

Lighthouse 13.5.0 hat keine PWA-Kategorie/Audits mehr; daher wurde
`lighthouse@11.7.1` mit PWA-Kategorie gegen den laufenden Build verwendet.

```bash
pnpm --filter @einkaufszettel/web start --port 3212   # next start, Antwort 200
CHROME_PATH=/opt/hermes/tools/chromium-1208/chrome-linux64/chrome \
  pnpm dlx lighthouse@11.7.1 http://localhost:3212/ \
  --only-categories=pwa --chrome-flags='--headless --no-sandbox --disable-gpu' \
  --output=json --output-path=/opt/data/profiles/frontend/cache/scratch/lh-pwa-final.json --quiet
```

Ergebnis: **PWA-Kategorie-Score 1**; keine fehlgeschlagenen PWA-Audits.
Auszug aus `lh-pwa-final.json`:

```text
lighthouseVersion: 11.7.1
finalUrl: http://localhost:3212/
pwa category score: 1
audits:
  installable-manifest: weight=2 score=1 title='Web app manifest and service worker meet the installability requirements'
  splash-screen: weight=1 score=1 title='Configured for a custom splash screen'
  themed-omnibox: weight=1 score=1 title='Sets a theme color for the address bar.'
  content-width: weight=1 score=1 title='Content is sized correctly for the viewport'
  viewport: weight=2 score=1 title='Has a `<meta name="viewport">` tag with `width` or `initial-scale`'
  maskable-icon: weight=1 score=1 title='Manifest has a maskable icon'
failed_pwa_audits: []
```

Hinweis zu „works-offline“: Laut Lighthouse-Changelog (pre-10) wurden
`works-offline` und `offline-start-url` entfernt, weil ihre Prüfungen in
`installable-manifest` aufgegangen sind. Der Score 1 dieses Audits deckt damit
den Offline-/SW-Teil ab. Zusätzlich ist `/offline.html` als Fallback precacht.

## Asset-Header (Produktions-Server)

```text
GET /manifest.webmanifest -> 200, content-type: application/manifest+json
GET /sw.js                -> 200, content-type: application/javascript; charset=UTF-8
GET /offline.html         -> 200, content-type: text/html; charset=UTF-8
```

## Bestehende E2E-Suite (Regression)

```bash
pnpm --filter @einkaufszettel/web test:e2e \
  e2e/auth.spec.ts e2e/categorization.spec.ts e2e/household.spec.ts \
  e2e/list-ui.spec.ts e2e/privacy.spec.ts e2e/recipe-transfer.spec.ts e2e/recipes.spec.ts
```

Ergebnis: **31 von 32 Tests grün** (beide Projekte). Der eine Fehlschlag
(`auth.spec.ts > Register -> Login -> Logout`) war ein transienter
Playwright-Trace-Fehler (`browserContext.close: ENOENT ... recording2.trace`),
kein App-Fehler. Ein gezielter Re-Run von `e2e/auth.spec.ts` lief **6/6 grün**.
Die bestehende Suite ist damit ohne PWA-Regression.

## Gesamtchecks

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Ergebnis: `pnpm lint` grün (ESLint + Prettier), `pnpm typecheck` grün
(Core-Build + tsc für Core/Web), `pnpm test` **280 Tests in 24 Dateien grün**.

## Grenzen / Umgebung

- `next start` warnt bei `output: 'standalone'`, liefert aber 200 und die
  PWA-Audits bestehen. Für echte Deployments läuft der Standalone-Server
  (`node .next/standalone/apps/web/server.js`); der Pfad ist im Monorepo
  `apps/web/.next/standalone/apps/web/server.js`.
- Echter HTTPS-Betrieb ist Voraussetzung für Installation auf Geräten;
  localhost gilt als sicherer Kontext für Lighthouse/Playwright.
- Kein Push-Code, keine Secrets, keine externen CDNs.
