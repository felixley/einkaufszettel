# TESTLOG T4.2 — Offline-E2E („Supermarkt ohne Netz“ + „zwei Geräte offline, dann online“)

Datum: 2026-10-26
Umgebung: Repo `/opt/data/workspace/einkaufszettel`, Node 26.7.0, Next 16.4.3 (Turbopack),
Playwright 1.64.1, Chromium + Mobile-Chromium (Pixel 7). Dev-Server auf
`http://localhost:3210` (Mock-Auth, `NEXT_PUBLIC_PWA_DISABLED=true`; SW wird in
Szenario A gezielt per `?sw=on` registriert). Mock-Sync-Store im Dev-Server-Prozess.

Geprüfter Stand: Arbeitsbaum auf `master` (HEAD `b4fe391`) **plus** parallel
uncommittete Änderungen anderer Worker (u. a. T4.3b: `worker.ts`, `status.ts`,
`repository.ts`, `SyncStatusBadge.tsx`). Die neuen Specs hängen nur an den
T4.1/T4.2a-Schnittstellen; die benutzten Badge-Attribute
(`data-sync-state`, `data-pending-count`) existieren bereits in `b4fe391`
(`git show HEAD:apps/web/components/SyncStatusBadge.tsx`). Der Lauf unten ist
gegen den Arbeitsbaum, nicht gegen einen frischen HEAD-Checkout.

## Zweck

E2E-Nachweis der beiden PLAN-AKs (C-3, T4.2):

1. **Szenario A — „Supermarkt ohne Netz“:** offline hinzufügen/abhaken/löschen,
   Offline-Reload rendert App-Shell, Dexie-Daten bleiben, Reconnect → pending 0
   und Serverzeilen korrekt (Mock-Sync-API-GET).
2. **Szenario B — „zwei Geräte offline, dann online“:** zwei getrennte
   Browser-Kontexte (gleiche Session ⇒ gleicher Sync-Scope, getrennte IndexedDB)
   gehen offline, ändern je lokal, gehen nacheinander online; danach sieht jedes
   Gerät beide Änderungen — keine Duplikate, keine Verluste.

## Neue Specs

- `apps/web/e2e/offline.spec.ts` — Szenario A (1 Test).
- `apps/web/e2e/multiDeviceOffline.spec.ts` — Szenario B (1 Test).

Damit sind es zusammen 2 Szenarien × 2 Projekte = 4 Testausführungen pro Lauf;
die Aufgabenstellung nennt die beiden Dateien ausdrücklich als Deliverables.
Der Architekten-Kommentar nennt nur `offline.spec.ts` — inhaltlich sind beide
Szenarien abgedeckt, nur auf zwei Dateien verteilt (keine doppelten Tests).

## Abweichungen von der Karten-Spezifikation (bewusst, dokumentiert)

1. **Szenario B nutzt zwei Kontexte desselben Nutzers** (Session per
   `storageState` kopiert) statt einer Einladung zweier verschiedener Nutzer.
   Grund: Der Sync-Scope des Mock-Modus ist
   `readCachedHouseholdId() ?? user.id` (DECISIONS.md, T4.2a Entscheidung 3).
   Eine Einladung mit zwei Nutzern würde ohne gecachte Haushalts-ID **zwei
   verschiedene Scopes** erzeugen; die Konvergenz wäre dann eine Scope-/Produkt-
   Frage, nicht die des Offline-Syncs. Mit zwei Kontexten desselben Nutzers sind
   es echte „zwei Geräte“ mit getrennter IndexedDB und gemeinsamem Scope — genau
   der zu prüfende Offline-Sync-Pfad. Ein Zwei-Nutzer-Haushalt-E2E bleibt als
   offener Punkt (Produktentscheidung Haushalts-Scope im Mock-Modus).
2. **Szenario A legt keinen Haushalt an.** Die Liste nutzt `default-list-id` und
   funktioniert ohne Haushalt (wie `list-ui.spec.ts`); der Haushaltsbezug ist für
   Rezepte relevant, nicht für die Offline-Liste. Das ändert den geprüften
   Sync-Pfad nicht.

## Ausgeführte Befehle und echte Ausgaben

### 1) Beide Specs, beide Projekte — Lauf 1

```bash
cd apps/web
./node_modules/.bin/playwright test e2e/offline.spec.ts e2e/multiDeviceOffline.spec.ts
```

```text
Running 4 tests using 1 worker

  ✓  1 [chromium] › e2e/multiDeviceOffline.spec.ts:73:1 › Szenario B: zwei Geräte offline, dann online — beide sehen beide Änderungen (8.4s)
  ✓  2 [chromium] › e2e/offline.spec.ts:108:1 › Szenario A: Supermarkt ohne Netz — Offline-CRUD, Offline-Reload, Reconnect-Sync (8.8s)
  ✓  3 [mobile-chromium] › e2e/multiDeviceOffline.spec.ts:73:1 › Szenario B: zwei Geräte offline, dann online — beide sehen beide Änderungen (8.2s)
  ✓  4 [mobile-chromium] › e2e/offline.spec.ts:108:1 › Szenario A: Supermarkt ohne Netz — Offline-CRUD, Offline-Reload, Reconnect-Sync (7.9s)

  4 passed (35.3s)
```

### 2) Beide Specs, beide Projekte — Lauf 2 (Wiederholung, „2× hintereinander“)

```bash
./node_modules/.bin/playwright test e2e/offline.spec.ts e2e/multiDeviceOffline.spec.ts
```

```text
Running 4 tests using 1 worker

  ✓  1 [chromium] › e2e/multiDeviceOffline.spec.ts:73:1 › Szenario B: zwei Geräte offline, dann online — beide sehen beide Änderungen (8.1s)
  ✓  2 [chromium] › e2e/offline.spec.ts:108:1 › Szenario A: Supermarkt ohne Netz — Offline-CRUD, Offline-Reload, Reconnect-Sync (7.0s)
  ✓  3 [mobile-chromium] › e2e/multiDeviceOffline.spec.ts:73:1 › Szenario B: zwei Geräte offline, dann online — beide sehen beide Änderungen (8.7s)
  ✓  4 [mobile-chromium] › e2e/offline.spec.ts:108:1 › Szenario A: Supermarkt ohne Netz — Offline-CRUD, Offline-Reload, Reconnect-Sync (9.3s)

  4 passed (35.2s)
```

### 3) Gesamtsuite-Regression (alle E2E-Specs, beide Projekte)

```bash
cd apps/web
./node_modules/.bin/playwright test
```

```text
  68 passed (5.6m)
```

Enthalten u. a.: `offline.spec.ts`, `multiDeviceOffline.spec.ts`, `pwa.spec.ts`,
`list-ui.spec.ts`, `recipes.spec.ts`, `recipe-transfer.spec.ts`,
`household.spec.ts`, `privacy.spec.ts`, `auth.spec.ts`, `categorization.spec.ts`,
`dead-letter.spec.ts`, `ui-polish.spec.ts`, `a11y.spec.ts` — je in `chromium`
und `mobile-chromium`.

### 4) Unit-Tests

```bash
cd /opt/data/workspace/einkaufszettel
./node_modules/.bin/vitest run
```

```text
 Test Files  24 passed (24)
      Tests  280 passed (280)
   Duration  8.13s
```

### 5) Typecheck

```bash
cd apps/web
../../node_modules/.bin/tsc --noEmit -p tsconfig.json
```

Ergebnis: Exit 0 (keine Fehler).

### 6) Formatierung

```bash
./node_modules/.bin/prettier --check apps/web/e2e/offline.spec.ts apps/web/e2e/multiDeviceOffline.spec.ts
```

```text
All matched files use Prettier code style!
```

## Was die Specs konkret prüfen

### Szenario A (`offline.spec.ts`)

1. Registrierung/Login im Mock-Modus, Sync-Scope = Nutzer-ID aus der Session.
2. Service Worker per `?sw=on` registrieren, Seite kontrollieren lassen.
3. Online „Brot“ anlegen; **gegen die Mock-Sync-API pollen**, bis die aktive
   Serverzeile existiert (nicht gegen das Badge — siehe Befund 1).
4. `context.setOffline(true)`; offline „Milch“ (2 l) und „Butter“ (250 g)
   anlegen, „Butter“ abhaken, „Brot“ löschen.
5. Badge: `data-sync-state="offline"`, `data-pending-count="3"`.
6. Dexie direkt über IndexedDB gelesen: aktive Zeilen `['Butter','Milch']`,
   „Brot“ mit `deleted_at`, „Butter“ mit `checked=true`.
7. **Offline-Reload**: Seite neu laden; ein `h1` (App-Shell) ist sichtbar, und
   die Dexie-Zeilen sind unverändert vorhanden.
8. Reconnect, `/lists` laden, warten bis `data-pending-count="0"` und
   `data-sync-state="synced"`.
9. GET `/api/mock/sync?scope=<user-id>`: aktive Zeilen genau `['Butter','Milch']`
   mit korrekter Menge/Einheit, „Butter“ checked, „Brot“ als Tombstone
   (`deleted_at` gesetzt).

### Szenario B (`multiDeviceOffline.spec.ts`)

1. Gerät A registriert/angemeldet; `storageState` (Cookies + localStorage) wird
   für Gerät B kopiert. B hat damit dieselbe Session und denselben Sync-Scope,
   aber eine **frische IndexedDB** (getrennte Geräte).
2. A legt online „Brot“ an; B sieht es über die Polling-Realtime (≤ 15 s).
3. Beide Kontexte `setOffline(true)`; A legt „Milch-A“ (1 l), B „Butter-B“
   (250 g) an; je `data-pending-count="1"`.
4. A geht zuerst online (pending → 0, synced), dann B (pending → 0, synced).
5. Konvergenz: **beide** Seiten zeigen „Brot“, „Milch-A“, „Butter-B“ und genau
   3 `list-item`-Zeilen (keine Duplikate).
6. GET `/api/mock/sync?scope=…`: genau drei aktive Serverzeilen, Namen
   `['Brot','Butter-B','Milch-A']`, keine Duplikate.

## Gefundene und behobene Testprobleme (keine Produktdefekte)

1. **Race im ersten Testentwurf (Szenario A):** Nach dem Online-Anlegen von
   „Brot“ wurde auf `data-pending-count="0"` gepollt. Der Badge zeigt bei
   schnellem Erfolg nie sichtbar „pending“ (250-ms-Debounce + Replay); der Wert
   war daher schon **vor** dem POST `0`, und der anschließende GET lief ins
   Leere (`rows: []`). Der Debug-Lauf zeigte: POST ging mit korrektem Scope
   (`scope = User-ID`) raus, Server antwortete 200, GET lieferte „Brot“ erst
   ~500 ms später. **Kein Produktfehler** — der Test wartete auf das falsche
   Signal. Fix: deterministisch gegen die Mock-Sync-API pollen, bis die Zeile
   existiert. Danach beide Läufe grün.
2. **Offline-Reload in Dev:** Der Service Worker (`apps/web/public/sw.js`)
   cached bewusst keine privaten Listen-HTMLs; `networkFirst` fällt für
   Navigationen auf die gecachte `/`-App-Shell zurück. Der Test prüft daher
   „App-Shell rendert + Dexie-Daten vorhanden“ (PLAN-Formulierung C-3), nicht
   „die Listen-Seite selbst rendert offline“. Das ist die dokumentierte,
   intendierte Dev-Abweichung.

## Grenzen des Nachweises

- Mock-Sync-Store ist in-memory und nicht persistent; Neustart des Dev-Servers
  leert ihn. Die Tests nutzen pro Lauf eine frische Nutzer-ID als Scope.
- Kein echter Supabase/PostgREST-Lauf (Sandbox ohne Docker); der Supabase-Pfad
  bleibt unverändert und ist hier nicht abgedeckt.
- Offline wird per `context.setOffline(true)` emuliert (Chromium), nicht per
  echtem Funkloch.
- Der Lauf erfolgte gegen den Arbeitsbaum inkl. paralleler, uncommitteter
  T4.3b-Änderungen (siehe oben).

## Ergebnis

Szenario A und Szenario B sind in `chromium` und `mobile-chromium` je **2×
hintereinander grün**; die Gesamtsuite (68 Tests) ist grün. T4.2 ist damit
erfüllt.
