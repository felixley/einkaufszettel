# TESTLOG T4.4 + T4.5 — UI-Polish & Mobile-Ergonomie

Stand: 2026-10-26 · Repo: `/opt/data/workspace/einkaufszettel` · App: `apps/web`

## Umfang

Umsetzung von PLAN.md §5:

- **T4.4** UI-Polish: Responsive (320–430 px primär), Dark Mode (System + Toggle,
  persistiert, kein Flash), Micro-Interactions, leere Zustände, Skeletons.
- **T4.5** Mobile-Ergonomie: Touch-Ziele ≥ 44 px (48 px angestrebt), Eingabefeld
  unten erreichbar inkl. Safe-Area, Enter bleibt im Feld, Autovervollständigung
  aus der Artikel-Historie (Dexie), Swipe zum Abhaken/Löschen (Pointer Events,
  sichtbare Buttons bleiben für A11y). _AK:_ Artikel in ≤ 2 Taps hinzufügen.

## Implementierung (Dateien)

| Datei                                         | Änderung                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/app/globals.css`                    | Theme-Variablen für `data-theme="light                                                                                                                                                                                                                       | dark"`+ Media-Fallback,`.theme-toggle`(44 × 44 px), Skeleton-Klassen,`prefers-reduced-motion: reduce`deaktiviert Animationen/Transitions,`body { overflow-x: hidden }` gegen H-Scroll bei 320 px. |
| `apps/web/components/theme/ThemeProvider.tsx` | Theme-Kontext (`light`/`dark`/`system`), Auflösung von „System“ via `matchMedia`, Persistenz in `localStorage` (`einkaufszettel-theme`), `storage`-Event für Tab-Sync.                                                                                       |
| `apps/web/components/theme/ThemeScript.tsx`   | Inline-Script (`next/script`, `beforeInteractive`) setzt `data-theme`/`data-theme-choice` **vor dem ersten Paint** → kein Hell/Dunkel-Flackern.                                                                                                              |
| `apps/web/components/theme/ThemeToggle.tsx`   | Zyklischer Toggle Hell → Dunkel → System, `aria-label`/`title` deutsch, 44 × 44 px, funktioniert auch ohne Provider (Fallback).                                                                                                                              |
| `apps/web/app/layout.tsx`                     | `ThemeScript` + `ThemeProvider` im Root-Layout; `suppressHydrationWarning` am `<html>` wegen Pre-Paint-Attribut.                                                                                                                                             |
| `apps/web/components/list/ListItemRow.tsx`    | Swipe per Pointer Events: rechts = abhaken, links = löschen; Achsen-Lock ab 10 px (vertikales Scrollen gewinnt); Klick nach Swipe unterdrückt; sichtbare Check-/Lösch-Buttons bleiben erhalten; Entfernen-Animation (entfällt bei `prefers-reduced-motion`). |
| `apps/web/components/list/useItemHistory.ts`  | Artikel-Historie aus Dexie (Name + letzte Menge/Einheit), sortiert nach letzter Nutzung — Grundlage für die Autovervollständigung.                                                                                                                           |
| `apps/web/app/lists/page.tsx`                 | Eingabefeld mit Vorschlagsliste (`role="listbox"`/`role="option"`, Pfeiltasten/Enter/Escape), Übernahme von Menge+Einheit per Tap, Fokus bleibt nach dem Hinzufügen im Feld; Skeleton-Ladezustand; Empty-State mit Handlungsaufforderung.                    |
| `apps/web/app/lists/lists.module.css`         | Safe-Area unten (`env(safe-area-inset-bottom)`), Add-Leiste mit `flex-wrap`, Swipe-Flächen, Vorschlagsliste, Touch-Ziele.                                                                                                                                    |
| `apps/web/app/recipes/page.tsx`               | Empty-State mit klarer CTA („Erstes Rezept anlegen“ / „Suche zurücksetzen“), Skeleton-Karten im Ladezustand, `ThemeToggle` in der Kopfzeile.                                                                                                                 |
| `apps/web/app/recipes/recipes.module.css`     | Empty-State-Karte, Undo-Toast **oben** positioniert (kollidiert nicht mehr mit der sticky Aktionsleiste), `stickyBar` mit `z-index`.                                                                                                                         |
| `apps/web/e2e/ui-polish.spec.ts`              | Neue E2E-Suite (5 Tests × 2 Projekte) für Dark-Toggle/Persistenz/Systemmodus, Touch-Ziele + 320-px-Overflow, ≤ 2-Tap-Hinzufügen, Swipe, reduzierte Bewegung.                                                                                                 |

## Nachweise

### Statische Checks

```
pnpm lint      → OK (eslint + prettier --check, keine Abweichungen)
pnpm typecheck → OK (packages/core + apps/web, tsc --noEmit)
pnpm test      → 280 Tests in 24 Dateien, alle grün (Vitest)
```

### E2E — neue Suite `e2e/ui-polish.spec.ts`

```
Running 10 tests using 1 worker
✓ [chromium]       Dark-Toggle wirkt, persistiert und System folgt emulateMedia
✓ [chromium]       Touch-Ziele ≥44 px, Eingabe unten erreichbar, kein H-Scroll bei 320 px
✓ [chromium]       Artikel in ≤2 Taps aus der Historie hinzufügen
✓ [chromium]       Swipe: rechts abhaken, links löschen (Pointer Events)
✓ [chromium]       prefers-reduced-motion reduziert Animationen
✓ [mobile-chromium] (alle fünf Tests, Pixel-7-Emulation)
10 passed
```

Ein Lauf mit aktivem Tracing scheiterte einmalig beim `browserContext.close`
(`ENOENT … .playwright-artifacts-0/traces/…`), weil parallele Worker im selben
Repo `test-results/` aufräumen. Mit `--trace=off` liefen dieselben Tests
vollständig grün (2/2 für den ≤2-Tap-Test, 10/10 für die Suite). Das ist ein
Artefakt-Rennen der Testumgebung, kein Produktfehler.

### Regression — bestehende Suite

Vollständiger Lauf (beide Projekte) mit `--trace=off`; Ergebnis siehe
`/tmp/e2e-full.log` (Laufzeit ~4–5 min, Hintergrundprozess). Die zuvor
beobachteten Fehlschläge in `e2e/recipes.spec.ts` und `e2e/household.spec.ts`
waren zwei echte Ursachen:

1. **Doppelter `data-testid="recipe-new"`** — Empty-State-CTA und Sticky-Bar
   hatten dasselbe Testid (strict-mode violation). Behoben: CTA im Empty-State
   ohne Testid, Sticky-Bar behält `recipe-new`.
2. **Undo-Toast kollidierte mit der Sticky-Bar** (`main`/Sticky-Bar fing den
   Klick ab). Behoben: Toast oben positioniert, `z-index: 60`, `pointer-events:
auto`; Sticky-Bar `z-index: 20`. Danach lief
   `e2e/recipes.spec.ts › Rezept anlegen … Undo` auf `mobile-chromium` grün.

## ≤ 2 Taps — belegte Schrittfolge

1. Eingabefeld antippen (Fokus liegt bereits im Feld, `autoFocus`).
2. Zeichen tippen → Vorschlag aus der Historie erscheint.
3. Vorschlag antippen → Name, Menge und Einheit werden übernommen, Fokus bleibt.
4. `+` (bzw. Enter) → Artikel ist auf der Liste.

Zwischen „Vorschlag antippen“ und „hinzufügen“ liegt genau **eine** weitere
Interaktion; zusammen mit dem Antippen des Vorschlags sind es **2 Taps** ab
gesetztem Cursor. Der E2E-Test prüft exakt diese Folge (Vorschlag „Milch“ →
Menge `1`, Einheit `l` übernommen → `+` → Zeile „Milch 1 l“ sichtbar, Fokus
bleibt im Eingabefeld).

## Offene Punkte / Hinweise

- Dark Mode respektiert `prefers-color-scheme`, solange „System“ gewählt ist;
  ein Wechsel der Systemeinstellung wirkt live (Media-Listener).
- Skeletons erscheinen nur in echten Ladephasen (Dexie-`liveQuery` liefert
  meist sofort); es wird bewusst nicht künstlich verzögert.
- Swipe-Richtung: rechts = abhaken, links = löschen (konventionell); bei
  vertikaler Bewegung > 10 px gewinnt das Scrollen (Achsen-Lock).
- Barrierefreiheit: Fokusringe bleiben erhalten; Kontrast über die
  CSS-Variablen (Prüfung durch T4.6/axe).

## Nachtrag 2026-10-26 11:20 — Wiederholungslauf nach Crash (Run 86)

Der vorige Worker hatte den Code committet (365e1c6), ist aber bei der
Abschlussantwort in eine Repetitions-Schleife geraten. Dabei blieb ein
unfertiger Edit in `app/lists/page.tsx` liegen: ein deklarierter, aber
ungenutzter `submitLockRef`. Der Ref ist jetzt korrekt verdrahtet (Lock setzen
vor dem ersten `await`, Freigabe im `finally`) und verhindert Doppel-Adds, die
zwischen Dexie-Schreibvorgang und React-Render sonst still verloren gingen.

Frischer Nachweis (nach dem Fix, gleicher Rechner):

```
pnpm typecheck                          → OK
pnpm lint                               → OK (eslint + prettier --check)
pnpm test                               → 280 Tests in 24 Dateien, alle grün
pnpm --filter @einkaufszettel/web build → exit 0 (14/14 static pages)
playwright test e2e/ui-polish.spec.ts   → 10 passed (1.5m, chromium + mobile-chromium)
playwright test (volle Suite)           → 52 passed (3.4m)
```

Die volle Suite enthält zusätzlich `e2e/dead-letter.spec.ts` (T4.3b) und
`e2e/pwa.spec.ts` (T4.1) aus dem aktuellen Arbeitsbaum; keine Regression.
