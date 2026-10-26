# DEPLOY — Einkaufszettel v1.0.0 auf dem Homeserver

Kurze Startanleitung für den Docker-Homeserver. Sie beschreibt **nur den
Erststart**; Update, Rollback, Backup/Restore im Detail, Monitoring, Logrotation
und Notfälle stehen im Betriebsrunbook [`docs/OPERATIONS.md`](./docs/OPERATIONS.md).
Maßgeblich ist [`PLAN.md`](./PLAN.md); Architektur in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

> **Sandbox-Hinweis:** Diese Anleitung ist dokumentiert, aber **auf dem
> Homeserver noch nicht durchgelaufen** — in der Entwicklungs-Sandbox gibt es
> keinen Docker-Daemon. Die Nachweise aus Abschnitt 7 sind beim Erststart zu
> erbringen (offener Punkt T1.3/D14).

## 1. Voraussetzungen

- Docker Engine mit Compose-Plugin (**v2**; Compose-Standalone v5.6.1 wurde in
  der Sandbox für `docker compose config -q` genutzt).
- `git`, sowie `node` ≥ 22 nur für die Schlüsselerzeugung und die Skripte.
- Eine (Sub-)Domain bei **ipv64.net** — `DOMAIN` muss per A-/AAAA-Record auf die
  Server-IP zeigen. Für reinen Heimnetz-Betrieb darf das die **private** IP
  sein; das Let's-Encrypt-Zertifikat kommt über die DNS-01-Challenge und
  braucht dafür keinen offenen Port 80. Für Zugriff von unterwegs zusätzlich
  Port `HTTPS_PORT` (Default 443) freigeben oder VPN (WireGuard/Tailscale)
  nutzen.
- API-Key für ipv64.net (`IPV64_API_KEY`).
- Auf dem Host freier Platz für `db-data`, `caddy-data` und `backups/`.

## 2. Release holen

```bash
git clone https://github.com/felixley/einkaufszettel.git /opt/einkaufszettel
cd /opt/einkaufszettel
git checkout v1.0.0          # Release-Tag
git rev-parse HEAD           # Commit-Hash für das Betriebsprotokoll notieren
```

## 3. `.env` anlegen (Secrets bleiben außerhalb des Repos)

```bash
cp .env.example .env
node scripts/generate-supabase-keys.mjs | tee -a .env
```

Danach in `.env` die Platzhalter ersetzen. Pflichtwerte für den Compose-Start:

| Variable            | Zweck                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| `DOMAIN`            | DNS-Name bei ipv64.net; wird von Caddy, GoTrue und der App verwendet.             |
| `ACME_EMAIL`        | Kontaktadresse für Let's Encrypt.                                                 |
| `HTTPS_PORT`        | Host-Port für HTTPS (Default 443).                                                |
| `POSTGRES_PASSWORD` | Passwort des Postgres-Superusers (stark, einzigartig).                            |
| `JWT_SECRET`        | Mindestens 32 Zeichen; von GoTrue und PostgREST geteilt.                          |
| `ANON_KEY`          | Vom Key-Generator erzeugt; landet als `NEXT_PUBLIC_SUPABASE_ANON_KEY` in der App. |
| `IPV64_API_KEY`     | Nur für die DNS-01-Challenge durch Caddy.                                         |

`SERVICE_ROLE_KEY` und `POSTGRES_DB` haben sinnvolle Defaults, gehören aber
ebenfalls in die `.env`. Die `NEXT_PUBLIC_*`-Variablen sind **nur für lokale
Entwicklung** relevant: im Compose-Stack setzt `docker-compose.yml` die
App-URL aus `DOMAIN` und den Anon-Key aus `ANON_KEY` selbst.
`NEXT_PUBLIC_AUTH_MOCK` muss im Betrieb **leer/`false`** bleiben — der
Mock-Adapter ist keine Authentifizierung.

**Secret-Hygiene:** `.env` ist gitignored, nie ins Repo, nie in Logs, nie in
Commit-Nachrichten. Rechte einschränken: `chmod 600 .env`.

## 4. Stack starten

```bash
docker compose up -d --build
docker compose ps                 # alle Dienste, web und caddy müssen (healthy) sein
docker compose logs --since 5m auth rest web caddy
```

Beim **ersten** Start auf leerem Volume spielt Postgres automatisch die
Migrationen (`supabase/migrations/`) und danach den Seed
(`supabase/seed.sql` als `zz_seed.sql`) ein. Kontrolle:

```bash
docker compose exec -T db psql -U postgres -d postgres -tAc \
  "select count(*) from public.categories"      # 13
docker compose exec -T db psql -U postgres -d postgres -tAc \
  "select count(*) from public.category_rules"  # 389
```

Die Init-Skripte laufen nur bei leerem Datenvolume. Nach Änderungen an Schema
oder Seed deshalb `docker compose down -v && docker compose up -d --build`
(entfernt die Dev-Daten).

## 5. HTTPS und Health prüfen

```bash
curl -fsS "https://${DOMAIN}/health"        # {"status":"ok"}
docker compose logs caddy | grep -i "certificate obtained"
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
```

`curl` muss ein gültiges Zertifikat sehen (kein `-k`). Erwartete Security-Header
sind in [`docs/SECURITY.md`](./docs/SECURITY.md) beschrieben, die Rate-Limits in
`caddy/Caddyfile` (Zonen `auth_ip`, `add_to_list_ip`, `invite_ip`).

## 6. Backup-Cron und Monitoring

**Backup** (Cron-Beispiele: [`scripts/backup.cron.example`](./scripts/backup.cron.example)):

```bash
bash scripts/backup.sh                    # .sql.gz + SHA-256-Sidecar, Retention 14 Tage
bash scripts/test-restore.sh --mode auto  # wöchentlich: Restore-Test
```

Cron-Einträge auf den eigenen Checkout-Pfad anpassen (`/opt/einkaufszettel`):

```cron
17 3 * * * cd /opt/einkaufszettel && ./scripts/backup.sh >> ./backups/backup.log 2>&1
30 4 * * 0 cd /opt/einkaufszettel && ./scripts/test-restore.sh --mode auto >> ./backups/restore-test.log 2>&1
0  7 * * * cd /opt/einkaufszettel && DOMAIN=<domain> ./scripts/check-cert-expiry.sh "<domain>:443" >> ./backups/cert-check.log 2>&1
```

**Regel: Ein Backup ist erst fertig, wenn der Restore getestet wurde** — der
wöchentliche `test-restore.sh`-Lauf und ein Probe-Restore in eine Scratch-DB
gehören dazu (Runbook: `docs/OPERATIONS.md` §5).

**Monitoring** (optional, Compose-Profil `monitoring`, standardmäßig aus):

```bash
docker compose --profile monitoring up -d uptime-kuma
# UI: http://<host>:${UPTIME_KUMA_PORT:-3001}   (Erst-Einrichtung im Browser)
```

Mindestens _ein_ Alarmkanal (E-Mail/Telegram/Push) muss konfiguriert sein.
Checks und Alarmweg: `docs/OPERATIONS.md` §8.

## 7. Nachweise beim Erststart (in der Sandbox offen)

Diese Punkte konnten ohne Docker-Daemon nicht erbracht werden und sind beim
Erststart einmal zu protokollieren (mit Datum und Commit-Hash):

1. `docker compose up -d --build` → alle Dienste `healthy` (`docker compose ps`).
2. `docker compose --profile monitoring up -d` → sechster Dienst erreichbar.
3. `curl -fsS "https://${DOMAIN}/health"` → `{"status":"ok"}` mit gültigem
   Zertifikat; `curl -sI` zeigt CSP, HSTS, `X-Frame-Options`, `nosniff`.
4. Rate-Limit: wiederholte Login-Versuche über der Zone `auth_ip` (20/min)
   liefern **429**.
5. `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile`
   → Exit 0.
6. Restore-Test **gegen die echte Compose-DB** (`test-restore.sh --mode real`
   mit `PGHOST`/`DATABASE_URL` auf den `db`-Container) — nicht nur gegen das
   portable PostgreSQL.
7. Playwright-Suite inkl. WebKit-Projekten auf dem Host/CI:
   `pnpm --filter @einkaufszettel/web exec playwright install --with-deps chromium webkit`
   und `pnpm test:e2e`.
8. Ende-zu-Ende-Rauchtest mit zwei echten Konten (zwei Geräte, Einladung per
   Link/QR, Offline-Eingabe → Reconnect) — deckt D14/D16 ab.

## 8. Weiter

| Thema                            | Ort                              |
| -------------------------------- | -------------------------------- |
| Update / Rollback / Migrationen  | `docs/OPERATIONS.md` §1          |
| Healthchecks und `/health`       | `docs/OPERATIONS.md` §2          |
| Logrotation                      | `docs/OPERATIONS.md` §3          |
| Backup / Restore / Disaster      | `docs/OPERATIONS.md` §4–§6       |
| Zertifikatsablauf                | `docs/OPERATIONS.md` §7          |
| Monitoring und Alarmweg          | `docs/OPERATIONS.md` §8          |
| Notfall-Kurzreferenz             | `docs/OPERATIONS.md` §9          |
| Release-Umfang und offene Punkte | `CHANGELOG.md`, `docs/REVIEW.md` |
| Entwicklung (lokales Setup)      | `README.md`                      |
