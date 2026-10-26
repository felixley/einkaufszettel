# Testlog T4.6 — Barrierefreiheit-Basis + axe-Check

**Karte:** `t_e07f902e` (T4.6, abhängig von T4.4/4.5)
**Datum:** 2026-10-26
**Ergebnis:** grün — 0 serious/critical axe-Violations auf Login, Liste, Rezepte und Haushalt in beiden Playwright-Projekten.

## Ziel

WCAG-Basis (Kontrast, Fokus, Labels, Rollen) herstellen und einen automatisierten
axe-Check in die bestehende Playwright-Suite aufnehmen. `.github/workflows/e2e.yml`
führt `playwright test` über `./e2e` aus; die neue Spec läuft damit ohne Workflow-Änderung in CI.

## Änderungen

| Datei                                                 | Änderung                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/package.json`                               | devDependency `@axe-core/playwright@4.14.0`; Script `test:a11y`                                                                                                                       |
| `pnpm-lock.yaml`                                      | Lockfile zur neuen devDependency                                                                                                                                                      |
| `apps/web/e2e/a11y.spec.ts`                           | **neu** — `AxeBuilder` auf Login, Registrierung (dunkel), Liste (hell + dunkel), Rezepte, Haushalt; WCAG-Tags 2.0/2.1/2.2 A+AA; Reflow-Check bei 320 px in beiden Themes              |
| `apps/web/app/globals.css`                            | `--primary` im Hell-Theme `#1f6feb` → `#1c66e0` (Kontrast 4.32:1 → 4.9:1 auf `--bg`; weiße Schrift auf dem Button 5.2:1)                                                              |
| `apps/web/app/lists/page.tsx`                         | Eingabefeld „Neuer Artikel“: `role="combobox"` + `aria-haspopup="listbox"`; `aria-controls` nur bei geöffneter Vorschlagsliste (axe: `aria-expanded` war auf `textbox` nicht erlaubt) |
| `apps/web/app/layout.tsx`, `apps/web/app/manifest.ts` | `themeColor` konsistent auf `#1c66e0`                                                                                                                                                 |

Keine Verhaltensänderung: Die Combobox-Attribute ändern nur die ARIA-Semantik, die
Vorschlagslogik (Tastatur/Pointer) bleibt unverändert. Der Farbwechsel betrifft nur
das Hell-Theme; das Dunkel-Theme war bereits konform.

## axe-Befund vorher → nachher

Vor dem Fix (erster Lauf, 8 von 12 Tests rot, Auszug):

```
• [serious] color-contrast: a[href$="forgot-password"], a[href$="register"], a[href="/"]
  insufficient color contrast of 4.32 (fg #1f6feb, bg #f7f7f8), expected 4.5:1
• [critical] aria-allowed-attr: input[aria-label="Neuer Artikel"]
  ARIA attribute is not allowed: aria-expanded="false"
```

Nach dem Fix: 12/12 Tests grün, `[a11y] … 0 Verstoesse` für alle geprüften Seiten.
Die Logzeile nennt zusätzlich bestandene Regeln; „unklar“ sind axe-`incomplete`-Fälle
(z. B. Kontrast über Verläufen), keine Violations.

## Nachweise (echte Tool-Ausgaben)

### axe-Spec, beide Projekte

```
$ pnpm --filter @einkaufszettel/web test:a11y

Running 12 tests using 1 worker
[a11y] Login / hell: 0 Verstoesse, 24 Regeln bestanden, 0 unklar
  ✓   1 [chromium] … Login (hell): keine WCAG-A/AA-Verstoesse
[a11y] Registrierung / dunkel: 0 Verstoesse, 24 Regeln bestanden, 0 unklar
  ✓   2 [chromium] … Registrierung (dunkel)
[a11y] Liste / hell: 0 Verstoesse, 26 Regeln bestanden, 2 unklar
[a11y] Liste / dunkel: 0 Verstoesse, 26 Regeln bestanden, 2 unklar
  ✓   3 [chromium] … Liste mit Artikel (hell + dunkel)
[a11y] Rezepte / hell: 0 Verstoesse, 24 Regeln bestanden, 2 unklar
  ✓   4 [chromium] … Rezepte (hell)
[a11y] Haushalt / hell: 0 Verstoesse, 25 Regeln bestanden, 0 unklar
  ✓   5 [chromium] … Haushalt (hell)
  ✓   6 [chromium] … Kein horizontales Scrollen bei 320 px in Hell und Dunkel
… dieselben sechs Tests für [mobile-chromium] …
  12 passed (40.2s)
```

### Gesamte E2E-Suite (Regression)

```
$ pnpm test:e2e
  64 passed (4.5m)
```

### Lint, Typecheck, Unit-Tests

```
$ pnpm lint
All matched files use Prettier code style!

$ pnpm typecheck
packages/core typecheck: Done
apps/web typecheck: Done

$ pnpm test
Test Files  24 passed (24)
     Tests  280 passed (280)
```

## Abdeckung / Grenzen

- Geprüft: Login, Registrierung (dunkel), Liste mit Artikel (hell + dunkel), Rezepte, Haushalt,
  Reflow bei 320 px. axe-Regeln: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`.
- Nicht separat per axe geprüft: Dead-Letter-Dialog (eigene Spec `dead-letter.spec.ts`, Panel
  wird dort funktional und per Rolle/Fokus getestet) sowie authentifizierte Rezept-Detailseiten.
- axe findet nicht alles (z. B. Fokus-Reihenfolge, Verständlichkeit). Die bestehenden E2E-Tests
  für Tastaturfokus/Enter-Verhalten (`ui-polish.spec.ts`) laufen weiter mit.
