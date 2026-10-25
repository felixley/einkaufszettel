# REVIEW — QA-Abnahme Welle 1 (T1.1–T1.7)

- **Grundlage:** `PLAN.md` §5 (Stand `00f656c`), `docs/HANDOFF.md`, Re-Scope-Kommentare der Karten.
- **Geprüfter Stand:** `master` @ `00f656c` (Arbeitsbaum sauber).
- **Umgebung:** Sandbox ohne Docker-Daemon und ohne `supabase`-CLI; Node 26.7.0, pnpm 9.15.4 via `npx`.
  Ersatzweise Vanilla PostgreSQL 16.2 + Supabase-Kompatibilitäts-Shim (Rollen `anon`/`authenticated`/`service_role`, `auth`-Schema, `auth.uid()`) und pgTAP als plain SQL. Docker-Compose-Plugin fehlte; für den statischen Check wurde das Standalone-Binary `docker-compose v2.29.7` verwendet.
- **Rollen:** QA prüft gegen AK/DoD, nicht gegen Produktentscheidungen. Kein Produktivcode geändert; nur diese Datei geschrieben.

## 1. Prüfumfang

| Aufgabe | Prüfgegenstand | Geprüft |
|---|---|---|
| T1.1 | Monorepo/Tooling, frischer Checkout: `pnpm lint && pnpm typecheck && pnpm test` | ja, auf frischem Clone |
| T1.2 | GitHub Actions CI, YAML lokal via `actionlint`, Pipeline grün | ja, lokal + GitHub-API |
| T1.3 | Compose-Stack (db/auth/rest/web/caddy), HTTPS/ipv64-DNS-01, `/health` | teilweise (Config/Images statisch; Laufzeit nicht möglich) |
| T1.4 | Migrationen, Trigger, Indizes, RLS; pgTAP-Rollenfälle | ja, vollständig ausgeführt |
| T1.5 | Seed: 13 Kategorien, >0 Regeln, idempotent; `supabase db reset` | ja, Seed ausgeführt; `db reset` nicht möglich |
| T1.6 | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/wireframes.md` | ja, Datei-/Inhaltsprüfung |
| T1.7 | README ≤5 Schritte, `.env.example`, `scripts/backup.sh` (Exit 0, >0 Byte) | ja, Backup real gegen PG ausgeführt |

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
  2. `ls supabase/config.toml` → *No such file or directory*
  3. `grep -n 'docker-entrypoint-initdb.d' docker-compose.yml` → nur `./supabase/migrations`
  4. Auf Docker-Host: `docker compose up -d --build`; danach `select count(*) from categories;` → 0
  5. `supabase db reset` → Abbruch wegen fehlender `config.toml`
- **Fix-Vorschlag:** `supabase/config.toml` mit Projekt-ID und `[db.seed] enabled = true, sql_paths = ["./seed.sql"]` anlegen; zusätzlich `./supabase/seed.sql:/docker-entrypoint-initdb.d/zz_seed.sql:ro` mounten (alphabetisch nach den Migrationen) **oder** einen dokumentierten Seed-Schritt in README/Skript ergänzen. Auf Docker-Host `supabase db reset` + Zählabfrage nachweisen.

### D2 — [kritisch] `docs/ARCHITECTURE.md` fehlt (T1.6a)
- **Ist:** Datei nicht vorhanden; `PLAN.md`-Checkbox T1.6 offen. `DECISIONS.md` und `wireframes.md` sind vorhanden.
- **Soll:** `docs/ARCHITECTURE.md` existiert, verweist auf `PLAN.md` §4 (Datenmodell, Sync/LWW, Einheiten, Kategorien, Sicherheit/RLS) und widerspricht dem Plan nicht.
- **Reproduktion:** `ls docs/ARCHITECTURE.md` → *No such file or directory*; `grep -n 'T1.6' PLAN.md` → `- [ ]`.
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

| Prüfpunkt | Befund | Freigabe? |
|---|---|---|
| **Schema** (Datenmodell §4.1) | 10 Tabellen, 18 Indizes, 19 Trigger, UUIDv7-Checks ohne DB-Default, `updated_at`-Trigger, Soft-Delete-Sperre; pgTAP 45/45 grün. Seed-Zählung 13/389/13 idempotent. | **ja, mit Auflage D1** (Seed im Stack nachweisen) |
| **RLS-Konzept** (§4.5) | 40 Policies (10 Tabellen × 4 Operationen), RLS auf allen 10 Tabellen aktiv; Rollenfälle per pgTAP belegt. Aber: kein `ARCHITECTURE.md`-Konzeptdokument; RLS-Begründung nur in Migration/DECISIONS verstreut. | **nein, bis D2 behoben** |
| **Wireframes** (T1.6b) | Drei Low-Fi-Skizzen (Liste, Rezept/Portionsrechner, Import-Vorschau), Kerninteraktionen beschriftet (Hinzufügen ≤2 Taps, Abhaken 1 Tap), Zustände, Tap-Bilanz, offene PO-Punkte. | **ja** |

## 5. Urteil je Aufgabe

| Aufgabe | Urteil | Begründung (knapp) |
|---|---|---|
| **T1.1** | **bestanden** | Frischer Clone: install 17.6 s; lint/typecheck/test/build alle exit 0; Husky aktiv. DoD-Checkbox offen (D5). |
| **T1.2** | **bestanden** | `actionlint` exit 0; GitHub-Runs 40182149307 (cd95b4d) und 40187777526 (00f656c) `conclusion: success`. DoD-Checkbox offen (D5). |
| **T1.3** | **nicht bestanden** | Config/Images/Caddyfile statisch ok, aber `docker compose up`, Caddy-Build, gültiges Zertifikat und HTTPS-`/health` sind nicht nachgewiesen (D3). |
| **T1.4** | **bestanden** | pgTAP 45/45, RLS auf 10 Tabellen, 40 Policies, 19 Trigger, UUIDv7/Soft-Delete belegt. |
| **T1.5** | **nicht bestanden** | Seed selbst grün/idempotent (13/389/13), aber `supabase db reset` fehlt `config.toml`; Compose mountet `seed.sql` nicht → AK wörtlich nicht erfüllt (D1/D4). |
| **T1.6** | **nicht bestanden** | `ARCHITECTURE.md` fehlt; T1.6b Wireframes und `DECISIONS.md` sind dagegen erfüllt (D2). |
| **T1.7** | **bestanden** | Backup real: Exit 0, gzip-valid, 9578 Byte; README 5 Schritte, `.env.example`, Cron-Beispiel, `backups/` gitignored. Startpfad nur statisch geprüft (abhängig von T1.3); DoD-Checkbox offen (D5). |

## 6. Gesamturteil

**nicht bestanden.**

Phase 1 ist technisch breit aufgestellt — T1.1, T1.2, T1.4 und T1.7 sind substanziell erfüllt, T1.4 sogar mit starker pgTAP-Abdeckung. Für das Human Gate 1 fehlen jedoch drei Pflichtnachweise: (1) der Laufzeitnachweis des Compose-/HTTPS-Stacks (T1.3), (2) ein funktionierender Seed-/Reset-Pfad im Stack (T1.5) und (3) das Architektur-/RLS-Konzeptdokument (T1.6a). Solange diese offen sind, ist die Abnahme nicht möglich. Empfehlung: D1/D2 vor dem Human Gate beheben, T1.3 auf einem Docker-Host nachweisen, danach erneute QA-Abnahme.
