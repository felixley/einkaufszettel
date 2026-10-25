# REVIEW — QA-Abnahme Welle 1 (T1.1–T1.7)

- **Grundlage:** `PLAN.md` §5 (Stand `00f656c`), `docs/HANDOFF.md`, Re-Scope-Kommentare der Karten.
- **Geprüfter Stand:** `master` @ `00f656c` (Arbeitsbaum sauber).
- **Umgebung:** Sandbox ohne Docker-Daemon und ohne `supabase`-CLI; Node 26.7.0, pnpm 9.15.4 via `npx`.
  Ersatzweise Vanilla PostgreSQL 16.2 + Supabase-Kompatibilitäts-Shim (Rollen `anon`/`authenticated`/`service_role`, `auth`-Schema, `auth.uid()`) und pgTAP als plain SQL. Docker-Compose-Plugin fehlte; für den statischen Check wurde das Standalone-Binary `docker-compose v2.29.7` verwendet.
- **Rollen:** QA prüft gegen AK/DoD, nicht gegen Produktentscheidungen. Kein Produktivcode geändert; nur diese Datei geschrieben.

## 1. Prüfumfang

| Aufgabe | Prüfgegenstand                                                                  | Geprüft                                                    |
| ------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| T1.1    | Monorepo/Tooling, frischer Checkout: `pnpm lint && pnpm typecheck && pnpm test` | ja, auf frischem Clone                                     |
| T1.2    | GitHub Actions CI, YAML lokal via `actionlint`, Pipeline grün                   | ja, lokal + GitHub-API                                     |
| T1.3    | Compose-Stack (db/auth/rest/web/caddy), HTTPS/ipv64-DNS-01, `/health`           | teilweise (Config/Images statisch; Laufzeit nicht möglich) |
| T1.4    | Migrationen, Trigger, Indizes, RLS; pgTAP-Rollenfälle                           | ja, vollständig ausgeführt                                 |
| T1.5    | Seed: 13 Kategorien, >0 Regeln, idempotent; `supabase db reset`                 | ja, Seed ausgeführt; `db reset` nicht möglich              |
| T1.6    | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/wireframes.md`               | ja, Datei-/Inhaltsprüfung                                  |
| T1.7    | README ≤5 Schritte, `.env.example`, `scripts/backup.sh` (Exit 0, >0 Byte)       | ja, Backup real gegen PG ausgeführt                        |

**Nicht prüfbar in dieser Umgebung:** `docker compose up --build`, Caddy-Image-Build (`xcaddy`), gültiges Let's-Encrypt-Zertifikat, HTTPS-Erreichbarkeit, Renewal-Dry-Run, Backup gegen den Compose-DB-Container. Ursache: kein Docker-Daemon (`Cannot connect to the Docker daemon at unix:///var/run/docker.sock`). Das ist eine Umgebungs-, keine Implementierungsgrenze; der Nachweis muss auf einem Docker-Host nachgeholt werden.

## 2. Durchgeführte Tests mit echtem Output

### T1.1 — Monorepo + Tooling (frischer Checkout)

```text
$ git clone /opt/data/workspace/einkaufszettel /tmp/fresh && npx pnpm@9.15.4 install --frozen-lockfile
...
. prepare$ husky
. prepare: Done
Done in 17.6s

$ pnpm lint
> eslint . && prettier --check "**/*.{js,mjs,cjs,ts,mts,cts,json,yml,yaml}"
Checking formatting...
All matched files use Prettier code style!

$ pnpm typecheck
> tsc --noEmit -p tsconfig.json && pnpm -r --if-present typecheck
Scope: 2 of 3 workspace projects
apps/web typecheck: Done

$ pnpm test
 ✓ tooling/smoke.test.ts (1 test) 3ms
 Test Files  1 passed (1)
      Tests  1 passed (1)

$ pnpm build
apps/web build: Route (app)
┌ ○ /
├ ○ /_not-found
└ ƒ /health
Done
```

Ergebnis: alle vier Gates **exit 0** auf frischem Checkout. Husky ist im Clone aktiv (`core.hooksPath=.husky/_`, `h` + `pre-commit` vorhanden; `pre-commit` mit Modus 100755 im Git). Kein Fach-/Produktcode: `apps/web` enthält nur Platzhalter-`page.tsx` und `/health`, `packages/core` ist ein leeres Paket — zulässig als Infrastruktur-Gerüst.

### T1.2 — CI

```text
$ actionlint -no-color .github/workflows/ci.yml
ACTIONLINT_EXIT=0

$ curl -s .../actions/runs/40182149307
"head_branch": "master"
"head_sha": "cd95b4d18d6f438983fef47382a5a4d08898fd5f"
"status": "completed"
"conclusion": "success"

$ curl -s .../actions/runs?per_page=5
run 40187777526: head_sha 00f656c…, conclusion success
```

Workflow triggert `master` und `main`; im Repo existiert nur `master`. `PLAN.md` nennt „main“, `HANDOFF.md` „master“ — die Pipeline ist auf dem tatsächlichen Default-Branch grün. Keine Deploy-Schritte, `permissions: contents: read`, pnpm-Cache vorhanden. Kosmetisch veraltet: der Kommentar „Build ist derzeit ein No-op“ — `apps/web` hat inzwischen ein Build-Script; der Build-Schritt läuft real.

### T1.3 — Docker Compose + HTTPS

```text
$ docker-compose -f docker-compose.yml config -q
COMPOSE_CONFIG_EXIT=0
$ docker-compose -f docker-compose.yml config --services
db
auth
rest
web
caddy

Docker Hub Tag-Checks:
supabase/postgres:15.19.0.007 -> HTTP 200
supabase/gotrue:v2.197.0      -> HTTP 200
postgrest/postgrest:v16.5     -> HTTP 200
library/caddy:2.11.7          -> HTTP 200
library/caddy:2.11.7-builder  -> HTTP 200

$ docker info
Server:
ERROR: Cannot connect to the Docker daemon at unix:///var/run/docker.sock.

$ cd apps/web/.next/standalone && PORT=3100 node apps/web/server.js  (im Hintergrund)
$ curl -sS -w '\nHTTP %{http_code}\n' http://127.0.0.1:3100/health
{"status":"ok"}
HTTP 200
$ curl -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3100/
HTTP 200
```

Positiv: Compose-Datei syntaktisch/semantisch gültig, fünf Dienste, alle verwendeten Image-Tags existieren auf Docker Hub, Healthchecks definiert, Caddyfile entspricht Variante A (`tls { dns lego_deprecated ipv64 }`), Entscheidung A/B in `docs/DECISIONS.md` dokumentiert. Der Next.js-Standalone-Server liefert `/health` mit 200 und `/` mit 200 — aber außerhalb von Docker/Compose/Caddy.

Nicht nachgewiesen: `docker compose up --build`, Caddy-Build mit dem gepinnten Modul, Zertifikatsausstellung, `https://<domain>/health`, Renewal. Damit ist das zentrale AK dieser Aufgabe („App … mit gültigem Zertifikat erreichbar“) **nicht belegt**.

### T1.4 — Migrationen/RLS

```text
$ bash run_verify.sh   (frische DB, bootstrap + Migration 001 + 002 + Seed + pgTAP)
...
 finish
--------
 1..45
(1 row)
--> exit=0
```

Zusätzliche direkte Prüfung der aufgebauten DB:

```text
select relname, relrowsecurity from pg_class ... (public, relkind='r'):
categories t | category_rules t | household_members t | households t | invites t
list_items t | lists t | profiles t | recipe_ingredients t | recipes t   (10 Tabellen)

policies=40
triggers=19
households.id -> Spaltendefault: (leer), is_nullable=NO
UUIDv7-Check vorhanden: substring(id::text from 15 for 1) = '7'
Physisches DELETE wird vom Trigger blockiert (Test 45 ok)
```

pgTAP deckt die geforderten Rollenfälle ab: Nichtmitglied sieht nichts (Tests 31–34, 41), Viewer schreibt nicht (28–30), Editor ändert Items (21–22), nur Owner verwaltet Mitglieder (18–19, 42–44). Zusätzlich Soft-Delete (37–38), Bootstrap (43) und Trigger-Sperre (45).

### T1.5 — Seed

```text
kategorien_global=13
keyword_regeln=389
einheiten=13
nach_2._lauf_kategorien=13
nach_2._lauf_regeln=389
```

Seed läuft fehlerfrei (`ON_ERROR_STOP=1`, exit 0) und ist idempotent. **Aber:** `supabase/config.toml` fehlt; `docker-compose.yml` mountet nur `./supabase/migrations` nach `/docker-entrypoint-initdb.d` — `supabase/seed.sql` wird beim Stack-Start nicht eingespielt. `supabase db reset` ist ohne `config.toml` nicht ausführbar (CLI verweigert ohne Projektkonfiguration). Damit ist das wörtliche AK („`supabase db reset` liefert lauffähige Basisdaten“) nicht erfüllt; nach `docker compose up` enthält eine frische DB 0 Kategorien/0 Regeln. Reproduktion siehe Defekt D1.

### T1.6 — Architektur/Entscheidungen/Wireframes

```text
$ ls docs/
BACKLOG.md  DECISIONS.md  HANDOFF.md  REVIEW.md  wireframes.md
# ARCHITECTURE.md fehlt
```

`docs/DECISIONS.md` vorhanden (2 Einträge: Caddy Variante A/B; PG-Shim-Verifikation — je Datum, Begründung, Alternative, Risiko/Status). `docs/wireframes.md` vorhanden: drei ASCII-Skizzen (Liste, Rezept/Portionsrechner, Import-Vorschau), beschriftete Kerninteraktionen, Tap-Bilanz, Zustände und offene PO-Punkte — inhaltlich für Human Gate 1 vorzeigbar. `docs/ARCHITECTURE.md` fehlt vollständig; das AK aus T1.6a („Beide Dateien existieren … keine Widersprüche zu PLAN.md“) ist damit nicht erfüllt. `PLAN.md`-Checkbox T1.6 ist nicht abgehakt. Reproduktion siehe Defekt D2.

### T1.7 — Setup-Doku + Backup

```text
$ ls -l backups/
-rw-r--r-- 1 hermes hermes 9578 ... einkaufszettel-20261025T112706Z.sql.gz
$ gzip -t backups/einkaufszettel-...sql.gz && echo GZIP_OK
GZIP_OK
$ stat -c '%s bytes' backups/einkaufszettel-...sql.gz
9578 bytes

$ node scripts/generate-supabase-keys.mjs
JWT_SECRET=…(redacted)
ANON_KEY=…(redacted)
SERVICE_ROLE_KEY=…(redacted)
# 3 JWT-Segmente je Wert, Exit 0
```

Das Backup-Skript wurde **real** gegen eine frische PG-Datenbank (qa_backup_verify_8c46ba0e, Migrationen+Seed eingespielt) ausgeführt: Exit 0, gzip-valid, 9578 Byte. `backups/` ist gitignored, Cron-Beispiel vorhanden, README hat 5 nummerierte Schritte, `.env.example` enthält alle Variablen inkl. Secret-Hygiene. Nicht nachgewiesen: der Start eines frischen Checkouts nach README (hängt an T1.3/Docker) und der Compose-Zweig des Backup-Skripts (`docker compose exec -T db pg_dump`).

## 3. Befunde / Defekte

### D1 — [kritisch] Seed wird im Compose-Stack nicht eingespielt; `supabase db reset` nicht möglich (T1.5)

- **Ist:** `supabase/config.toml` fehlt; `docker-compose.yml` bindet nur `./supabase/migrations` ein. `supabase db reset` ist ohne Projektkonfiguration nicht lauffähig. Nach `docker compose up` ist `public.categories` leer (0 statt 13).
- **Soll:** `supabase db reset` liefert 13 Kategorien und >0 Regeln; ein frischer Stack startet mit Basisdaten.
- **Reproduktion:**
  1. `cd /opt/data/workspace/einkaufszettel`
  2. `ls supabase/config.toml` → _No such file or directory_
  3. `grep -n 'docker-entrypoint-initdb.d' docker-compose.yml` → nur `./supabase/migrations`
  4. Auf Docker-Host: `docker compose up -d --build`; danach `select count(*) from categories;` → 0
  5. `supabase db reset` → Abbruch wegen fehlender `config.toml`
- **Fix-Vorschlag:** `supabase/config.toml` mit Projekt-ID und `[db.seed] enabled = true, sql_paths = ["./seed.sql"]` anlegen; zusätzlich `./supabase/seed.sql:/docker-entrypoint-initdb.d/zz_seed.sql:ro` mounten (alphabetisch nach den Migrationen) **oder** einen dokumentierten Seed-Schritt in README/Skript ergänzen. Auf Docker-Host `supabase db reset` + Zählabfrage nachweisen.

### D2 — [kritisch] `docs/ARCHITECTURE.md` fehlt (T1.6a)

- **Ist:** Datei nicht vorhanden; `PLAN.md`-Checkbox T1.6 offen. `DECISIONS.md` und `wireframes.md` sind vorhanden.
- **Soll:** `docs/ARCHITECTURE.md` existiert, verweist auf `PLAN.md` §4 (Datenmodell, Sync/LWW, Einheiten, Kategorien, Sicherheit/RLS) und widerspricht dem Plan nicht.
- **Reproduktion:** `ls docs/ARCHITECTURE.md` → _No such file or directory_; `grep -n 'T1.6' PLAN.md` → `- [ ]`.
- **Fix-Vorschlag:** `docs/ARCHITECTURE.md` anlegen (Datenmodell §4.1, Sync/Outbox/LWW §4.2, Einheiten-Taxonomie §4.3, Kategorien §4.4, RLS/Invite-Sicherheit §4.5, Komponenten/Deployment), Checkbox T1.6 abhaken. T1.6b (Wireframes) ist bereits erfüllt.

### D3 — [hoch] Laufzeitnachweis für T1.3 fehlt

- **Ist:** `docker compose config` grün, Image-Tags existieren, Caddyfile Variante A plausibel. Aber kein `docker compose up --build`, kein Caddy-Build, kein gültiges Zertifikat, kein HTTPS-`/health`-Nachweis (Docker-Daemon fehlt). Das AK verlangt genau diesen Nachweis.
- **Soll:** Auf einem Docker-Host: `docker compose up -d --build`; `docker compose ps` (web healthy); `curl -fsS https://<domain>/health` → `{"status":"ok"}`; Zertifikatsaussteller/Validity prüfen; Renewal-Dry-Run (`caddy reload` bzw. `lego renew --dry-run`) dokumentieren. PO-Entscheidung zu Platzhaltern (Domain/IP) ist dokumentiert — Zertifikatstest bleibt bis echte Werte offen.
- **Reproduktion:** In der Sandbox `docker compose up` → `Cannot connect to the Docker daemon`.
- **Kein Implementierungsfehler nachweisbar**, aber das AK ist ohne Host-Lauf nicht erfüllt. Nicht als „bestanden“ wertbar.

### D4 — [mittel] Kein Seed-Mount / Dev-Experience (Teil von D1)

- **Ist:** README sagt „Migrationen werden beim ersten DB-Start … eingespielt“ — Seed fehlt. Ein frischer `docker compose up` liefert eine leere Kategorien-/Regelbasis; Auto-Kategorisierung und Listen-UI hätten keine Basisdaten.
- **Soll:** Nach README-Start sind 13 Kategorien und Regeln vorhanden.
- **Fix:** siehe D1 (Seed-Mount + README-Schritt).

### D5 — [niedrig] DoD-Verstoß: Checkboxen nicht abgehakt

- **Ist:** `PLAN.md` Checkboxen T1.1, T1.2, T1.3, T1.6, T1.7 sind `[ ]`, obwohl T1.1/T1.2 substanziell erfüllt sind; T1.4/T1.5 sind `[x]`.
- **Soll:** `PLAN.md` §0.2 DoD: Checkbox je Aufgabe abgehakt.
- **Reproduktion:** `grep -n 'T1\.[1-7]' PLAN.md` → Zeilen 92–103.
- **Fix:** Checkboxen nach Nachweis abhaken (T1.3/T1.6 erst nach D2/D3).

### D6 — [Info] `main` vs. `master`

- `PLAN.md` AK T1.2 nennt „Pipeline grün auf `main`“, im Repo existiert nur `master`; `HANDOFF.md` nennt `master`, Workflow deckt beide ab. Kein Defekt, aber Doku-Abweichung; empfehlenswert `PLAN.md` auf `master` zu korrigieren.

## 4. Human-Gate-1-Checkliste

| Prüfpunkt                     | Befund                                                                                                                                                                                                       | Freigabe?                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **Schema** (Datenmodell §4.1) | 10 Tabellen, 18 Indizes, 19 Trigger, UUIDv7-Checks ohne DB-Default, `updated_at`-Trigger, Soft-Delete-Sperre; pgTAP 45/45 grün. Seed-Zählung 13/389/13 idempotent.                                           | **ja, mit Auflage D1** (Seed im Stack nachweisen) |
| **RLS-Konzept** (§4.5)        | 40 Policies (10 Tabellen × 4 Operationen), RLS auf allen 10 Tabellen aktiv; Rollenfälle per pgTAP belegt. Aber: kein `ARCHITECTURE.md`-Konzeptdokument; RLS-Begründung nur in Migration/DECISIONS verstreut. | **nein, bis D2 behoben**                          |
| **Wireframes** (T1.6b)        | Drei Low-Fi-Skizzen (Liste, Rezept/Portionsrechner, Import-Vorschau), Kerninteraktionen beschriftet (Hinzufügen ≤2 Taps, Abhaken 1 Tap), Zustände, Tap-Bilanz, offene PO-Punkte.                             | **ja**                                            |

## 5. Urteil je Aufgabe

| Aufgabe  | Urteil              | Begründung (knapp)                                                                                                                                                                                |
| -------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1.1** | **bestanden**       | Frischer Clone: install 17.6 s; lint/typecheck/test/build alle exit 0; Husky aktiv. DoD-Checkbox offen (D5).                                                                                      |
| **T1.2** | **bestanden**       | `actionlint` exit 0; GitHub-Runs 40182149307 (cd95b4d) und 40187777526 (00f656c) `conclusion: success`. DoD-Checkbox offen (D5).                                                                  |
| **T1.3** | **nicht bestanden** | Config/Images/Caddyfile statisch ok, aber `docker compose up`, Caddy-Build, gültiges Zertifikat und HTTPS-`/health` sind nicht nachgewiesen (D3).                                                 |
| **T1.4** | **bestanden**       | pgTAP 45/45, RLS auf 10 Tabellen, 40 Policies, 19 Trigger, UUIDv7/Soft-Delete belegt.                                                                                                             |
| **T1.5** | **nicht bestanden** | Seed selbst grün/idempotent (13/389/13), aber `supabase db reset` fehlt `config.toml`; Compose mountet `seed.sql` nicht → AK wörtlich nicht erfüllt (D1/D4).                                      |
| **T1.6** | **nicht bestanden** | `ARCHITECTURE.md` fehlt; T1.6b Wireframes und `DECISIONS.md` sind dagegen erfüllt (D2).                                                                                                           |
| **T1.7** | **bestanden**       | Backup real: Exit 0, gzip-valid, 9578 Byte; README 5 Schritte, `.env.example`, Cron-Beispiel, `backups/` gitignored. Startpfad nur statisch geprüft (abhängig von T1.3); DoD-Checkbox offen (D5). |

## 6. Gesamturteil

**nicht bestanden.**

Phase 1 ist technisch breit aufgestellt — T1.1, T1.2, T1.4 und T1.7 sind substanziell erfüllt, T1.4 sogar mit starker pgTAP-Abdeckung. Für das Human Gate 1 fehlen jedoch drei Pflichtnachweise: (1) der Laufzeitnachweis des Compose-/HTTPS-Stacks (T1.3), (2) ein funktionierender Seed-/Reset-Pfad im Stack (T1.5) und (3) das Architektur-/RLS-Konzeptdokument (T1.6a). Solange diese offen sind, ist die Abnahme nicht möglich. Empfehlung: D1/D2 vor dem Human Gate beheben, T1.3 auf einem Docker-Host nachweisen, danach erneute QA-Abnahme.

## 7. Re-Abnahme nach D1/D2-Fixes (zweite Runde)

- **Grundlage:** Fix-Tasks `t_f7280c28` (D1/D4: `supabase/config.toml` + Seed-Mount) und `t_903a2a61` (D2/D5/D6: `ARCHITECTURE.md`, Checkboxen, `main`→`master`); Karte `t_c51e1f55`.
- **Geprüfter Stand:** `master` @ `f918ede` (Arbeitsbaum sauber; `f918ede` = D1/D4, `2ce3b5d` = D2/D5/D6).
- **Umgebung:** wie §1 (kein Docker-Daemon, keine `supabase`-CLI im PATH). Zusätzlich: portable PostgreSQL 16.2 + Supabase-Kompatibilitäts-Shim, `supabase` CLI 2.122.0, Standalone-`docker-compose` v5.6.1.
- **Rollen:** unabhängige QA; kein Produktivcode geändert. In dieser Runde nur `docs/REVIEW.md` ergänzt und die DoD-Checkbox T1.6 in `PLAN.md` nachgezogen.

### 7.1 Durchgeführte Prüfungen mit echtem Output

#### (1) Frische DB nach Migrationen + Seed (T1.5/D1)

```text
$ psql -h /tmp -p 55432 -U postgres -tAc "select version();"
PostgreSQL 16.2 on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 7.5.0-3ubuntu1~18.04) 7.5.0, 64-bit

$ psql ... -c "create database \"qa_reabnahme_1792929743\";"
CREATE DATABASE
$ psql ... -f bootstrap.sql
SHIM_OK
$ psql ... -f supabase/migrations/20261025_001_schema.sql   -> exit=0
$ psql ... -f supabase/migrations/20261025_002_rls.sql      -> exit=0
$ psql ... -f supabase/seed.sql                             -> exit=0

=== COUNTS ===
kategorien_global=13
keyword_regeln=389
einheiten=13

=== 2. Seed-Lauf (Idempotenz) ===
exit=0
nach_2._lauf_kategorien=13
nach_2._lauf_regeln=389

=== pgTAP 01_rls ===
1..45
ok-Tests: 45
not ok: 0
exit=0
```

Ergebnis: Eine **frische** Datenbank enthält nach Migrationen + Seed **13 globale Kategorien, 389 Keyword-Regeln und 13 Einheiten**; der zweite Seed-Lauf bleibt bei 13/389. pgTAP läuft **45/45 ok, 0 Fehler**. Die Kernbehauptung von D1 ist damit reproduziert.

#### (2) `config.toml` + Seed-Mount konsistent (D1/D4)

```text
$ cat supabase/config.toml
project_id = "einkaufszettel"

[db.seed]
enabled = true
sql_paths = ["./seed.sql"]

$ docker-compose -f docker-compose.yml config -q
exit=0
$ docker-compose -f docker-compose.yml config --services
db
auth
rest
web
caddy

$ docker-compose -f docker-compose.yml config | grep -A4 -B2 zz_seed
      - type: bind
        source: /opt/data/workspace/einkaufszettel/supabase/seed.sql
        target: /docker-entrypoint-initdb.d/zz_seed.sql
        read_only: true

$ supabase --version
2.122.0
$ supabase db reset
{"_tag":"Error","error":{"code":"LocalDbRunningError","message":"failed to inspect service: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"}}
```

Ergebnis: Beide Seed-Pfade zeigen auf **dieselbe** Datei `supabase/seed.sql`; das Mount-Ziel `zz_seed.sql` sortiert alphabetisch nach den Migrationen (`2…` < `z…`). Die CLI **parst** `config.toml` (2.122.0) und scheitert erst an der fehlenden Docker-Engine, nicht an der Konfiguration. Compose-Config ist gültig, fünf Dienste, Seed-Mount korrekt gerendert. Der Laufzeitbeweis (`docker compose up`, `supabase db reset`) bleibt hostabhängig (D3).

#### (3) `ARCHITECTURE.md` existiert, verweist auf PLAN §4, keine Widersprüche (D2)

```text
$ ls -l docs/
-rw-r--r-- 1 hermes hermes  6113 ... ARCHITECTURE.md
-rw-r--r-- 1 hermes hermes  4829 ... DECISIONS.md
-rw-r--r-- 1 hermes hermes 12241 ... wireframes.md
$ grep -n 'PLAN.md §4' docs/ARCHITECTURE.md
42:  ... (PLAN.md §4.2).
48:  ... Aggregator (PLAN.md §4.3), Kategorisierungsregeln
49:  ... (PLAN.md §4.4) ...
62:- **Datenhaltung:** Schema aus PLAN.md §4.1 (10 Tabellen inkl. profiles,
67:- **Sicherheit:** RLS auf allen Tabellen (PLAN.md §4.5) ...
74:  ... 13 Kategorien und Keyword-Regeln (PLAN.md §4.4).
```

Abgeglichen mit `PLAN.md` §4.1–4.5: 10 Tabellen mit denselben Namen, UUIDv7 clientseitig, `created_at`/`updated_at`/`deleted_at` + `updated_at`-Trigger, RLS auf allen Tabellen, Invite-Token nur als Hash, Rate-Limiting über Caddy, 13 Kategorien. **Keine Widersprüche** gefunden; die Aussage „Realtime erst Phase 2“ ist mit `PLAN.md` §5 (T2.5) konsistent. `wireframes.md` enthält weiterhin drei Skizzen inkl. Tap-Bilanz und offenen PO-Punkten.

#### (4) Checkboxen T1.1/T1.2/T1.6/T1.7 korrekt, T1.3 weiter offen (D5/D6)

```text
$ grep -n 'T1\.[1-7]' PLAN.md | sed -n '1,7p'
92:- [x] **T1.1** ...
93:- [x] **T1.2** ... *AK:* Pipeline grün auf `master`.
94:- [ ] **T1.3** ...
100:- [x] **T1.4** ...
101:- [x] **T1.5** ...
102:- [x] **T1.6** ...        # in dieser Runde nach Prüfung abgehakt
103:- [x] **T1.7** ...
```

T1.2 nennt jetzt `master`; der Workflow triggert `master` und `main`. T1.1/T1.2/T1.7 waren bereits korrekt. **T1.6 war nach dem Fix-Commit noch `[ ]`**, obwohl alle drei Dokumente vorlagen — in dieser Re-Abnahme nach inhaltlicher Prüfung auf `[x]` korrigiert. T1.3 bleibt bewusst offen (D3).

#### (5) Regressionsstichprobe T1.1/T1.2/T1.7

```text
$ pnpm lint       -> LINT_EXIT=0   (Prettier: All matched files use Prettier code style!)
$ pnpm typecheck  -> TC_EXIT=0     (Scope: 2 of 3 workspace projects; apps/web typecheck: Done)
$ pnpm test       -> TEST_EXIT=0   (1 Test File passed, 1 Test passed)
$ pnpm build      -> BUILD_EXIT=0  (Compiled successfully; Route / und /health)

GitHub check-runs:
2ce3b5d -> "Lint, Typecheck, Test, Build" completed success
f918ede -> "Lint, Typecheck, Test, Build" completed success

$ bash scripts/backup.sh   (gegen frische PG-DB, DATABASE_URL gesetzt)
Backup erstellt: .../einkaufszettel-20261025T120528Z.sql.gz
BACKUP_EXIT=0
GZIP_OK
55890 bytes
```

Keine Regression: Alle vier Gates exit 0, die CI ist auf beiden Fix-Commits grün, das Backup-Skript läuft real gegen eine frische DB (Exit 0, gzip-valid, 55.890 Byte).

### 7.2 Befunde der Re-Abnahme

- **D1/D4 — behoben.** `supabase/config.toml` vorhanden und von der CLI parsebar; `docker-compose.yml` mountet `supabase/seed.sql` als `zz_seed.sql`; frische DB liefert 13 Kategorien/389 Regeln. `supabase db reset` scheitert erst an der fehlenden Docker-Engine (Umgebung, kein Config-Fehler).
- **D2 — behoben.** `docs/ARCHITECTURE.md` existiert (6.113 Byte), verweist auf `PLAN.md` §4.1–4.5 und widerspricht dem Plan nicht. `DECISIONS.md` und `wireframes.md` vorhanden.
- **D5 — behoben, mit Nachzieher.** T1.1/T1.2/T1.7 waren bereits abgehakt; T1.6 war trotz vollständiger Dokumente noch offen und wurde in dieser Runde nach Prüfung abgehakt.
- **D6 — behoben.** `PLAN.md` T1.2 nennt jetzt `master`; Workflow deckt `main` und `master` ab.
- **D3 — weiter offen (Umgebung).** Kein Docker-Daemon in der Sandbox; `docker compose up`, Caddy-Build, Zertifikatsausstellung, HTTPS-`/health` und `supabase db reset` sind hier nicht ausführbar. Gemäß Aufgabenstellung ist D3 ein Docker-Host-Thema und **kein Gate-1-Blocker**, sondern ein offener Punkt.
- **D7 [niedrig] — Checkbox T1.6 nach Fix-Commit noch offen.** In dieser Re-Abnahme korrigiert; kein Produktivcode betroffen.

### 7.3 Urteil je Aufgabe (Re-Abnahme)

| Aufgabe  | Urteil                          | Begründung (knapp)                                                                                                                                                                  |
| -------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1.1** | **bestanden**                   | `pnpm lint/typecheck/test/build` je exit 0; CI grün.                                                                                                                                |
| **T1.2** | **bestanden**                   | Check-runs `2ce3b5d` und `f918ede`: „Lint, Typecheck, Test, Build“ completed success; AK nennt `master`.                                                                            |
| **T1.3** | **nicht bestanden (offen, D3)** | Statisch gültig (Compose-Config exit 0, 5 Dienste, Seed-Mount); Laufzeit-/HTTPS-Nachweis ohne Docker-Daemon nicht möglich. Kein neuer Defekt, hostabhängiger offener Punkt.         |
| **T1.4** | **bestanden**                   | Auf frischer DB erneut: pgTAP 45/45 ok, 0 Fehler; RLS/Trigger unverändert grün.                                                                                                     |
| **T1.5** | **bestanden**                   | Frische DB: 13 Kategorien/389 Regeln/13 Einheiten; zweiter Seed-Lauf idempotent; `config.toml` + Seed-Mount konsistent. Wörtlicher `supabase db reset`-Lauf bleibt host-offen (D3). |
| **T1.6** | **bestanden**                   | `ARCHITECTURE.md`, `DECISIONS.md`, `wireframes.md` vorhanden; ARCH verweist auf PLAN §4.1–4.5, keine Widersprüche; Checkbox in dieser Runde abgehakt.                               |
| **T1.7** | **bestanden**                   | README 5 Schritte, `.env.example` vollständig; Backup real: Exit 0, gzip-valid, 55.890 Byte.                                                                                        |

### 7.4 Gesamturteil der Re-Abnahme

**bestanden unter Vorbehalt.**

Die Defekte D1/D4 und D2/D5/D6 sind behoben; die Welle-1-Substanz ist damit Gate-1-fähig. Einziger offener Punkt bleibt **T1.3/D3**: der Laufzeitnachweis von `docker compose up --build`, Caddy-Build, gültigem Zertifikat, HTTPS-`/health` und dem wörtlichen `supabase db reset` auf einem Docker-Host. Gemäß Aufgabenstellung ist das kein Gate-1-Blocker, sondern ein dokumentierter offener Punkt; die Checkbox T1.3 bleibt bis zum Host-Nachweis offen.

### 7.5 Nachtrag D3 — erneute Machbarkeitsprüfung (DevOps, 2026-10-25)

Ergänzend zu 7.2: Docker ist in dieser Sandbox **nicht installierbar**, nicht nur „nicht laufend“. Belege: `uid=10000(hermes)`, kein `sudo`, `CapEff=0000000000000000`, `unshare -Ur` → `Operation not permitted`, `/var/lib/dpkg` und `/usr/bin` nicht schreibbar, kein Socket unter `/var/run`, `/run`, `/run/user/10000`. Damit sind Docker-CE und rootless Podman ausgeschlossen; ein weiterer Retry in derselben Umgebung ist zwecklos (Capability-Block, Details in `docs/DECISIONS.md`, Eintrag „D3 erneut geprüft“).

Ohne Docker dennoch real belegt:

- `docker compose config --quiet` → Exit 0, fünf Dienste, Seed-Mount korrekt.
- Caddy 2.11.7 (Stock-Binary) mit `tls internal` statt DNS-Modul (Ports 8443/8080): `caddy validate` → „Valid configuration“; Start ok; Zertifikat von „Caddy Local Authority“; `curl --resolve … https://…:8443/health` → **HTTP/2 200**, Body `ok`; `/rest/v1/` → **502** (`lookup rest on 127.0.0.11:53`) — Routing greift, nur Docker-DNS fehlt.
- Portable PostgreSQL 18.6.1 + Supabase-Shim: Migrationen 001–003 + Seed mit `ON_ERROR_STOP=1` fehlerfrei; `categories=13`, `category_rules=389`; zweiter Seed-Lauf `INSERT 0 0` (idempotent).
- Echtes LE-Zertifikat mit ipv64-Platzhaltern nicht möglich; das Caddyfile benötigt `dns.providers.lego_deprecated`, das nur der `xcaddy`-Build im Image liefert (Stock-Binary: „module not registered“).

**D3 bleibt offen** und wird als Capability-Block geführt; der Host-Lauf (`docker compose up -d --build`, 5× healthy, `curl https://<domain>/health`, `supabase db reset`) ist auf einem Docker-Host bzw. `docker:dind`-Runner nachzuholen.

## 8. Nachweis T2.1 gegen echten GoTrue-Stack (dritte Runde, QA)

Ziel: Beleg, dass der **echte** Auth-Pfad (`@supabase/ssr` gegen GoTrue v2.197.0) in `apps/web` funktioniert — nicht nur der Mock. Da in dieser Sandbox kein Docker-Daemon läuft (siehe 7.5), wurde der Stack mit nativen Binaries nachgebaut; Caddy wird durch einen kleinen Same-Origin-Proxy (Port 8000) ersetzt, der `/auth/v1/*` auf GoTrue (Port 9999) und alles andere auf `next start` (Port 8001) routet. Das ist ein **QA-Harness**, keine Änderung an Compose/Caddy (gehört zu DevOps).

### 8.1 Aufgebauter Stack

| Baustein   | Umsetzung                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------ |
| PostgreSQL | portable PostgreSQL 18.6.1 (`@embedded-postgres/linux-x64`), Port 55432, `initdb -A trust` |
| GoTrue     | Supabase-GoTrue-Binary v2.197.0 (`/tmp/gt/auth`), `migrate` + `serve`, Port 9999           |
| DB-Schema  | GoTrue-Migrationen 75/75, Repo-Migrationen 001–003 + Seed                                  |
| Frontend   | `next build` + `next start` (Next 16.4.3), `NEXT_PUBLIC_AUTH_MOCK=false`                   |
| Mail       | lokaler SMTP-Sink auf 127.0.0.1:2525, Ablage in `/tmp/ezstack/mail/*.eml`                  |

Wichtige Umgebungs-Notiz: GoTrue legt seine Tabellen nur dann in `auth.*` ab, wenn die DB-URL `search_path=auth` setzt. Beim ersten Lauf landeten sie in `public.*` (deshalb `relation "identities" does not exist`). Nach `?search_path=auth` + vorab angelegtem Schema `auth` liefen alle 75 Migrationen sauber. Das ist eine Harness-Einstellung, kein Repo-Defekt.

### 8.2 Nachgewiesene Kriterien (echter Lauf, keine Mock-Daten)

Ausgeführt mit `node qa_real_auth.mjs` gegen `http://localhost:8000` (Proxy → Next 8001 → GoTrue 9999). Relevanter Output (gekürzt):

```text
login_mock_badge_count: 0
protected_redirect_url: http://localhost:8000/login?next=%2Flists
after_register_url: http://localhost:8000/login?registered=1&email=qa-real-…%40example.com
auth_users_rows: [{"id":"…","email":"qa-real-…@example.com","confirmed_at":"2026-10-25T14:46:22.186Z","last_sign_in_at":"…"}]
profiles_rows_after_register: []
after_login_url: http://localhost:8000/lists
lists_heading: Einkaufslisten
auth_cookie_names: ["sb-localhost-auth-token-flow-…-code-verifier","sb-localhost-auth-token-flows-code-verifier","sb-localhost-auth-token-code-verifier","sb-localhost-auth-token"]
auth_cookie_value_lengths: [159,55,159,2743]
auth_users_last_sign_in_at: [{"last_sign_in_at":"2026-10-25T14:46:22.455Z"}]
profiles_rows_after_login: []
after_logout_url: http://localhost:8000/login?next=/lists
auth_cookie_names_after_logout: []
protected_redirect_after_logout_url: http://localhost:8000/login?next=%2Flists
reset_requested_ui: true
reset_mail_captured_file: 003.eml
reset_mail_link: http://localhost:8000/auth/v1/verify?token=pkce_…&type=recovery&r…
auth_users_recovery_token_present: true
after_reset_link_url: http://localhost:8000/reset-password?code=…
reset_page_has_session_cookie: true
after_password_reset_url: http://localhost:8000/login?reset=1&email=qa-real-…%40example.com
reset_info_visible: 1
login_with_new_password_url: http://localhost:8000/lists
```

Damit ist belegt:

- **Registrierung** legt eine Zeile in `auth.users` an (`confirmed_at` gesetzt; `MAILER_AUTOCONFIRM=true`).
- **Login** setzt ein `sb-localhost-auth-token`-Cookie (2743 Byte) und aktualisiert `last_sign_in_at`; `/lists` ist erreichbar.
- **Logout** löscht die Auth-Cookies (`auth_cookie_names_after_logout: []`).
- **Geschützte Route** ohne Cookie: `GET /lists` → `307` auf `/login?next=%2Flists`; auch nach Logout erneut belegt.
- **Passwort-Reset** versendet eine echte GoTrue-Mail (im SMTP-Sink als `003.eml` gefangen), der Link öffnet eine Session auf `/reset-password?code=…`, die Passwortänderung führt zu `/login?reset=1&email=…`, die Erfolgsmeldung ist sichtbar, und der Login mit dem **neuen** Passwort landet wieder auf `/lists`. Das **alte** Passwort wird abgelehnt (URL bleibt `/login`).

### 8.3 Abweichungen / Befunde (dokumentiert, nicht repariert)

1. **[mittel] Kein `profiles`-Insert bei der Registrierung.** Die Karte fordert „Registrierung legt eine Zeile in `auth.users` + `profiles` an“. Belegt ist nur `auth.users`; `profiles_rows_after_register` und `profiles_rows_after_login` sind leer. Grund im Code: `SupabaseHouseholdAdapter.ensureProfile()` wird ausschließlich in `createHousehold()` aufgerufen (`apps/web/lib/household/supabase-adapter.ts:178`), nicht im Auth-/Listen-Flow. Registrierung und Login auf `/lists` legen also kein Profil an. Produktivcode ist hier out of scope → **Follow-up-Karte** (Trigger auf `auth.users` oder Aufruf im Auth-Flow).
   **Behoben (Follow-up, Karte `t_730199f7`):** Migration `supabase/migrations/20261025_007_sync_auth_profiles.sql` legt per `AFTER INSERT/UPDATE`-Trigger auf `auth.users` automatisch die `profiles`-Zeile an (idempotent), spiegelt `updated_at` und überträgt `deleted_at` (Soft-Delete/Restore); Bestandsnutzer werden per Backfill nachgezogen. Belegt durch `supabase/tests/04_profiles_sync.sql` (17 pgTAP-Assertions, im lokalen Verifikationslauf grün). Der Client-Flow bleibt unverändert; `ensureProfile()` in `createHousehold()` ist dadurch nur noch ein idempotenter Fallback.
2. **[niedrig/UX] Recovery-Link landet ohne E-Mail-Parameter.** GoTrue leitet auf `/reset-password?code=…` (kein `email`). Das Formular verlangt aber ein Pflicht-E-Mail-Feld, d. h. Nutzer müssen ihre Adresse erneut eintippen. Kein Blocker, aber UX-Abweichung; für den Nachweis wurde das Feld im Skript gefüllt (`reset_page_email_prefilled: ""`).
3. **[Info] Signup-Session wird verworfen.** Mit `MAILER_AUTOCONFIRM=true` liefert `POST /auth/v1/signup` bereits ein `access_token`; die UI ignoriert das und leitet immer auf `/login?registered=1` („Konto angelegt, bitte anmelden“). Deckt sich mit der in der Karte erwarteten Abweichung, ist aber nur bei aktivierter Bestätigung wirklich relevant.
4. **[Info] `favicon.ico` → 404** in den Proxy-Logs; kosmetisch.
5. **[Info] QA-Harness-Falle, kein App-Defekt:** Die ersten server-seitigen `GET /auth/v1/user` scheiterten mit `400 Bad Request`, weil der Proxy beim Weiterleiten einen doppelten `Host`-Header erzeugte (Go's HTTP-Server lehnt das ab). Nach Entfernen des doppelten Headers liefen alle Requests. Kein App-Bug — nicht in Richtung Frontend eskalieren.

### 8.4 Urteil T2.1

**bestanden** im Sinne des Akzeptanzkriteriums: Register, Login, Logout, geschützte Route und Passwort-Reset sind gegen den echten GoTrue-Stack mit echtem Output nachgewiesen; die erwarteten Abweichungen sind dokumentiert. **Offen bleibt** der `profiles`-Insert bei Registrierung (Befund 1) — als Folgekarte zu behandeln, kein Blocker für diesen Nachweis.

---

## 9. QA-Abnahme Welle 2 (T2.1–T2.8)

- **Grundlage:** `PLAN.md` §5 (T2.1–T2.8), Anhang A.1/A.2 (A-1…A-8), `docs/HANDOFF.md`.
- **Geprüfter Stand:** `master` @ `12eecc7` (Arbeitsbaum sauber; letzter Commit „Listen-UI … T2.6“).
- **Umgebung:** Sandbox ohne Docker-Daemon. PostgreSQL 16.2 (Unix-Socket `/tmp:55432`), GoTrue v2.197.0 (`/tmp/gt/auth`), Repo-Migrationen 001–006 + Seed. Für den Real-Backend-Lauf: GoTrue mit neu erzeugtem JWT-Secret gegen die vorhandene `auth`-DB gestartet, Web-App aus `12eecc7` mit `NEXT_PUBLIC_AUTH_MOCK=false`, `NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000`, gebaut und über den vorhandenen Python-Proxy (8000 → Next 8001, `/auth/v1` → GoTrue 9999) ausgeliefert. Kein Produktivcode geändert; nur diese Datei ergänzt.

### 9.1 Prüfumfang

| #   | Kriterium                                                               | Geprüft                                                     |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| A-1 | Auth: Playwright Register→Login→Logout, geschützte Route                | ja (Mock- und Real-Backend-Lauf)                            |
| A-2 | Haushalt + Liste: zwei Browser-Kontexte, DB-Assertion für Nichtmitglied | ja (Code-/Testbestand; kein E2E vorhanden)                  |
| A-3 | Einladung: einlösen, Rolle, abgelaufener/widerrufener Link              | ja (Mock-E2E + pgTAP)                                       |
| A-4 | Mitgliederverwaltung: Rolle, Entfernen, letzter Owner                   | ja (Mock-E2E + pgTAP)                                       |
| A-5 | Offline-Sync: Konflikte, Edit-vs-Delete, doppeltes Replay               | ja (Vitest)                                                 |
| A-6 | Listen-UI: Zwei Kontexte <2 s, abgehakte unten, Undo                    | ja (Mock- und Real-Lauf; Latenz-Assertion nicht ausgeführt) |
| A-7 | Auto-Kategorisierung + Lernen aus Korrektur                             | ja (Unit-Tests + Integration in `apps/web`)                 |
| A-8 | Duplikat-Zusammenfassung + Hinweis, verschiedene Dimensionen            | ja (Unit-Tests + Integration in `apps/web`)                 |

### 9.2 Durchgeführte Tests mit echtem Output

#### (1) Qualitätsgates `lint`, `typecheck`, `test`

```text
$ pnpm lint
> eslint . && prettier --check "**/*.{js,mjs,cjs,ts,mts,cts,json,yml,yaml}"
Checking formatting...
All matched files use Prettier code style!
LINT_EXIT=0

$ pnpm typecheck
> pnpm --filter @einkaufszettel/core build && tsc --noEmit -p tsconfig.json && pnpm -r --if-present typecheck
...
apps/web typecheck: Done
TC_EXIT=0

$ pnpm test
 ✓ apps/web/lib/db/repository.test.ts (9 tests)
 ✓ apps/web/lib/household/token.test.ts (6 tests)
 ✓ apps/web/lib/sync/worker.test.ts (5 tests)
 ✓ packages/core/src/outbox.test.ts (12 tests)
 ✓ packages/core/src/categorize.test.ts (16 tests)
 ✓ packages/core/src/sync.test.ts (13 tests)
 ✓ packages/core/src/units.test.ts (9 tests)
 ✓ packages/core/src/duplicate-summary.test.ts (20 tests)
 ✓ apps/web/lib/household/mock-store.test.ts (13 tests)
 ✓ packages/core/src/add-to-list.test.ts (16 tests)
 ✓ packages/core/src/conflict.test.ts (13 tests)
 ✓ apps/web/lib/sync/status.test.ts (8 tests)
 ✓ apps/web/lib/auth/session.test.ts (5 tests)
 ✓ apps/web/lib/auth/validation.test.ts (8 tests)
 ✓ tooling/smoke.test.ts (1 test)
 Test Files  15 passed (15)
      Tests  154 passed (154)

stdout | packages/core/src/categorize.test.ts > Auto-Kategorisierung (T2.7 / A-7) > erreicht ≥85 % Trefferquote auf dem Seed-Testset (≥50 Artikel)
Kategorisierung Trefferquote: 101/104 = 97.1 %
```

Ergebnis: alle drei Gates **exit 0**; Trefferquote **97,1 %** (101/104, Seed-Testset 104 Artikel) wird im Test-Log ausgegeben. A-5, A-7 (Unit-Ebene) und A-8 (Unit-Ebene) sind damit auf Logikebene grün.

#### (2) pgTAP-Suiten (frische Wegwerf-DB, Migrationen 001–006 + Seed)

```text
$ PGROOT=/opt/data/profiles/backend/cache/scratch/pg PGHOST=/tmp PGPORT=55432 PGUSER=postgres bash supabase/tests/run_local_verify.sh
=== 6. pgTAP 01_rls ===       1..45   --> exit=0
=== 7. pgTAP 02_rpc_household_lists ===  1..62   --> exit=0
=== 8. pgTAP 03_invites_and_members ===  1..77   --> exit=0
=== 9. Ergebnis ===
ALLE TESTS GRUEN
PGTAP_EXIT=0
```

Belege für die relevanten Fälle (Auszug aus `/opt/data/tmp-qa/pgtap_run.log`):

```text
ok 31 - Nichtmitglied sieht H1 nicht
ok 32 - Nichtmitglied sieht L1 nicht
ok 33 - Nichtmitglied sieht I1 nicht
ok 34 - Nichtmitglied darf keine Items anlegen
ok 18 - Owner darf Mitglieder anlegen
ok 19 - Owner darf Mitgliederrollen aendern
ok 25 - Editor darf den Haushalt nicht aendern (nur Owner)
ok 26 - Editor sieht keine Invite-Tokens (nur Owner)
ok 12 - Replay von create_invite ist erlaubt (idempotent)
ok 13 - Replay erzeugt keine zweite Einladung
ok 14 - Einladung 1 traegt die gewaehlte Rolle editor
ok 25 - B loest Einladung 1 ein und erhaelt die Rolle editor
ok 73 - Owner D befoerdert Editor E zum Owner
ok 74 - Owner D stuft sich selbst herab (zweiter Owner vorhanden)
ok 75 - households.owner_id zeigt nach der Selbst-Herabstufung auf E
ok 76 - Herabgestufter D darf keine Rollen mehr aendern
ok 77 - Befoerdeter E als letzter Owner kann nicht austreten
```

**184/184 pgTAP-Tests grün**, keine `not ok`, keine `# Failed test`. Damit sind RLS, Invite-Ablauf/-Widerruf (Backend), Rollenwirkung und „letzter Owner“ auf DB-Ebene belegt (A-3, A-4).

#### (3) Playwright-E2E im Mock-Modus (`pnpm test:e2e`, CI-Modus)

```text
4 failed
  [chromium] › e2e/auth.spec.ts:20:1 › Register -> Login -> Logout
  [chromium] › e2e/auth.spec.ts:47:1 › Passwort-Reset (Mock): neues Passwort setzen und anmelden
  [mobile-chromium] › e2e/auth.spec.ts:20:1 › Register -> Login -> Logout
  [mobile-chromium] › e2e/auth.spec.ts:47:1 › Passwort-Reset (Mock): neues Passwort setzen und anmelden
2 skipped
8 passed (1.9m)
Exit status 1
```

Ursachen aus den Error-Contexts:

```text
auth-Register---Login---Logout:
  expect(locator).toBeVisible() failed
  Locator: getByRole('heading', { name: 'Einkaufslisten' })
  Error: element(s) not found
  # Die tatsächliche UI zeigt seit T2.6: heading "Einkaufsliste" (Singular)

auth-Passwort-Reset:
  expect(locator).toBeVisible() failed
  Locator: getByText('e2e-…@example.com')
  # Die neue Listen-UI zeigt die E-Mail-Adresse nicht mehr im Header
```

Ergebnis: **CI-E2E-Suite ist am HEAD rot.** Ursache ist kein Auth-Defekt, sondern veraltete Selektoren/Erwartungen nach der T2.6-UI-Änderung (Singular „Einkaufsliste“, E-Mail nicht mehr sichtbar). A-3/A-4-E2E (household.spec) und der Listen-UI-Test „Artikel hinzufügen/abhaken/löschen/Undo“ sind in beiden Projekten **grün**.

#### (4) Playwright-E2E gegen echtes GoTrue/Next-Backend

```text
$ E2E_PORT=8000 NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000 playwright test --project=chromium
✓  1 [chromium] › e2e/auth.spec.ts:14:1 › geschuetzte Route ohne Session leitet auf /login (693ms)
✘  2 [chromium] › e2e/auth.spec.ts:20:1 › Register -> Login -> Logout (17.1s)
✘  3 [chromium] › e2e/auth.spec.ts:47:1 › Passwort-Reset (Mock): neues Passwort setzen und anmelden (1.0m)
✘  4 [chromium] › e2e/household.spec.ts:66:1 › A-3/A-4: Einladung einloesen, Rolle wirkt sofort, Entfernen entzieht Zugriff, letzter Owner geschuetzt (17.6s)
✘  5 [chromium] › e2e/household.spec.ts:146:1 › A-3: abgelaufener und widerrufener Link werden mit unterscheidbarer Meldung abgelehnt (17.7s)
✓  6 [chromium] › e2e/list-ui.spec.ts:35:3 › Listen-UI (T2.6) › Artikel hinzufuegen, abhaken, loeschen und Undo (2.5s)
✘  7 [chromium] › e2e/list-ui.spec.ts:66:3 › Listen-UI (T2.6) › Zwei Browser-Kontexte: Aenderung in <2s beim anderen (nur mit echtem Backend) (17.6s)
5 failed
2 passed (2.3m)
```

Wichtige Einordnung der Fehler:

- **Auth Register→Login→Logout:** Die Seite ist nach der Registrierung/Anmeldung tatsächlich eingeloggt — der Error-Context zeigt `heading "Einkaufsliste"`, `Sync-Status: Synchronisiert`, `Abmelden`. Der Test scheitert nur am veralteten Selektor `Einkaufslisten`. **Die reale Auth-Funktion funktioniert**, der Test ist stale (D8.1).
- **Haushalt A-3/A-4 und A-3-Ablauf:** Der `createHousehold`-Aufruf scheitert; die UI zeigt als Alert den HTML-Body einer Next-404-Seite. Ursache: Der Sandbox-Stack hat **kein PostgREST**; `supabase-js` ruft `/rest/v1/...` auf, der Proxy leitet das an Next (8001) weiter, Next antwortet mit 404-HTML. Das ist eine **Harness-Grenze**, kein App-Defekt — auf einem echten Supabase-Stack (PostgREST vorhanden) wäre der Pfad vorhanden. Der Nachweis für A-3/A-4-real bleibt in dieser Umgebung offen.
- **Zwei-Browser-Kontexte (A-6):** Der Test registriert in beiden Kontexten **dieselbe E-Mail**. Im Real-Backend antwortet GoTrue beim zweiten Mal korrekt mit „Für diese E-Mail-Adresse existiert bereits ein Konto.“; der Test bleibt auf `/register` und schlägt fehl. Damit ist der Test für ein echtes Backend **fehlerhaft konstruiert** (zweiter Kontext müsste einloggen statt registrieren) und die Latenz-Assertion wird nie erreicht (D8.3).
- **Passwort-Reset (Mock):** Der Test ist ausdrücklich Mock-only, wird aber im Real-Lauf mit ausgeführt und scheitert an der fehlenden Mock-Route/Erwartung. Test-Hygiene (D8.6).

### 9.3 Befunde / Defekte

#### D8.1 — [hoch] CI-E2E-Suite nach T2.6-UI-Änderung rot (A-1, A-6)

- **Ist:** `pnpm test:e2e` (Mock-Modus, wie in `.github/workflows/e2e.yml`) endet mit **4 failed / 8 passed / 2 skipped**, Exit 1. `auth.spec.ts` erwartet Überschrift `Einkaufslisten` und die E-Mail-Adresse im Listen-Header; die T2.6-UI rendert `Einkaufsliste` (Singular) und zeigt die E-Mail nicht mehr. Der Workflow läuft auf jedem Push auf `master`; damit ist die Pipeline am HEAD rot. A-1 verlangt ausdrücklich „Playwright-Test grün in CI“.
- **Soll:** `pnpm test:e2e` grün; Selektoren an die aktuelle UI angepasst (Singular, E-Mail-Assertion entfernen oder an eine Stelle legen, wo die E-Mail noch sichtbar ist).
- **Reproduktion:** `pnpm test:e2e` → 4 failed; Error-Context `test-results/auth-Register---Login---Logout-chromium/error-context.md`.
- **Hinweis:** Die Auth-Funktion selbst ist nicht defekt — im Real-Lauf ist die Seite nach Login korrekt eingeloggt. Es ist ein Test-Wartungsdefekt mit CI-Blocker-Wirkung.

#### D8.2 — [hoch] A-7/A-8-Kernlogik ist nicht in die Web-App verdrahtet

- **Ist:** `categorize`, `learnFromManualChange`, `summarizeDuplicate`/`aggregateListRows` existieren in `packages/core` und sind durch Unit-Tests abgedeckt. In `apps/web` werden sie **nicht verwendet**:
  - `grep -rn "categorize\|learnFromManualChange" apps/web` → **keine Treffer** (nur `CATEGORY_KEYS`/`CATEGORY_LABELS`-Importe für Labels).
  - `handleAddItem` in `apps/web/app/lists/page.tsx` ruft `createItemLocal` nur mit `list_id` und `name` auf; `createItemLocal` setzt `category_id: input.category_id ?? null` (`apps/web/lib/db/repository.ts:196`). Neue Artikel werden also **nicht automatisch kategorisiert** und landen über den Fallback in „sonstiges“.
  - Die Detailseite (`apps/web/app/list/[itemId]/page.tsx`) schreibt bei einer Kategorie-Korrektur nur `category_id`; ein Aufruf von `learnFromManualChange` ist nicht vorhanden. Es entsteht **keine Haushaltsregel**.
  - `ListItemRow.tsx` rendert nur `name` und `quantity`; eine Duplikat-Zusammenfassung/ein Hinweis wird nicht berechnet oder angezeigt. `createItemLocal` prüft vor dem Insert keine Duplikate.
- **Soll:** Beim Hinzufügen `categorize`/Duplikatprüfung verwenden und bei manueller Kategorieänderung `learnFromManualChange` aufrufen; die UI muss den Hinweis („Menge addiert“, „eigene Zeile wegen anderer Dimension“) anzeigen. A-8 verlangt zusätzlich eine **UI-Assertion im E2E**.
- **Reproduktion:** In der Listen-UI „Milch“ zweimal hinzufügen → zwei Zeilen, kein Hinweis, keine Mengenaddition; neue Artikel haben keine Kategorie. Code-Referenzen s. o.
- **Folge:** Die Checkboxen T2.7/T2.8 in `PLAN.md` sind verfrüht abgehakt; die Features sind im Produkt nicht nutzbar, obwohl die Core-Logik getestet ist.

#### D8.3 — [hoch] A-6-Latenz-Assertion wird in CI nie ausgeführt; Real-Test fehlerhaft

- **Ist:** `list-ui.spec.ts` überspringt den Zwei-Kontext-Test ohne `NEXT_PUBLIC_SUPABASE_URL`; der CI-Workflow startet die App mit `NEXT_PUBLIC_AUTH_MOCK=true` und ohne Supabase-URL → **2 skipped** in jedem Lauf. Es gibt damit **keinen** CI-Nachweis für „Änderung erscheint in <2 s“. Im Real-Lauf scheitert der Test vor der Messung, weil beide Kontexte dieselbe E-Mail registrieren (GoTrue: „Für diese E-Mail-Adresse existiert bereits ein Konto“). Die vorhandene `expect(...).toBeVisible({ timeout: 2000 })`-Assertion wird nie erreicht.
- **Soll:** Eigener E2E-Real-Job (echtes Supabase) mit zwei Kontexten/Usern (oder Login statt Zweit-Registrierung) und tatsächlich gemessener Latenz; Ergebnis im CI-Log.
- **Reproduktion:** `E2E_PORT=8000 NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000 playwright test --project=chromium` → `list-ui.spec.ts:66:3` failed, Alert „Für diese E-Mail-Adresse existiert bereits ein Konto.“; Mock-Lauf → „2 skipped“.

#### D8.4 — [mittel] A-2 hat keinen E2E-Test mit zwei Browser-Kontexten

- **Ist:** In `apps/web/e2e` existiert kein A-2-Test (kein Treffer für „A-2“/„fremd“). Die Nichtmitglied-Sicht ist nur durch pgTAP belegt (`ok 31–34`, `ok 46–52`), nicht durch einen Playwright-Test mit zwei Kontexten und DB-Assertion auf 0 sichtbare Zeilen für B. Anhang A.2 verlangt genau diesen Nachweis.
- **Soll:** Playwright-Test: A legt Haushalt + Liste an; B (nicht Mitglied) sieht in Listen-/Detailansicht keine Zeilen; zusätzlich DB-Assertion (z. B. Service-Role-Count = 0 für B).
- **Reproduktion:** `grep -rn "A-2" apps/web/e2e` → keine Treffer.

#### D8.5 — [mittel, Umgebung] Real-Backend-Harness ohne PostgREST

- **Ist:** Der vorhandene Sandbox-Stack besteht aus PostgreSQL + GoTrue + Next + Python-Proxy; **PostgREST fehlt**. `supabase-js`-REST-Aufrufe (`/rest/v1/...`) landen bei Next und liefern 404-HTML; die UI zeigt dieses HTML als Fehlermeldung. Deshalb scheitern `household.spec.ts` (A-3/A-4) im Real-Lauf, obwohl Mock-E2E und pgTAP grün sind.
- **Soll:** Real-E2E gegen vollständigen Supabase-Stack (PostgREST, ggf. Realtime) oder gegen die Compose-Umgebung; dann A-2/A-3/A-4/A-6 real nachweisen.
- **Einordnung:** Kein App-Defekt, sondern eine Harness-Grenze der Sandbox (kein Docker). Auf einem echten Supabase-Stack sind die RPC-/REST-Pfade vorhanden. Der Nachweis bleibt offen.

#### D8.6 — [niedrig] Test-Hygiene Passwort-Reset / Profile-Insert

- **Ist:** Der Passwort-Reset-Test ist als „(Mock)“ markiert, wird aber im Real-Lauf mit ausgeführt und scheitert dort an der fehlenden Mock-Route. Zudem wird bei Registrierung weiterhin **keine** `profiles`-Zeile angelegt (bereits Befund 1 in §8.3); `ensureProfile()` läuft erst in `createHousehold()`. Für A-2/A-3 ist das kein Blocker (Create-Pfad upsertet), aber der Registrierungs-Flow bleibt inkonsistent.
- **Soll:** Mock-Test per `test.skip(!isMockAuth)` ausschließen; Profil-Insert beim Signup (Trigger auf `auth.users` oder Aufruf im Auth-Flow) nachziehen.

### 9.4 Urteil je Kriterium

| #       | Urteil                               | Begründung (knapp)                                                                                                                                                                                              |
| ------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A-1** | **nicht bestanden**                  | Playwright-Suite am HEAD rot (`pnpm test:e2e`: 4 failed/8 passed/2 skipped). Funktionale Auth ist real nachgewiesen, aber das AK verlangt „Playwright-Test grün in CI“; D8.1.                                   |
| **A-2** | **nicht bestanden**                  | Kein E2E-Test mit zwei Browser-Kontexten + DB-Assertion; nur pgTAP-RLS. D8.4.                                                                                                                                   |
| **A-3** | **bestanden (Mock/pgTAP)**           | Mock-E2E deckt Einlösen/Rolle sowie abgelaufenen/widerrufenen Link ab (beide Tests grün); pgTAP bestätigt Invite-Replay/Rolle/Ablauf. Real-Backend-E2E offen wegen D8.5.                                        |
| **A-4** | **bestanden (Mock/pgTAP)**           | Mock-E2E: Rolle wirkt sofort, Entfernen entzieht Zugriff, letzter Owner geschützt (grün); pgTAP `ok 73–77`. Real-Backend-E2E offen wegen D8.5.                                                                  |
| **A-5** | **bestanden**                        | 154 Vitest-Tests grün, inkl. Konfliktfälle (gleichzeitiges Abhaken, Edit-vs-Delete) und doppeltes Outbox-Replay ohne Duplikat.                                                                                  |
| **A-6** | **nicht bestanden**                  | UI-Sortierung/Undo ist grün, aber die geforderte Zwei-Kontext-Latenz-Assertion wird in CI übersprungen und im Real-Lauf vor der Messung durch den Doppel-Registrierungsfehler abgebrochen; D8.3.                |
| **A-7** | **nicht bestanden (Integration)**    | Unit-Tests + Trefferquote 97,1 % grün, aber `categorize`/`learnFromManualChange` sind in `apps/web` nicht verdrahtet: neue Artikel werden nicht kategorisiert, Korrekturen erzeugen keine Haushaltsregel. D8.2. |
| **A-8** | **nicht bestanden (Integration/UI)** | Unit-Tests grün, aber keine Duplikat-Zusammenfassung im Add-Flow und kein Hinweis in der UI; die geforderte UI-Assertion fehlt. D8.2.                                                                           |

### 9.4b Urteil je T2.x (Plan-AKs)

| T2.x     | Urteil                            | Begründung (knapp)                                                                                                                     |
| -------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **T2.1** | **nicht bestanden**               | AK „E2E-Test Register→Login→Logout“: Suite am HEAD rot (D8.1); die Funktion selbst ist real nachgewiesen, der Test ist stale.          |
| **T2.2** | **nicht bestanden**               | Checkbox in `PLAN.md` noch offen; kein E2E-Nachweis „zweiter Nutzer sieht fremde Haushalte nicht“ (nur pgTAP-DB-Sicht, D8.4).          |
| **T2.3** | **bestanden (Mock/pgTAP)**        | Einlösen, Rollenwahl, Ablauf/Widerruf in Mock-E2E und pgTAP grün; Real-Backend-E2E offen (D8.5).                                       |
| **T2.4** | **bestanden (Mock/pgTAP)**        | Rollenwechsel, Entfernen, „letzter Owner“ in Mock-E2E und pgTAP `ok 73–77` grün; Real-Backend-E2E offen (D8.5).                        |
| **T2.5** | **bestanden**                     | 154 Vitest-Tests inkl. Konfliktfälle (gleichzeitig Abhaken, Edit-vs-Delete, doppeltes Outbox-Replay) grün.                             |
| **T2.6** | **nicht bestanden**               | UI/Undo grün, aber der AK „Änderung in <2 s beim anderen“ wird in CI übersprungen und im Real-Lauf vor der Messung abgebrochen (D8.3). |
| **T2.7** | **nicht bestanden (Integration)** | Unit-Tests + 97,1 % Trefferquote grün, aber `categorize`/`learnFromManualChange` sind in der Web-App nicht verdrahtet (D8.2).          |
| **T2.8** | **nicht bestanden (Integration)** | Unit-Tests grün, aber keine Duplikat-Zusammenfassung/Hinweis im Add-Flow der UI (D8.2).                                                |

### 9.5 Fazit Welle 2

**Nicht bestanden.** Die Backend-/Core-Logik ist weitgehend solide (184/184 pgTAP, 154/154 Vitest, Trefferquote 97,1 %), aber die **Abnahmekriterien der Welle 2 sind nicht erfüllt**:

- Die **CI-E2E-Suite ist rot** (A-1; D8.1) — Release-Blocker, auch wenn die Auth-Funktion real funktioniert.
- **A-2** hat den geforderten Zwei-Kontext-E2E-Nachweis nicht (D8.4).
- **A-6** hat keine in CI ausgeführte Latenz-Assertion (D8.3).
- **A-7/A-8** sind nur als Core-Logik + Unit-Tests vorhanden, aber **nicht in der App verdrahtet** (D8.2) — die geplanten Features sind für Nutzer nicht wirksam.

**Empfohlene Folgekarten (kein Produktivcode in dieser QA-Runde geändert):**

1. E2E-Selektoren nach T2.6 aktualisieren (`Einkaufsliste` statt `Einkaufslisten`, E-Mail-Assertion entfernen/verschieben); CI wieder grün machen. (D8.1)
2. `categorize` beim Anlegen und `learnFromManualChange` bei Kategorie-Korrektur in `apps/web` aufrufen; Duplikatprüfung/`summarizeDuplicate` im Add-Flow + Hinweis rendern; E2E-UI-Assertion ergänzen. (D8.2)
3. A-2-Zwei-Kontext-E2E mit DB-Assertion ergänzen. (D8.4)
4. Real-Backend-E2E-Job (Supabase/PostgREST) für A-3/A-4/A-6; Cross-Kontext-Test mit zwei Usern/Login statt Doppel-Registrierung. (D8.3/D8.5)
5. `profiles`-Insert beim Signup nachziehen; Mock-only-Test korrekt skippen. (D8.6)

### 9.6 Gate-2-Checkliste (manuelle Handy-Abnahme, zwei Geräte)

**Voraussetzung:** vollständiger Supabase-Stack (PostgREST + GoTrue + Realtime) bzw. Compose-Umgebung; die Sandbox hier hat kein PostgREST (D8.5). Die Checkliste ist für die manuelle Abnahme am Handy gedacht; „automatisiert“ heißt, dass dafür bereits ein grüner Test vorliegt, „offen“ heißt: manuell prüfen, weil kein automatisierter Nachweis existiert oder er am HEAD rot ist.

| #     | Prüfpunkt (AK)                                | Vorgehen auf dem Handy                                                                 | Erwartung                                                                                                                             | Automatisiert?                                    | Status / Hinweis                                                                |
| ----- | --------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| G2-1  | Registrierung → Login → Logout (A-1)          | Auf Gerät A registrieren, anmelden, abmelden                                           | Nach Registrierung `/login?registered=1`; Login landet auf `/lists`; Logout führt zu `/login`; kein Zugriff auf `/lists` ohne Session | ja (Mock/real), aber Suite rot                    | **offen** – D8.1: Selektoren stale; Funktion real ok                            |
| G2-2  | Passwort-Reset (A-1)                          | „Passwort vergessen“ auf Gerät A, Link in Mail öffnen                                  | Reset-Formular, neues Passwort setzen, danach Login                                                                                   | ja (Mock)                                         | **offen** – Link enthält kein `email`; E-Mail manuell eintippen (§8.3 Befund 2) |
| G2-3  | Geschützte Route (A-1)                        | `/lists` ohne Login aufrufen                                                           | Redirect `/login?next=%2Flists`                                                                                                       | ja (Mock/real grün)                               | **bestanden**                                                                   |
| G2-4  | Haushalt + Standardliste anlegen (T2.2)       | Auf Gerät A Haushalt anlegen                                                           | Haushalt + Standardliste existieren; A sieht sie                                                                                      | teilweise (pgTAP)                                 | **offen** – kein E2E; realer Stack nötig (D8.5)                                 |
| G2-5  | Zweites Gerät als Nichtmitglied (A-2)         | Auf Gerät B (anderer Account) anmelden, bevor Einladung angenommen                     | B sieht den Haushalt/die Liste von A **nicht** (leerer Zustand, keine Items); DB-Count für B = 0                                      | nur pgTAP (`ok 31–34`)                            | **offen** – D8.4: E2E mit zwei Kontexten + DB-Assertion fehlt                   |
| G2-6  | Einladung via Link/QR einlösen (A-3)          | A erstellt Einladung mit Rolle „Editor“, B scannt QR/öffnet Link und löst ein          | B tritt bei, Rolle „Editor“ wirkt sofort; B sieht Liste                                                                               | ja (Mock/pgTAP)                                   | **offen real** – D8.5; Mock grün                                                |
| G2-7  | Abgelaufener/widerrufener Link (A-3)          | Abgelaufenen Link und widerrufenen Link auf B öffnen                                   | Zwei **unterscheidbare** Meldungen; kein Beitritt                                                                                     | ja (Mock)                                         | **bestanden (Mock)**; realer Lauf offen (D8.5)                                  |
| G2-8  | Rolle ändern wirkt sofort (A-4)               | A ändert B von „Editor“ auf „Viewer“; B aktualisiert                                   | B kann keine Artikel mehr anlegen/ändern; UI zeigt Rolle                                                                              | ja (Mock/pgTAP)                                   | **bestanden (Mock)**; realer Lauf offen                                         |
| G2-9  | Mitglied entfernen entzieht Zugriff (A-4)     | A entfernt B; B öffnet Liste erneut                                                    | B verliert Zugriff (Liste/Haushalt nicht mehr sichtbar)                                                                               | ja (Mock/pgTAP)                                   | **bestanden (Mock)**; realer Lauf offen                                         |
| G2-10 | Letzter Owner kann nicht austreten (A-4)      | Einziger Owner tippt „Haushalt verlassen“                                              | Abbruch mit verständlicher P0001-Meldung; Owner bleibt                                                                                | ja (Mock/pgTAP `ok 77`)                           | **bestanden (Mock)**                                                            |
| G2-11 | Offline: Hinzufügen/Abhaken/Löschen (A-5)     | Gerät A in Flugmodus: Artikel hinzufügen, abhaken, löschen; App neu laden              | Alle Aktionen lokal sichtbar; Sync-Status „ausstehend“; keine Datenverluste                                                           | ja (Vitest)                                       | **bestanden (Logik)**; manuell auf Gerät bestätigen                             |
| G2-12 | Reconnect: Outbox vollständig abspielen (A-5) | Flugmodus aus; warten                                                                  | Outbox leert sich; keine Duplikate; Status „Synchronisiert“                                                                           | ja (Vitest)                                       | **bestanden (Logik)**; manuell bestätigen                                       |
| G2-13 | Konflikt: gleichzeitiges Abhaken (A-5)        | A und B beide offline denselben Artikel abhaken; beide online bringen                  | Eindeutiger Gewinner, kein Duplikat, kein Datenverlust                                                                                | ja (Vitest)                                       | **bestanden (Logik)**; manuell bestätigen                                       |
| G2-14 | Konflikt: Edit vs. Delete (A-5)               | A bearbeitet offline, B löscht offline; beide synchronisieren                          | Löschung gewinnt (Tombstone), kein Wiederauferstehen                                                                                  | ja (Vitest)                                       | **bestanden (Logik)**; manuell bestätigen                                       |
| G2-15 | Realtime <2 s (A-6)                           | A und B geöffnet; A fügt Artikel hinzu; Stoppuhr                                       | Artikel erscheint bei B in **<2 s** ohne Reload                                                                                       | **nein** (CI überspringt; realer Test fehlerhaft) | **offen** – D8.3; Release-Blocker für A-6                                       |
| G2-16 | Abgehakte unten + Undo (A-6)                  | Artikel abhaken; löschen; „Rückgängig“ tippen                                          | Abgehakte unter „Erledigt (n)“; Undo stellt Artikel wieder her                                                                        | ja (Mock-E2E)                                     | **bestanden (UI)**                                                              |
| G2-17 | Auto-Kategorisierung (A-7)                    | „Milch“, „Brot“, „Tomate“ hinzufügen                                                   | Einsortierung in Milchprodukte/Backwaren/Obst & Gemüse                                                                                | nein (UI nicht verdrahtet)                        | **blockiert** – D8.2; derzeit alles „sonstiges“                                 |
| G2-18 | Lernen aus Korrektur (A-7)                    | Kategorie von „Milch“ manuell auf „Sonstiges“ ändern; danach erneut „Milch“ hinzufügen | Neue „Milch“ wird der gelernten Haushaltsregel „Sonstiges“ zugeordnet                                                                 | nein (UI nicht verdrahtet)                        | **blockiert** – D8.2; keine Haushaltsregel wird erzeugt                         |
| G2-19 | Duplikat gleiche Dimension (A-8)              | „Milch 1 l“ zweimal hinzufügen                                                         | Eine Zeile „Milch 2 l“ + Hinweis „Menge addiert“                                                                                      | nein (UI nicht verdrahtet)                        | **blockiert** – D8.2; zwei Zeilen ohne Hinweis                                  |
| G2-20 | Duplikat unterschiedliche Dimension (A-8)     | „Milch 1 l“ und „Milch 2 Stück“ hinzufügen                                             | Getrennte Zeilen; Hinweis „eigene Zeile (andere Dimension)“                                                                           | nein (UI nicht verdrahtet)                        | **blockiert** – D8.2; keine Dimension-Erkennung in der UI                       |

**Kurzfassung für die Handy-Abnahme:** G2-3, G2-7…G2-14, G2-16 sind automatisiert bzw. logisch abgesichert; G2-1/G2-2 sind manuell zu prüfen (Test rot, Funktion ok); G2-4/G2-5/G2-6/G2-8/G2-9/G2-10 brauchen den vollständigen Supabase-Stack; **G2-15 (Realtime <2 s), G2-17…G2-20 (Auto-Kategorisierung/Lernen/Duplikate) sind derzeit blockiert** und dürfen nicht als „bestanden“ abgehakt werden. Die manuelle Handy-Abnahme sollte erst nach Behebung von D8.1/D8.2/D8.3 und mit echtem Supabase-Stack erfolgen.
