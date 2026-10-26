# TESTLOG T4.3 — Dead-Letter-Anzeige, Retry & Verwerfen

Datum: 2026-10-26 · Branch: `master` (Arbeitsstand aus `t_e8af35e9`, von QA geprüft und committet)

## Umfang

- `apps/web/components/sync/DeadLetterPanel.tsx` (+ CSS-Modul): Bottom-Sheet mit
  „Erneut versuchen“ / „Verwerfen“, Fokus auf „Schließen“, Escape schließt,
  Touch-Ziele ≥ 48 px, `aria-live`-Statusmeldungen, reaktive Liste via Dexie.
- `apps/web/components/SyncStatusBadge.tsx`: Badge öffnet das Panel zusätzlich
  zum Sync-Trigger; `aria-expanded`/`aria-controls` gesetzt.
- `apps/web/lib/db/repository.ts`: `readDeadLetters`, `retryDeadLetter`,
  `discardDeadLetter` (Dexie, transaktional); `getDeadLetters` bleibt als Alias.
- `apps/web/lib/db/types.ts`: optionale Felder `next_attempt_at`, `last_error`
  in `LocalOutboxRow`, damit Backoff/Fehlertext persistiert werden.
- `apps/web/lib/sync/worker.ts`: `syncNow({ dueOnly })`, Backoff-Filter,
  injizierbare Uhr wird an `replayOutbox` durchgereicht.
- `apps/web/lib/sync/status.ts` / `SyncProvider.tsx`: `deadLetterCount` im Status.

## Automatisierte Nachweise

| Prüfung              | Kommando                                            | Ergebnis                             |
| -------------------- | --------------------------------------------------- | ------------------------------------ |
| Typecheck            | `pnpm typecheck`                                    | grün (core + web)                    |
| Unit-Tests           | `pnpm test`                                         | 280/280 grün                         |
| Lint/Format          | `pnpm lint`                                         | grün                                 |
| E2E Desktop + Mobile | `pnpm exec playwright test e2e/dead-letter.spec.ts` | 4/4 grün (chromium, mobile-chromium) |

Neue Unit-Tests:

- `apps/web/lib/db/repository.test.ts`: Retry reiht mit `attempts = 0` und ohne
  `next_attempt_at`/`last_error` wieder ein; Discard entfernt dauerhaft;
  unbekannte IDs liefern `false`.
- `apps/web/lib/sync/worker.test.ts`: automatischer Lauf überspringt Einträge im
  Backoff; manueller Trigger versucht sofort.

Neue E2E-Tests (`apps/web/e2e/dead-letter.spec.ts`):

1. Badge öffnet Panel, „Erneut versuchen“ synchronisiert den Eintrag.
2. „Verwerfen“ entfernt den Eintrag dauerhaft; Badge meldet „Synchronisiert“.

## Gefundene und behobene Fehler

1. **Backoff war im Web-Layer wirkungslos**: `rowToOutboxEntry` verwarf
   `next_attempt_at`/`last_error`, dadurch wurde bei jedem 30-s-Tick sofort
   erneut gesendet. Persistenz + `dueOnly`-Filter ergänzt.
2. **Worker reichte die injizierte Uhr nicht weiter**: `replayOutbox` nutzte
   `Date.now()`, während `saveReplayResult` die Testuhr verwendete →
   `next_attempt_at` und `failed_at` liefen auseinander. `now: () => now`
   übergeben.
3. **Mobile-Klick wurde abgefangen**: Das Panel wurde im Header (Stacking-
   Context, `z-index: 10`) gerendert und lag damit unter der fixen Add-Leiste
   (`z-index: 20`); deren „+“-Button fing alle Klicks auf „Verwerfen“ ab.
   Lösung: `createPortal` an `document.body`.

## Manuelle Stichprobe

- 360 px Breite: Sheet nutzt volle Breite, Aktionen in einer Reihe, keine
  horizontale Scrollbar; „Verwerfen“ bleibt mit dem Daumen erreichbar.
- Leerer Zustand zeigt „Keine fehlgeschlagenen Einträge“.

## QA-Stichprobe Welle 4 (2026-10-26, `t_12d2f78d`)

Der Arbeitsstand wurde von QA im Gesamtkontext der Welle 4 nachgeprüft
(Qualitätsgates + vollständige E2E-Suite, Arbeitsbaum inkl. dieser Änderungen):

```text
pnpm lint       -> exit 0 (ESLint + Prettier)
pnpm typecheck  -> exit 0 (packages/core + apps/web)
pnpm test       -> 24 Dateien, 280/280 Tests grün
pnpm build      -> exit 0 (14/14 statische Seiten)
pnpm test:e2e   -> 68/68 Tests grün (5,4 min; chromium + mobile-chromium)
                   inkl. dead-letter.spec.ts 4/4, offline 4/4, pwa 6/6, a11y 12/12
```

Backoff-Abdeckung: Im `describe('Backoff-Policy (T4.3a)')` in
`packages/core/src/outbox.test.ts` liegen **14 `it`-Blöcke** (Sequenz, Jitter,
Deckel, ungültige Eingaben, `next_attempt_at`, Dead-Letter nach 5 Versuchen).
Zusätzlich decken die neuen Worker-Tests „überspringt beim automatischen Lauf
Einträge mit laufendem Backoff“ und „versucht bei manuellem Trigger sofort“
die AK-geforderte Unterscheidung ab. Die E2E-Tests prüfen Fehlertext
(„Injected failure“), Retry, Verwerfen, leeren Zustand und Statuswechsel.

Befund: Der Arbeitsstand lag beim Start der Abnahme uncommittet im Baum und die
PLAN-Checkbox T4.3 war offen (D15). Beides ist mit dem Abnahme-Commit behoben.
