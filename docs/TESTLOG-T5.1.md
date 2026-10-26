# Testlog T5.1 — E2E-Suite vollständig in CI (Chromium + WebKit-Mobile)

**Karte:** `t_1fb12e66` (T5.1, Welle 5 — keine Abhängigkeiten)
**Datum:** 2026-10-26
**Ergebnis:** Konfiguration vollständig; Chromium-Projekte grün (68/68). WebKit-Projekte
konfiguriert und per `--list` validiert; der WebKit-Lauf scheitert in dieser Sandbox an
fehlenden Systembibliotheken und ist als offener Host-/CI-Punkt dokumentiert.

## Ziel

Die Playwright-Suite läuft in CI vollständig über Chromium **und** WebKit-Mobile-Emulation.
Alle bestehenden Specs laufen in den neuen Projekten; `.github/workflows/e2e.yml` installiert
beide Engines; Berichte/Artefakte werden bei Fehlschlag hochgeladen.

## Änderungen

| Datei                           | Änderung                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/playwright.config.ts` | Zwei neue Projekte `webkit` (`devices['Desktop Safari']`) und `mobile-webkit` (`devices['iPhone 14']`). Der Chromium-Sandbox-Guard (`launchOptions.executablePath`) galt global und wäre auch auf WebKit angewendet worden (Chromium-Binary für WebKit → Launch-Fehler); er wird jetzt nur noch pro Chromium-Projekt gemerged. |
| `.github/workflows/e2e.yml`     | `playwright install --with-deps chromium webkit`; Job-Timeout 15 → 25 min (vier Projekte + CI-Retries); Report-Upload zusätzlich mit `apps/web/test-results` (Traces).                                                                                                                                                         |
| `apps/web/e2e/pwa.spec.ts`      | Projektbezogener `test.skip` für den SW-Kontrollnachweis in WebKit (Playwright unterstützt Service-Worker-Kontrolle nur für Chromium, s. `playwright.dev/docs/service-workers`).                                                                                                                                               |
| `apps/web/e2e/offline.spec.ts`  | Projektbezogener `test.skip` für Szenario A in WebKit: `context.setOffline(true)` bricht bei aktivem Service Worker die Navigation ab (`microsoft/playwright#42775`).                                                                                                                                                          |

Keine App-Verhaltensänderung. Die Offline-CRUD-Pfade ohne SW-Reload bleiben auch in WebKit
abgedeckt (`multiDeviceOffline.spec.ts`, `recipes.spec.ts`), ebenso Auth, Haushalt, Liste,
Rezepte, Kategorisierung, Dead-Letter, Privacy, PWA-Manifest und axe.

## Testzahlen je Projekt

```
$ pnpm --filter @einkaufszettel/web exec playwright test --list
Listing tests: 136 tests in 13 files
    34 chromium
    34 mobile-chromium
    34 webkit
    34 mobile-webkit
```

136 Tests = 34 Specs × 4 Projekte. Die zwei Ausnahmen oben ergeben je WebKit-Projekt
2 skippte Tests.

## Nachweise (echte Tool-Ausgaben)

### Chromium-Regression (chromium + mobile-chromium)

Erster voller Lauf: 67 passed / 1 failed (`categorization.spec.ts:112`, mobile-chromium,
gelernte Kategorie-Regel beim zweiten Artikel nicht angewandt). Der Test lief isoliert in
beiden Projekten grün (`2 passed`) — also ein Flake, keine Regression durch T5.1. Der
zweite volle Lauf war sauber:

```
$ pnpm --filter @einkaufszettel/web exec playwright test --project=chromium --project=mobile-chromium

  ✓  1..68 …
  68 passed (4.9m)
    34 chromium
    34 mobile-chromium
```

### WebKit-Startversuch (Sandbox)

Das WebKit-Binary ist vorhanden (`/tmp/pw-browsers/webkit-2370`, `INSTALLATION_COMPLETE`).
Ein Testlauf in `--project=webkit` findet den Browser, der Launch scheitert aber an
fehlenden Systembibliotheken:

```
$ PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers pnpm --filter @einkaufszettel/web exec playwright test --project=webkit --grep "geschuetzte Route"

  ✘  1 [webkit] › e2e/auth.spec.ts:25:1 › geschuetzte Route ohne Session leitet auf /login (3ms)
    Error: browserType.launch:
    ╔══════════════════════════════════════════════════════╗
    ║ Host system is missing dependencies to run browsers. ║
    ║ Missing libraries:                                   ║
    ║     libgstreamer-1.0.so.0   libgtk-4.so.1    …       ║
    ║     libsecret-1.so.0        libhyphen.so.0           ║
    ║     libGLESv2.so.2          libx264.so               ║
    ╚══════════════════════════════════════════════════════╝
```

Ohne root/apt und ohne Docker ist kein echter WebKit-Lauf in dieser Sandbox möglich
(identisch zur in der Spec beschriebenen Grenze). Der Launch-Versuch selbst ist damit
dokumentiert; die Konfiguration ist per `--list` validiert.

### Lint, Typecheck

```
$ pnpm lint
All matched files use Prettier code style!

$ pnpm typecheck
packages/core typecheck: Done
apps/web typecheck: Done
```

## Offene Punkte (nicht blockierend)

- **WebKit-Laufzeitnachweis** auf CI (`ubuntu-latest`, `--with-deps webkit`) oder einem
  Docker-Host nachzuholen — analog zu den offenen Punkten D14/T1.3 für den echten
  Supabase-Lauf. In CI installiert `--with-deps` die fehlenden Bibliotheken.
- **WebKit-Offline-Reload mit aktivem Service Worker**: Szenario A ist in WebKit geskippt.
  Eine WebKit-taugliche Variante (z. B. Reload ohne SW oder Warten auf das Upstream-Fix)
  kann als Folgekarte nach dem ersten echten WebKit-CI-Lauf entstehen.

## Abgrenzung

- Projektskips: 2 Tests × 2 WebKit-Projekte = 4 Skips (SW-Kontrolle, Offline-Reload).
  Beide mit Begründung und Upstream-Referenz; alle übrigen Specs laufen in allen Projekten.
- Kein Ersatz für den echten WebKit-CI-Lauf; dieser Nachweis bleibt offen (s. o.).
