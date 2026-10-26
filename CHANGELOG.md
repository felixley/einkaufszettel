# Changelog

Alle nennenswerten Änderungen an diesem Projekt. Format angelehnt an
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/); die Versionierung
folgt [Semantic Versioning](https://semver.org/lang/de/).

Maßgeblich bleibt [`PLAN.md`](./PLAN.md). Release-Nachweise sind in
[`docs/REVIEW.md`](./docs/REVIEW.md) (QA-Abnahmen Wellen 1–5) und den
`docs/TESTLOG-*.md` dokumentiert.

## [1.0.0] — 2026-10-26

Erstes Release. Die Phasen 1–4 sind umgesetzt und von QA abgenommen; Phase 5
liefert CI, Lasttest, Security-Baseline und Betrieb. Der Stack läuft
self-hosted auf einem Docker-Homeserver (Supabase-Teilmenge + Next.js-PWA +
Caddy/HTTPS).

### Added — Phase 1: Fundament & Infrastruktur

- **Monorepo** (`pnpm`-Workspace `apps/*`, `packages/*`) mit TypeScript strict,
  ESLint 9 (flat config), Prettier, Vitest, Husky + lint-staged; Node 22
  (`.nvmrc`), pnpm 9.15.4 gepinnt.
- **CI** (`.github/workflows/ci.yml`): Lint, Typecheck, Security-Konfigcheck,
  Tests und Build auf jedem Push auf `master`/`main` und auf Pull Requests.
- **Docker Compose** (`docker-compose.yml`): self-hosted Supabase-Teilmenge
  (`supabase/postgres` inkl. Supabase-Rollen/Schemas, `supabase/gotrue`,
  `postgrest/postgrest`) plus Next.js-App und Caddy als Reverse Proxy mit
  TLS über **ipv64.net per DNS-01-Challenge** (kein offener Port 80/443 nötig).
  Alle Images auf feste Tags gepinnt (kein `latest`).
- **Datenmodell + RLS**: Migrationen für `profiles`, `households`,
  `household_members`, `invites`, `lists`, `list_items`, `categories`,
  `category_rules`, `recipes`, `recipe_ingredients` — UUIDv7, Soft-Delete,
  `updated_at`-Trigger, Indizes und vollständige Row-Level-Security.
- **Seed**: 13 globale Kategorien und 389 Keyword-Regeln, idempotent, in
  Compose (Init-Skript `zz_seed.sql`) und Supabase-CLI (`supabase db reset`)
  verdrahtet.
- **Doku**: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/wireframes.md`,
  `.env.example` und Setup-Anleitung in der `README`.

### Added — Phase 2 (MVP): Kollaborative Liste, local-first

- **Auth**: Registrierung, Login, Logout, Passwort-Reset, geschützte Routen;
  `profiles`-Zeile wird per DB-Trigger synchron zu `auth.users` angelegt.
- **Haushalte und Listen**: Haushalt anlegen, Standardliste, Listen-CRUD;
  Nichtmitglieder sehen fremde Haushalte weder in der Liste noch in der
  Detailansicht (RLS + E2E mit zwei Browser-Kontexten).
- **Einladungen**: Link **und** QR-Code, Rollenwahl (`owner`/`editor`/`viewer`),
  Widerruf und Ablauf; Token nur als Hash gespeichert.
- **Mitgliederverwaltung**: Rolle ändern, entfernen, Haushalt verlassen; der
  letzte Owner kann nicht austreten.
- **Offline-First-Sync**: Dexie-Datenschicht, Outbox, Sync-Worker,
  Realtime-Anbindung; feldweises LWW, Delete-gewinnt bei Edit-vs-Delete,
  idempotentes Outbox-Replay (kein Duplikat).
- **Listen-UI**: Hinzufügen, Bearbeiten, Löschen mit Undo, Abhaken,
  Gruppierung nach Kategorien (abgehakte Artikel unten).
- **Auto-Kategorisierung** (regelbasiert, `packages/core`) inkl. Lernen aus
  manueller Korrektur; Trefferquote **97,1 %** auf dem Seed-Testset (Anspruch
  ≥ 85 %).
- **Duplikat-Zusammenfassung** beim Hinzufügen: gleicher Name + gleiche
  Dimension addieren die Menge mit Hinweis, abweichende Dimension ergibt eine
  eigene Zeile.

### Added — Phase 3: Rezepte & Smart-Import

- **Einheiten-Logik** in `packages/core/units`: Parser („250 g“, „1,5 EL“,
  „½ TL“, „2 1/2 Stk“, „1 Prise“), Konverter, Formatter und Aggregator;
  nicht konvertierbare Einheiten ergeben eine eigene Zeile.
- **Rezept-CRUD**: anlegen, bearbeiten, löschen (mit Undo), Tags und Suche —
  vollständig offline-fähig über dieselbe Dexie-/Outbox-Schicht.
- **Portionsrechner**: Skalierung und sinnvolle Rundung (Masse/Volumen 1 g/ml,
  Stück 0,5).
- **„Auf die Einkaufsliste“**: Vorschau-Dialog mit Zutaten-Checkboxen,
  Portionswahl, Hinweis „bereits auf Liste (+Menge)“; Übertragung über die
  serverseitige RPC `add_to_list` (`SECURITY INVOKER`) mit Idempotenz-Ledger
  und gesetztem `source_recipe_id`.

### Added — Phase 4: PWA, Offline-Härtung & UX

- **PWA-Grundlage**: Web-App-Manifest (Next.js Metadata-Route), Icons
  (inkl. maskable) und Apple-Touch-Icon, Service Worker mit App-Shell-Cache und
  Stale-While-Revalidate für Assets, Install-Prompt; Lighthouse-PWA-Score 1.
- **Offline-Tests**: Playwright mit `context.setOffline(true)` — Szenarien
  „Supermarkt ohne Netz“ und „zwei Geräte offline, dann online“ inkl.
  Reconnect-Sync ohne Datenverlust.
- **Fehlerbehandlung im Sync**: Zustände synced/pending/syncing/offline/error,
  Retry mit Backoff und Dead-Letter-Panel mit „Erneut versuchen“/„Verwerfen“.
- **UI-Polish**: responsive Layout, Dark Mode (System **und** persistenter
  Toggle), Micro-Interactions, leere Zustände, Skeletons.
- **Mobile-Ergonomie**: Touch-Ziele ≥ 44 px, Eingabefeld unten erreichbar,
  schnelles Hinzufügen (Enter bleibt im Feld, Verlauf-Autovervollständigung),
  Swipe zum Abhaken/Löschen.
- **Barrierefreiheit-Basis**: Kontrast, Fokus, Labels; axe-Check in CI mit
  0 serious/critical auf Login, Liste, Rezepte und Haushalt.

### Added — Phase 5: Test, Betrieb & Go-Live

- **E2E-Suite in CI** über vier Playwright-Projekte (`chromium`,
  `mobile-chromium`, `webkit`, `mobile-webkit`/iPhone-Emulation); Chromium
  **68/68** grün in der Sandbox, WebKit-Lauf auf CI/Host.
- **Lasttest**: `perf/k6-sync.js` (10 Haushalte × 5 gleichzeitige Nutzer,
  50 VUs, Threshold p95 < 1 s); Lauf gegen den Mock-Sync-Stack
  **p95 92,3 ms, 0 % Fehler** (`docs/PERF.md`).
- **Security-Baseline**: CSP, HSTS, X-Frame-Options/`frame-ancestors`,
  Referrer-/Permissions-Policy, nosniff; Rate-Limit-Zonen für `/auth/v1/*`
  (20/min), `add_to_list` (60/min) und Invite-RPCs (10/min);
  Dependency-Audit mit **0 Vulnerabilities**; statischer Konfigcheck
  (`scripts/check-security-config.mjs`, 26/26) in CI.
- **RLS-Abdeckung**: Matrix aller Tabellen × Operationen × RPCs
  (`docs/SECURITY-RLS-COVERAGE.md`), pgTAP-Gesamtlauf **350 Assertions** grün.
- **Betrieb**: Backup-Skript mit Integritätsprüfung (gzip + SHA-256-Sidecar)
  und Retention 14 Tage, **getesteter Restore** (`restore.sh`,
  `test-restore.sh` — real 37/37 bit-genau, plus Stub- und Dry-Run-Modus),
  Update- und Rollback-Prozedur, Healthchecks je Dienst, Logrotation im
  Compose-File, optionales Monitoring per Compose-Profil (`uptime-kuma`) und
  Zertifikats-Ablaufcheck. Betriebsrunbook: `docs/OPERATIONS.md`,
  Startanleitung: `DEPLOY.md`.
- **Changelog und Release-Doku** (diese Datei, `DEPLOY.md`).

### Changed

- Version des Monorepos und der Workspaces auf `1.0.0` gesetzt (vorher
  `0.0.0`).
- Markdown-Formatierung vereinheitlicht (Review-Befund D12): `docs/TESTLOG-T2.2.md`,
  `docs/TESTLOG-T3.2.md` und `docs/wireframes.md` sind jetzt prettier-konform.
- `apps/web/app/favicon.ico` als reguläres Asset aufgenommen (Review-Befund D20):
  gültiger ICO-Container mit 32×32-PNG, den Next.js automatisch unter
  `/favicon.ico` ausliefert.

### Bekannte offene Punkte

Nicht release-blockierend, in `docs/REVIEW.md` und `PLAN.md` Anhang D.5 geführt.
Sie betreffen ausschließlich **Nachweise auf einem Docker-/Host-System**, die in
der Entwicklungs-Sandbox ohne Docker-Daemon nicht erbracht werden können:

- **T1.3/D14 — Laufzeitnachweis des Compose-/HTTPS-Stacks**: `docker compose up`,
  `caddy validate`, echte Security-Header (`curl -I`) und 429-Verhalten,
  gültiges Let's-Encrypt-Zertifikat inkl. Renewal-Dry-Run sowie ein
  Ende-zu-Ende-Lauf gegen PostgREST/Realtime.
- **WebKit-Laufzeitnachweis**: Die Projekte `webkit`/`mobile-webkit` sind
  konfiguriert und per `--list` validiert; der echte Lauf scheitert in der
  Sandbox an fehlenden Systembibliotheken und ist auf CI/Host nachzuholen.
- **Restore gegen den echten Compose-Stack** (in der Sandbox nur gegen
  portables PostgreSQL bzw. im Stub-/Dry-Run-Modus belegt).
- **T5.5 — Dogfooding**: Die zweiwöchige Nutzung im eigenen Haushalt beginnt
  **nach** diesem Release; Anleitung und Feedback-Vorlage liegen in
  `docs/DOGFOODING.md` und `docs/FEEDBACK.md`, die Bugfix-Runde folgt danach.
- **D16** Zwei-Nutzer-Haushalts-E2E, **D19** axe-Abdeckung des
  Dead-Letter-Dialogs, **D22** Dry-Run-Reihenfolge in `restore.sh`.
- **Nicht in v1** (siehe `docs/BACKLOG.md`): Social-Login, Rezeptimport per URL,
  Barcode-Scan, Push-Benachrichtigungen, KI-Kategorisierung, native Apps,
  Preisvergleich und die Vorratsliste „Zutaten, die ich schon habe“ (T3.5).
