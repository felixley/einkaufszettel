# PERF – Lasttest Sync (T5.2)

Lasttest des Sync-Stacks nach **PLAN.md T5.2**: 10 Haushalte × 5 gleichzeitige
Nutzer (50 VUs), Ziel-p95 der Sync-Latenz **< 1 s**, Fehlerrate **< 1 %**.

- Skript: [`../perf/k6-sync.js`](../perf/k6-sync.js)
- Anleitung/Parameter: [`../perf/README.md`](../perf/README.md)

## 1. Kurzfazit

| Lauf                                 | VUs | p50      | p95         | p99        | RPS   | Fehlerrate | p95 < 1 s |
| ------------------------------------ | --- | -------- | ----------- | ---------- | ----- | ---------- | --------- |
| **Produktions-Build** (`next start`) | 50  | 2,31 ms  | **92,3 ms** | 191,0 ms   | 244,1 | 0,00 %     | ✅        |
| Turbopack-Dev-Server (`next dev`)    | 50  | 552,8 ms | 1 127,5 ms  | 1 650,9 ms | 57,7  | 0,00 %     | ❌        |

Gegen den **Produktions-Build** sind alle Schwellen grün: **p95 ≈ 92 ms**,
**0 % Fehler**. Der **Dev-Server** überschreitet die p95-Schwelle (1,13 s) —
Ursache ist die Turbopack-Dev-Toolchain im Request-Pfad, nicht die Sync-Logik
(siehe §5). Für belastbare Zahlen ist daher gegen `next start` zu messen.

## 2. Methodik

- **Werkzeug:** k6 v2.3.0 (linux/amd64).
- **System under Test:** Mock-Sync-Stack (T4.2a, In-Memory) über die
  Next.js-Route `apps/web/app/api/mock/sync`, aktiv im Mock-Modus
  (`NEXT_PUBLIC_AUTH_MOCK=true`, keine Supabase-URL).
- **Lastmodell:** zwei `ramping-vus`-Szenarien, die sich 50 VUs teilen:

  | Szenario      | Last                                                     | Profil (Default)                  | Peak   |
  | ------------- | -------------------------------------------------------- | --------------------------------- | ------ |
  | `sync_outbox` | Outbox-Pfad: GET-Polling (`?since=cursor`) + POST-Upsert | 0→30 (20 s), 30 (60 s), →0 (10 s) | 30 VUs |
  | `add_to_list` | `add_to_list`-RPC + `request_id`-Replay                  | 0→20 (20 s), 20 (60 s), →0 (10 s) | 20 VUs |

- **Nutzer-/Haushaltsmodell:** deterministisch aus `__VU` abgeleitet —
  Haushalt `((VU-1) mod 10) + 1`, Sitz `floor((VU-1)/10)`. Damit bilden die
  50 VUs exakt 10 Haushalte × 5 Sitze ab. Jeder Haushalt nutzt einen eigenen
  Sync-Scope (`perf-h01`…`perf-h10`).
- **Idempotenz:** Jede `add_to_list`-Anfrage trägt eine `request_id`; im
  Szenario wird sie **unmittelbar wiederholt** (Replay). Gemessen wird die
  Rate `add_to_list_idempotency_ok` (Replay liefert `duplicate: true`, also
  keine zweite Aufaddierung). Zusätzlich prüft `setup()` die Idempotenz
  funktional vor dem Lauf (gleiche `request_id` → `duplicate: true`, sonst
  bricht der Lauf ab).
- **Vorbereitung:** `setup()` leert vor dem Lauf alle Perf-Scopes (DELETE),
  damit kein Altbestand die Messung verfälscht.
- **Schwellen:** `http_req_duration{p(95)} < 1000 ms` (global und je Szenario),
  `http_req_failed < 1 %`, `checks > 99 %`, `add_to_list_idempotency_ok > 99 %`.

### Umgebung des Messlaufs

| Punkt           | Wert                                                        |
| --------------- | ----------------------------------------------------------- |
| Host            | Linux 6.8.0 (x86_64), Container                             |
| Node.js         | v26.7.0                                                     |
| Next.js         | 16.4.3 (Produktions-Build, `next build` + `next start`)     |
| k6              | v2.3.0                                                      |
| Last-Runner/SUT | **auf demselben Host** (co-located, siehe Einschränkung §5) |
| Laufdauer       | 1 m 30 s (20 s Ramp-up + 60 s Last + 10 s Ramp-down)        |

## 3. Exaktes Kommando

```bash
# 1) Produktions-Build + Server (Repo-Root)
cd apps/web
NEXT_PUBLIC_AUTH_MOCK=true ./node_modules/.bin/next build
NEXT_PUBLIC_AUTH_MOCK=true ./node_modules/.bin/next start -p 3102

# 2) Lasttest (50 VUs = 30 sync + 20 add_to_list)
k6 run -e BASE_URL=http://localhost:3102 \
  --summary-export=perf/results/summary.json \
  perf/k6-sync.js
```

> **Hinweis `output: standalone`:** Für den hier gemessenen Lauf wurde
> `next start -p 3102` verwendet (funktioniert, Next warnt jedoch). Für einen
> echten Produktionshost ist die kanonische Variante
> `node .next/standalone/apps/web/server.js` mit `PORT`/`HOSTNAME`. Beide laden
> denselben Build und dieselbe Mock-Route.

Referenzlauf gegen den Dev-Server:

```bash
cd apps/web && NEXT_PUBLIC_AUTH_MOCK=true ./node_modules/.bin/next dev -p 3210
k6 run -e BASE_URL=http://localhost:3210 --summary-export=perf/results/summary-dev.json perf/k6-sync.js
```

## 4. Messwerte

### 4.1 Hauptlauf – Produktions-Build (`http://localhost:3102`)

Rohdaten: `perf/results/summary-20261026T130821.json`,
Log: `perf/results/run-20261026T130821.log`. Ergebnis: **`RUN_EXIT=0`**
(alle Schwellen grün).

| Metrik                           | Wert                           |
| -------------------------------- | ------------------------------ |
| VUs (max)                        | 50                             |
| Requests (gesamt)                | 22 023                         |
| Durchsatz                        | **244,1 req/s**                |
| Fehlerrate (`http_req_failed`)   | **0,00 %** (0 / 22 023)        |
| Checks                           | 44 020 / 44 020 = **100 %**    |
| `add_to_list`-Upserts angewendet | 6 602                          |
| Idempotente Replays              | 4 403 (100 % `duplicate:true`) |
| Daten gesendet / empfangen       | 6,66 MB / 37,14 MB             |

**Latenz `http_req_duration` (ms):**

| Scope                        | avg   | p50  | p90   | p95       | p99    | max    |
| ---------------------------- | ----- | ---- | ----- | --------- | ------ | ------ |
| global                       | 18,27 | 2,31 | 55,96 | **92,30** | 191,05 | 818,18 |
| `flow:sync` (Polling+Upsert) | 18,13 | 2,19 | 56,21 | 92,94     | 187,65 | 798,01 |
| `flow:add_to_list`           | 18,48 | 2,44 | 55,60 | 91,64     | 198,36 | 818,18 |

**Iterationsdauer:** avg 340,5 ms · p90 499,3 ms · p95 554,9 ms · p99 700,4 ms
· max 1 462,9 ms.

**Polling-Umfang** (`sync_poll_rows`, Zeilen je GET): avg 4,13 · p95 6 · max 11
— der jeweilige `since`-Cursor greift, es wird nicht der komplette Bestand
geladen.

### 4.2 Referenzlauf – Turbopack-Dev-Server (`http://localhost:3210`)

Rohdaten: `perf/results/summary-20261026T130536.json`,
Log: `perf/results/run-20261026T130536.log`. Ergebnis: **`RUN_EXIT=99`** —
die p95-Schwelle wurde gerissen (erwartet, siehe §5).

| Metrik            | Wert                    |
| ----------------- | ----------------------- |
| VUs (max)         | 50                      |
| Requests (gesamt) | 5 229                   |
| Durchsatz         | 57,7 req/s              |
| Fehlerrate        | 0,00 % (0 / 5 229)      |
| Checks            | 10 432 / 10 432 = 100 % |

| Latenz (ms)        | avg    | p50    | p90    | p95          | p99      | max      |
| ------------------ | ------ | ------ | ------ | ------------ | -------- | -------- |
| global             | 567,22 | 552,82 | 972,68 | **1 127,54** | 1 650,95 | 1 859,37 |
| `flow:sync`        | 571,01 | 557,84 | 972,01 | 1 127,58     | 1 655,84 | 1 835,95 |
| `flow:add_to_list` | 565,03 | 548,13 | 973,66 | 1 096,35     | 1 615,36 | 1 859,37 |

## 5. Interpretation & Engpässe

1. **Die Sync-Logik selbst ist schnell.** Im Produktions-Build liegen p50 bei
   2,3 ms und p95 bei 92 ms — die Schwellen werden mit ~10× Reserve gehalten.
   Die Mock-Routen lösen pro Request nur eine In-Memory-Map-Operation plus
   Aggregator auf; die reale Latenz dominiert die Laufzeit des Node-Prozesses,
   nicht die Fachlogik.
2. **Der Dev-Server ist der Engpass, nicht die App.** Der identische Lauf
   gegen den Turbopack-Dev-Server zeigt p50 552 ms / p95 1 128 ms — rund 12×
   langsamer. Ursache ist die Dev-Toolchain (Request-Kompilierung/HMR-Overhead)
   im Request-Pfad. **Konsequenz:** Lasttests und die p95-Abnahme müssen gegen
   `next build` + `next start` (oder den produktiven Docker-Stack) laufen; ein
   Dev-Server ist als Performance-Maßstab unbrauchbar.
3. **Kein Fehlerbild unter Last.** In beiden Läufen 0 % Fehler und 100 %
   Checks — weder Timeouts noch 5xx noch Sync-Konflikte. Der Replay-Pfad ist
   stabil idempotent (4 403 Replays, 0 Doppelaufaddierungen).
4. **Co-Located-Messung.** k6 und das SUT liefen auf **demselben Host**.
   Dadurch teilen sich Erzeuger und Prüfling CPU/Kernel; die absoluten Werte
   sind eher **konservativ** (echte Trennung Client/Server kann niedrigere
   Latenzen zeigen) — die p95-Reserve ist so groß, dass das Fazit stabil bleibt.
5. **Polling-Volumen wächst mit dem Bestand.** `sync_poll_rows` steigt mit der
   Zahl aktiver Zeilen; abgelaufene Tombstones in `list_items` werden weiter
   mitgeliefert. Bei langen Listen ist eine serverseitige Filterung der
   Tombstones bzw. eine kompaktere Cursor-Paginierung zu prüfen.

### Optimierungshinweise

- **Für Abnahmen/CI:** Immer den Produktions-Build messen; niemals den
  Dev-Server als Referenz heranziehen (§5.2).
- **Nächster realer Prüfpunkt:** derselbe Lauf gegen den Docker-Stack mit
  **echtem Postgres/PostgREST/GoTrue** (siehe §6). Dort wandern die
  In-Memory-Operationen in Netzwerk + DB; mit deutlich höheren p95-Werten ist
  zu rechnen. Sinnvolle Vorbereitung: DB-Indizes auf `list_id`,
  `updated_at` (Cursor), `deleted_at`.
- **Lastverteilung:** Für > 50 VUs eine horizontale Skalierung und einen
  Connection-Pool prüfen; `add_to_list` ist die einzige Schreib-RPC mit
  Aggregat-Lesen und damit der erste Kandidat für einen Engpass.

## 6. Reproduktion auf Docker-/Supabase-Host (offener Nachweis, D14)

Dieser Lauf misst den **Mock-Sync** — also die Sync-Verträge/Laufzeit der App,
**nicht** die Datenbank. Der Lauf gegen den echten Stack (self-hosted Supabase
aus `docker-compose.yml` + Caddy) bleibt, wie bei T4.2a (`D14`), **offen**.
Schritte für den Nachweis auf dem Zielhost:

1. `cp .env.example .env` und Secrets erzeugen
   (`node scripts/generate-supabase-keys.mjs`), `NEXT_PUBLIC_AUTH_MOCK` **nicht**
   setzen (echter Auth-Modus).
2. `docker compose up -d` (Postgres/GoTrue/PostgREST + Caddy), Migrationen aus
   `supabase/` einspielen, App-Build deployen.
3. Nicht `https://… /api/mock/sync`, sondern die **echten** Sync-Endpunkte
   (PostgREST/Tabelle `list_items`) lasten. Das k6-Skript nutzt dafür dasselbe
   VU-/Szenario-Modell; die Request-Bodies sind an die jeweilige API
   anzupassen.
4. Ergebnis mit `--summary-export` erneut hier eintragen und die
   p95/p99-Zahlen gegen die Schwellen aus §2 stellen.

**Status:** Mock-Sync grün (Produktions-Build), echter DB-Stack offen (D14).

## 7. Akzeptanzkriterien T5.2

| AK                                              | Status                                  |
| ----------------------------------------------- | --------------------------------------- |
| k6-Skript vorhanden, `k6 inspect` grün          | ✅ (§3, `k6 inspect` Exit 0)            |
| Lauf mit 50 VUs: p95 < 1 s, Fehlerrate < 1 %    | ✅ Produktions-Build (p95 92,3 ms, 0 %) |
| Engpass-/Optimierungshinweise in `docs/PERF.md` | ✅ §5                                   |
| PLAN-Checkbox T5.2 getickt                      | ✅                                      |
