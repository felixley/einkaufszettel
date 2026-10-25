# Einkaufszettel

Kollaborative, local-first Einkaufsliste. Maßgeblich ist [`PLAN.md`](./PLAN.md);
Welle 1 (Phase 1) richtet Fundament und Infrastruktur ein. Diese README
beschreibt das Dev-Setup und den Betrieb des Compose-Stacks.

## Dev Setup (max. 5 Schritte)

Voraussetzungen: Node.js 22 (siehe `.nvmrc`), pnpm 9 (via Corepack), Docker mit
Compose-Plugin (v2+).

1. **Env anlegen und Schluessel erzeugen**
   ```bash
   cp .env.example .env
   node scripts/generate-supabase-keys.mjs | tee -a .env
   # danach in .env: DOMAIN, ACME_EMAIL, IPV64_API_KEY, POSTGRES_PASSWORD setzen
   ```
2. **Abhaengigkeiten installieren**
   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   ```
3. **Qualitaets-Gates lokal ausfuehren**
   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm build
   ```
4. **Stack starten**
   ```bash
   docker compose up -d --build
   docker compose ps          # alle Dienste, web muss (healthy) sein
   ```
5. **Health und HTTPS pruefen**
   ```bash
   curl -fsS "https://${DOMAIN:-localhost}/health"   # {"status":"ok"}
   ```

Hinweis: `docker compose config` validiert die Compose-Datei ohne Start. In
Umgebungen ohne Docker-Daemon (z. B. CI-Sandbox) ist nur dieser statische Check
moeglich; `up --build` muss auf einem Docker-Host laufen. Die App ist ein
Infrastruktur-Platzhalter (nur `/` und `/health`); die Listen-UI folgt in
Phase 2 (T2.6).

## Stack (T1.3)

Reduziertes self-hosted Supabase plus Next.js und Caddy:

| Dienst  | Image                           | Zweck                                   |
| ------- | ------------------------------- | --------------------------------------- |
| `db`    | `supabase/postgres:15.19.0.007` | Postgres inkl. Supabase-Rollen/Schemas  |
| `auth`  | `supabase/gotrue:v2.197.0`      | Auth-API (`/auth/v1/*`)                 |
| `rest`  | `postgrest/postgrest:v16.5`     | REST-API (`/rest/v1/*`)                 |
| `web`   | `apps/web/Dockerfile`           | Next.js-App, `/health`                  |
| `caddy` | `caddy/Dockerfile`              | TLS via ipv64.net DNS-01, Reverse Proxy |

Nicht enthalten (bewusst reduziert): Studio, Kong, Realtime, Storage. Fuer
Phase 2 (Sync/Realtime) wird der Stack erweitert. Schema-Migrationen und Seed
werden beim ersten DB-Start aus `supabase/migrations/` bzw. `supabase/seed.sql`
eingespielt (Bind-Mounts nach `/docker-entrypoint-initdb.d`).

### Seed und Reset

Ein frischer Stack startet mit Basisdaten: 13 globale Kategorien und 389
Keyword-Regeln. `docker-compose.yml` mountet dafuer zusaetzlich
`./supabase/seed.sql` als `zz_seed.sql` in `/docker-entrypoint-initdb.d`;
durch das `zz_`-Praefix laeuft der Seed alphabetisch nach den Migrationen.

Die Init-Skripte des Postgres-Images laufen **nur bei leerem Datenvolume**.
Nach Aenderungen an Schema oder Seed daher neu initialisieren (loescht
Dev-Daten):

```bash
docker compose down -v        # entfernt db-data
docker compose up -d --build  # Migrationen + Seed laufen erneut
```

Pruefen (auf dem Docker-Host, nach `up`):

```bash
docker compose exec -T db psql -U postgres -d postgres -tAc \
  "select count(*) from public.categories"      # 13
docker compose exec -T db psql -U postgres -d postgres -tAc \
  "select count(*) from public.category_rules"  # 389
```

Alternativ mit der Supabase CLI: `supabase db reset`. Die CLI liest
`supabase/config.toml` (`project_id`, `[db.seed] enabled = true`,
`sql_paths = ["./seed.sql"]`) und spielt Migrationen + Seed in eine lokale
Dev-Datenbank. Auch dieser Weg benoetigt eine laufende Docker-Engine.

**Nachweis (lokale Verifikation, echter Output):** In der
Entwicklungsumgebung dieser Welle lief kein Docker-Daemon; derselbe SQL-Pfad
(Bootstrap + Migration 001/002 + Seed) wurde daher gegen ein portables
PostgreSQL 18.4 mit Supabase-Kompatibilitaets-Shim ausgefuehrt. Ergebnis:

```text
categories=13  category_rules=389  global_categories=13
categories=13  category_rules=389  (nach zweitem Seed-Lauf, idempotent)
```

Der Compose-/CLI-Lauf selbst (`docker compose up`, `supabase db reset`) ist in
dieser Umgebung nicht ausfuehrbar und muss auf einem Docker-Host nachgeholt
werden. Details in [`docs/DECISIONS.md`](./docs/DECISIONS.md).

### HTTPS / Caddy

Variante A ist umgesetzt: eigenes Caddy-Image per `xcaddy` mit
`github.com/caddy-dns/lego-deprecated`; Details und Fallback Variante B stehen
in [`caddy/README.md`](./caddy/README.md). Fuer die DNS-01-Challenge muss kein
Port 80/443 von aussen offen sein; Port 443 wird fuer den App-Zugriff
veroeffentlicht. `DOMAIN` muss per A-/AAAA-Record auf die Server-IP zeigen
(private IP ist fuer Heimnetz-Betrieb zulaessig).

**Renewal-Test** (auf dem Docker-Host, nach erfolgreichem Start):

```bash
docker compose logs caddy | grep -i "certificate obtained"
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## Backup

```bash
bash scripts/backup.sh
```

Erzeugt `backups/einkaufszettel-<UTC-Zeitstempel>.sql.gz` (Exit 0, Datei > 0
Byte). Cron-Beispiel: [`scripts/backup.cron.example`](./scripts/backup.cron.example)
(täglich 03:17 UTC). Restore-Test gehoert zu T5.4.

## Nuetzliche Befehle

```bash
pnpm lint          # ESLint + Prettier-Check (Code/Config)
pnpm typecheck     # TypeScript strict (Root + Workspaces)
pnpm test          # Vitest
pnpm build         # Next.js-Build (Workspaces mit Build-Script)
docker compose config -q   # Compose-Datei validieren
docker compose logs -f web caddy
```
