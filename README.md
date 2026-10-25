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
Phase 2 (Sync/Realtime) wird der Stack erweitert. Migrationen werden beim
ersten DB-Start aus `supabase/migrations/` eingespielt (Bind-Mount nach
`/docker-entrypoint-initdb.d`).

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
