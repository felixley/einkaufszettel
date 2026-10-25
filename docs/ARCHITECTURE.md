# ARCHITECTURE — Einkaufszettel

Dieses Dokument beschreibt den Aufbau des Systems und verweist für alle
fachlichen und technischen Festlegungen maßgeblich auf [`PLAN.md`](../PLAN.md).
Es trifft **keine eigenen Produktentscheidungen** und darf `PLAN.md` nicht
widersprechen; bei Abweichungen gilt `PLAN.md`.

## 1. Systemüberblick

Kollaborative, **local-first** Einkaufsliste. Der Client ist die primäre
Datenquelle (Offline-Fähigkeit), der Server synchronisiert und löst Konflikte.
Ausgangspunkt ist ein Monorepo (pnpm Workspaces) mit einer Next.js-App, einem
geteilten Core-Paket und einer self-hosted Supabase-Instanz hinter Caddy.

Verweise auf `PLAN.md`:

| Thema                                               | PLAN.md |
| --------------------------------------------------- | ------- |
| Datenmodell (Tabellen, IDs, Soft-Delete)            | §4.1    |
| Sync-Strategie (Outbox, LWW, RPC `add_to_list`)     | §4.2    |
| Einheiten (Dimensionen, Konvertierung, Aggregation) | §4.3    |
| Kategorien v1 (13 Kategorien, Regeln)               | §4.4    |
| Sicherheit (RLS, Invite-Tokens, Rate-Limiting)      | §4.5    |
| Tech-Stack im Überblick                             | §3      |
| Phasen & Akzeptanzkriterien                         | §5      |

## 2. Komponenten

### 2.1 Client (`apps/web`)

- **Next.js** (App Router) als einzige Web-Anwendung; rendert Liste, Rezepte und
  Import-Dialog. `/health` liefert `{"status":"ok"}` für Healthchecks.
- **Persistenz:** Dexie (IndexedDB) ist die lokale Wahrheit. Alle Lesevorgänge
  der UI laufen gegen Dexie (`liveQuery`), nicht direkt gegen den Server.
- **Schreibpfad:** Mutation → Dexie → Outbox-Eintrag
  (`{id, table, op, payload, client_ts, attempts}`) → Sync-Worker.
- **Sync-Worker:** spielt die Outbox idempotent ab (Upsert per UUID) bei
  Reconnect, Fensterfokus und alle 30 s. Realtime-Events aktualisieren Dexie.
- **Konfliktregeln:** feldweises LWW über `updated_at` (Server-Zeit gewinnt bei
  Gleichstand); `checked` ist idempotent; Delete gewinnt gegen Edit. Die
  Mengen-Aggregation läuft serverseitig über die RPC `add_to_list`, damit
  parallele „Auf die Liste“-Aktionen nicht überschreiben (PLAN.md §4.2).
- **Validierung:** Zod an den Systemgrenzen; State über TanStack Query + Dexie.

### 2.2 Shared Core (`packages/core`)

- Framework-freie Logik, die Client und Tests teilen: Einheiten-Parser,
  Konverter, Formatter, Aggregator (PLAN.md §4.3), Kategorisierungsregeln
  (PLAN.md §4.4) und Normalisierung von Artikelnamen.
- Wird in Phase 2/3 ausgebaut; in Welle 1 nur als Paket-Skelett vorhanden.

### 2.3 Backend (self-hosted Supabase)

Bewusst reduzierter Stack (kein Studio, Kong, Realtime, Storage in Welle 1):

| Dienst | Image                           | Zweck                                                   |
| ------ | ------------------------------- | ------------------------------------------------------- |
| `db`   | `supabase/postgres:15.19.0.007` | Postgres mit Supabase-Rollen/Schemas, Migrationen, Seed |
| `auth` | `supabase/gotrue:v2.197.0`      | Auth-API unter `/auth/v1/*`                             |
| `rest` | `postgrest/postgrest:v16.5`     | REST-API unter `/rest/v1/*`                             |

- **Datenhaltung:** Schema aus PLAN.md §4.1 (10 Tabellen inkl. `profiles`,
  `households`, `household_members`, `invites`, `lists`, `list_items`,
  `categories`, `category_rules`, `recipes`, `recipe_ingredients`).
- **IDs:** clientseitig generierte UUIDv7 (offline-Erstellung); `created_at`,
  `updated_at`, `deleted_at` auf allen Tabellen, `updated_at` per Trigger.
- **Sicherheit:** RLS auf allen Tabellen (PLAN.md §4.5) — Sichtbarkeit nur für
  Mitglieder, Schreiben nur Owner/Editor, Rollenverwaltung nur Owner.
  Invite-Tokens nur als Hash gespeichert, mit Ablauf/Widerruf und Einlösung per
  RPC. Rate-Limiting für Login/Invites über Caddy.
- **Migrationen & Seed:** `supabase/migrations/*.sql` (Schema, RLS, Trigger,
  Indizes) werden beim ersten DB-Start über den
  `/docker-entrypoint-initdb.d`-Bind-Mount eingespielt; `supabase/seed.sql`
  liefert die 13 Kategorien und Keyword-Regeln (PLAN.md §4.4).
- **Realtime** (Phase 2): für Sync-Events ergänzt; in Welle 1 noch nicht im
  Compose-Stack.

### 2.4 Edge / TLS (`caddy`)

- Eigenes Caddy-Image (`xcaddy build` mit `github.com/caddy-dns/lego-deprecated`),
  TLS per **Let's Encrypt DNS-01** über ipv64.net (`IPV64_API_KEY`). Damit ist
  kein offener Port 80/443 für die Challenge nötig; Port 443 wird nur für den
  App-Zugriff veröffentlicht. Fallback Variante B (lego-Container + Volume) ist
  in `caddy/README.md` und `docs/DECISIONS.md` dokumentiert.
- **Routing** (siehe `caddy/Caddyfile`): `/rest/v1/*` → `rest:3000`,
  `/auth/v1/*` → `auth:9999`, alles andere → `web:3000`.

## 3. Deployment

- **Docker Compose** orchestriert `db`, `auth`, `rest`, `web`, `caddy`; `web` und
  `caddy` hängen von den Backend-Diensten ab. Nur Caddy veröffentlicht Port 443
  nach außen; die übrigen Dienste bleiben im Compose-Netz.
- **Konfiguration** ausschließlich über `.env` (Vorlage `.env.example`):
  `DOMAIN`, `ACME_EMAIL`, `IPV64_API_KEY`, `POSTGRES_PASSWORD`, `JWT_SECRET`,
  `ANON_KEY`, `SERVICE_ROLE_KEY`. Keine Secrets im Repo.
- **Start:** `docker compose up -d --build`; Healthcheck über
  `https://${DOMAIN}/health`. Details in `README.md` (max. 5 Schritte).
- **Backup:** `scripts/backup.sh` erzeugt ein gzip-komprimiertes `pg_dump`;
  Cron-Beispiel in `scripts/backup.cron.example`, `backups/` ist gitignored.
- **CI:** GitHub Actions führt lint, typecheck, test und build aus (Workflow
  deckt `main` und `master` ab; das Repo verwendet `master`).

## 4. Grenzen dieser Welle (Welle 1)

- Kein Produktivcode für Listen-UI/Rezepte; `apps/web` ist ein
  Infrastruktur-Platzhalter (`/` und `/health`).
- `recipes`/`recipe_ingredients` werden bereits migriert, aber erst in Phase 3
  bebaut (PLAN.md §3/§5).
- Der Laufzeitnachweis des Compose-/HTTPS-Stacks (T1.3) ist in Umgebungen ohne
  Docker-Daemon nicht möglich und muss auf einem Docker-Host nachgeholt werden.
