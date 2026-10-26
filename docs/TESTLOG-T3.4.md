# Testlog T3.4-UI — „Auf die Einkaufsliste“-Vorschau-Dialog

**Commit:** `502d6fa` (lokal, nicht gepusht)
**Datum:** 2026-10-26
**Scope:** `apps/web` (Dialog, Transfer-Logik, Vitest, E2E) — keine Änderungen an
`packages/core` oder `supabase/migrations`.

## Umsetzung

- `apps/web/lib/recipes/transfer.ts`
  - `buildTransferPreviews`: skaliert über Core-`scaleRecipe`, prüft je Zutat den
    Konflikt gegen die aktiven Listenzeilen über Core-`addToList`
    (`new` / `aggregate` / `incompatible` / `missing-quantity`) und formatiert
    Mengen mit Core-`formatIngredient`/`formatQuantity`.
  - `buildTransferRequests`: erzeugt pro ausgewählter Zutat genau eine
    `AddToListRequest` mit **frischer UUIDv7** (`request_id`) und
    `source_recipe_id`. Die ID wird beim Bestätigen erzeugt und liegt danach
    unverändert im Outbox-Payload → Replay addiert nicht doppelt; eine bewusste
    zweite Übertragung erzeugt neue IDs → Mengen addieren.
  - `applyTransferRequests`: Mock-Modus wendet Core-`addToList` lokal auf Dexie
    an; Supabase-Modus reiht `add_to_list` in die Outbox ein (RPC/Replay).
- `apps/web/components/recipes/AddToShoppingListDialog.tsx` (+ CSS-Modul)
  - Bottom-Sheet, `role="dialog"`, `aria-modal`, Fokusfalle, Escape/Backdrop/×,
    Touch-Ziele ≥ 48 px, Primäraktion unten, Live-Vorschau, Alle/Keine,
    Read-only-Hinweis für Viewer, Fehler-/Erfolgsstatus.
- `apps/web/app/recipes/[recipeId]/page.tsx`
  - Button „Auf die Einkaufsliste“ im Rezept-Detail, `listId` aus aktiven
    Listendaten (Fallback `default-list-id` wie im manuellen Add-Flow).
- `PLAN.md`: T3.3 und T3.4 abgehakt.

## Verifikation (echte Tool-Ausgaben)

### Typecheck (strict, Core + Web)

```
> pnpm --filter @einkaufszettel/core build && tsc --noEmit -p tsconfig.json && pnpm -r --if-present typecheck
packages/core build: Done / tsc -p tsconfig.build.json
packages/core typecheck: Done
apps/web typecheck: Done
EXIT: 0
```

### Unit-/Integrationstests (Vitest)

```
✓ apps/web/lib/recipes/transfer.test.ts (12 tests)
Test Files  19 passed (19)
     Tests  231 passed (231)
EXIT: 0
```

Abgedeckte Transfer-Fälle: Skalierung 4→6, Aggregationshinweis inkl.
Zielmenge, inkompatible Einheit, fehlende Menge, offene Basisportionen,
Aggregation innerhalb eines Entwurfs, Auswahl-Filter, stabile `request_id`,
`source_recipe_id`, Mock-Doppelübertragung (500 g + 500 g = 1000 g, eine Zeile)
sowie Supabase-Outbox (2 `add_to_list`-Einträge, keine lokale Zeile).

### Lint/Format

```
> eslint . && prettier --check ...
Checking formatting...
All matched files use Prettier code style!
EXIT: 0
```

### Build

```
> pnpm -r --if-present build
packages/core build: Done
apps/web build: ✓ Compiled successfully
apps/web build: ✓ Generating static pages (11/11)
apps/web build: Done
EXIT: 0
```

### E2E (Playwright, beide Projekte)

```
Running 4 tests using 1 worker
✓ [chromium]      skaliert, zeigt „Bereits auf Liste“ und addiert bei zweiter Übertragung
✓ [chromium]      inkompatible Einheit erzeugt eine eigene Zeile
✓ [mobile-chromium] skaliert, zeigt „Bereits auf Liste“ und addiert bei zweiter Übertragung
✓ [mobile-chromium] inkompatible Einheit erzeugt eine eigene Zeile
4 passed (26.2s)
EXIT: 0
```

DB-Assertions im E2E (Dexie `list_items`):

- 1. Übertragung (6 Portionen): Spaghetti `quantity=750`, `unit=g`,
     `source_recipe_id` = Rezept-ID.
- 2. Übertragung (4 Portionen): weiterhin **eine** Spaghetti-Zeile mit
     `quantity=1250`; Tomaten eine Zeile mit `quantity=5`, `unit=Dose`.
- Inkompatibel: bestehende Eier-Zeile `1 kg` + neue Zeile `2 Stk` (2 Zeilen,
  neue Zeile mit `source_recipe_id`).

## Offene Punkte / Grenzen

- Die Ziel-`list_id` wird im Mock-/E2E-Modus wie im bestehenden manuellen
  Add-Flow als `default-list-id` verwendet bzw. aus vorhandenen Listendaten
  abgeleitet. Eine belastbare Auflösung der Haushalts-Standardliste über
  `list_lists` für den Supabase-Modus ist ein bestehender, projektweiter
  Infrastruktur-Gap (auch der manuelle Add-Flow nutzt den Fallback) und nicht
  Teil dieses Karten-Scopes.
- Der lokale Commit wurde **nicht gepusht**.
