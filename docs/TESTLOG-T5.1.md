# Testlog T5.1 — E2E-Suite vollständig in CI (Chromium + WebKit-Mobile)

**Karte:** `t_1fb12e66` (T5.1, Welle 5 — keine Abhängigkeiten)
**Datum:** 2026-10-26
**Ergebnis:** Konfiguration vollständig; Chromium-Projekte grün (68/68). WebKit-Projekte
konfiguriert und per `--list` validiert; der WebKit-Lauf scheitert in dieser Sandbox an
fehlenden Systembibliotheken und ist als offener Host-/CI-Punkt dokumentiert.

> **Korrektur 2026-10-26 (D23/D24, nachgetragen bei `t_57fb0acb`):** Die Aussage
> „Chromium-Projekte grün (68/68)“ war **nur lokal** belegt. Der CI-Job `E2E`
> (`.github/workflows/e2e.yml`) war zu diesem Zeitpunkt **rot** — und zwar in
> _jedem_ Lauf auf `master`: es liefen **0 Tests**, weil `packages/core` in CI
> nie gebaut wurde und der Dev-Server deshalb nicht hochkam
> (`Timed out waiting 180000ms from config.webServer.`). Ursache, Fix und Belege:
> `docs/REVIEW.md` D23, `docs/DECISIONS.md` (D23-Eintrag). Der Abschnitt
> „Offene Punkte“ unten ist insoweit überholt — der WebKit-Lauf **hat** jetzt in
> CI stattgefunden und dabei **9 Fehlschläge** aufgedeckt (D24); Details und
> echte Zahlen im Korrektur-Abschnitt am Ende dieser Datei.

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
- Kein Ersatz für den echten WebKit-CI-Lauf; dieser Nachweis bleibt offen (s. o.) —
  **überholt**, siehe Korrektur-Abschnitt.

## Korrektur 2026-10-26 — echte CI-Zahlen nach D23-Fix (Karte `t_57fb0acb`)

**Was war falsch:** Der Nachweis „68/68 grün“ galt ausschließlich für die Sandbox.
Der CI-Job `E2E` war in **jedem** Lauf auf `master` rot und führte **0 Tests** aus
(webServer-Timeout, Ursache: fehlender `packages/core`-Build, D23). Die Doku hat
das nicht ausgewiesen; korrigiert hier und in `docs/REVIEW.md` §12.

**Fix:** `.github/workflows/e2e.yml` bekommt vor „Run E2E tests“ den Schritt
`pnpm --filter @einkaufszettel/core build` (Commit `4e26cd5`, Entscheidung +
Alternative in `docs/DECISIONS.md`).

**Echter CI-Lauf nach dem Fix** — Run `40393343034`, Workflow `E2E`, `master`,
`4e26cd5`, Dauer 9 m 26 s, Ergebnis **failure** (aber die Suite _läuft_ jetzt):

```text
$ gh run view 40393343034 --log-failed     # Auszug, Projekt-Zählung aus dem Log
  chromium          34 ✓   0 ✘
  mobile-chromium   34 ✓   0 ✘
  webkit            27 ✓   5 ✘   2 skipped
  mobile-webkit     28 ✓   4 ✘   2 skipped

  9 failed
  4 skipped
  123 passed (8.3m)
```

- **Chromium-Lane:** `chromium` + `mobile-chromium` = **68/68 grün** — damit ist
  das T5.1-AK („Chromium-Suite 68/68 grün in CI“) jetzt **echt** erfüllt (nicht
  mehr nur lokal). Lokal auf demselben Commit gegengeprüft: `68 passed (4.9m)`.
- **WebKit-Lane:** die Projekte **laufen** jetzt wirklich (Browser startet, Tests
  führen aus, `--with-deps` reicht also für die Syslibs) — aber **9 Tests fallen
  um**, jeweils in `webkit` **und** `mobile-webkit` (nicht deterministisch: 5 vs.
  4, `recipe-transfer.spec.ts:95` fällt nur in `webkit` um). Fehlerbild:

  ```text
  Error: page.goto: Navigation to "http://localhost:3210/lists" is interrupted
         by another navigation to "http://localhost:3210/household"
  [WebServer] [browser] Failed to fetch RSC payload for
         http://localhost:3210/household. Falling back to browser navigation.
         TypeError: Load failed
  ```

  Betroffen: `categorization.spec.ts:80`, `recipe-transfer.spec.ts:95` und `:160`,
  `recipes.spec.ts:64` und `:116` (je Projekt). Alle 3 Versuche (2 CI-Retries)
  schlagen fehl. Das ist **kein** Syslib-Problem, sondern ein eigener Defekt →
  **D24** in `docs/REVIEW.md`.

**Sandbox-Grenze bleibt:** Ein lokaler WebKit-Lauf ist hier nicht möglich. Das
Binary ist vorhanden (`/tmp/pw-browsers/webkit-2370`, `INSTALLATION_COMPLETE`),
der Launch scheitert aber an fehlenden Systembibliotheken (eigener Nachweis
2026-10-26, `PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers playwright test
--project=webkit`):

```text
  ║ Host system is missing dependencies to run browsers. ║
  ║     libharfbuzz-icu.so.0   libepoxy.so.0   libjpeg.so.62   ║
  ║     libwebpmux.so.3  libwebp.so.7  libwayland-egl.so.1     ║
  ║     libwayland-client.so.0  libmanette-0.2.so.0            ║
  ║     libenchant-2.so.2  libsecret-1.so.0  libhyphen.so.0   ║
  ║     libGLESv2.so.2  libx264.so                            ║
```

Damit ist auch die Reproduktion von D24 an den CI-Läufer gebunden.
