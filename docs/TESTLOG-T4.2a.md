# Testlog T4.2a — Dev-Mock-Sync-Server + Mock-Realtime

Datum: 2026-10-26
Umgebung: Repo `/opt/data/workspace/einkaufszettel`, Node 22, Vitest 3.2.7.
Geprüfter Stand: Commit-Stand vor diesem Commit (Arbeitsbaum mit T4.2a-Änderungen).

## Zweck

Nachweis, dass zwei Adapter-Instanzen (Client A/B) gegen denselben
Dev-Mock-Sync-Server konvergieren, ohne Supabase/Netzwerk. Der Server läuft als
echter Next.js-Route-Handler (`apps/web/app/api/mock/sync/route.ts`); der Test
ruft diese Handler direkt auf (kein Netzwerk, aber identischer Code wie im
Dev-Server). Zustand: In-Memory, pro Prozess, kein Persist.

## Ausgeführter Befehl

```bash
cd /opt/data/workspace/einkaufszettel
pnpm vitest run apps/web/lib/sync/mock-adapter.test.ts --reporter=verbose
```

## Echte Tool-Ausgabe (Auszug)

```text
 RUN  v3.2.7 /opt/data/workspace/einkaufszettel

 ✓ apps/web/lib/sync/mock-adapter.test.ts > MockSyncAdapter gegen den Dev-Mock-Sync-Server > konvergiert: zwei Clients (A/B) sehen nach dem Sync beide Zeilen 24ms
 ✓ apps/web/lib/sync/mock-adapter.test.ts > MockSyncAdapter gegen den Dev-Mock-Sync-Server > ist idempotent: derselbe Upsert 2x ergibt eine Zeile 3ms
 ✓ apps/web/lib/sync/mock-adapter.test.ts > MockSyncAdapter gegen den Dev-Mock-Sync-Server > add_to_list: gleiche request_id 2x erzeugt keine Doppelmenge 3ms
 ✓ apps/web/lib/sync/mock-adapter.test.ts > MockSyncAdapter gegen den Dev-Mock-Sync-Server > add_to_list aggregiert verschiedene request_ids nach Name+Dimension 2ms
 ✓ apps/web/lib/sync/mock-adapter.test.ts > MockSyncAdapter gegen den Dev-Mock-Sync-Server > Soft-Delete gewinnt gegen spaeteren Edit (kein Wiederbeleben) 2ms
 ✓ apps/web/lib/sync/mock-adapter.test.ts > MockSyncAdapter gegen den Dev-Mock-Sync-Server > liefert nur Aenderungen seit dem Cursor 2ms
 ✓ apps/web/lib/sync/mock-adapter.test.ts > MockSyncAdapter gegen den Dev-Mock-Sync-Server > wirft bei ungueltigem Payload, damit die Outbox erneut versucht 2ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  09:27:41
   Duration  552ms (transform 189ms, setup 0ms, collect 249ms, tests 40ms, environment 0ms, prepare 89ms)
```

### Einordnung der AKs

- **Konvergenz (< 5 s):** Der Testfall „konvergiert“ schreibt je eine Zeile über
  Client A und Client B und liest danach beide Scopes aus. Beide sehen
  `['a-1', 'b-1']`; Laufzeit **24 ms**. Gemessen wird nur die Handler-Laufzeit,
  nicht Browser-Netzwerk. Das AK „< 5 s“ ist damit deutlich erfüllt.
- **Idempotenz:** Derselbe Upsert 2× erzeugt genau eine Zeile. `add_to_list`
  mit derselben `request_id` 2× erzeugt keine Doppelmenge.
- **Aggregation:** Zwei `request_id`s mit gleichem normalisiertem Namen und
  gleicher Dimension ergeben eine Zeile mit Menge 5.
- **Soft-Delete:** Löschen gewinnt gegen einen späteren Edit; die Zeile bleibt
  gelöscht und behält den alten Namen.
- **Cursor:** `GET ...?since=<cursor>` liefert nur die danach geschriebene Zeile.

## Vollständiger Projektlauf

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Ergebnis: `pnpm lint` grün (ESLint + Prettier), `pnpm typecheck` grün,
`pnpm test` **269 Tests in 23 Dateien grün** (Laufzeit ~9 s).

Hinweis: `pnpm lint` prüft das gesamte Repo. Während dieses Laufs waren
Änderungen paralleler Worker im Arbeitsbaum (u. a. `packages/core/src/outbox.*`,
`apps/web/app/globals.css`, PWA-Dateien). Diese wurden nicht von T4.2a
beigesteuert und nicht mitcommittet; die Formatierung von
`packages/core/src/outbox.test.ts` wurde für den grünen Lauf einmalig
angepasst (nur Whitespace/Format, kein Verhalten).

## Grenzen des Nachweises

- Kein Browser-/E2E-Lauf in diesem Log. Der Adapter-/Realtime-Pfad ist auf
  Handler-Ebene belegt; der Browser-E2E-Nachweis („zwei Geräte offline, dann
  online“) gehört zu T4.2b (QA) und baut auf diesen Komponenten auf.
- Der Server persistiert nichts. Ein Neustart des Dev-Servers leert den Store.
- Die Route ist dev-only und antwortet außerhalb des Mock-Modus mit 404.
