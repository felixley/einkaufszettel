# HANDOFF

Welle 1 = **Phase 1 (Fundament & Infrastruktur)** aus `PLAN.md` §5. Maßgeblich ist die
vom Product Owner aktualisierte Fassung von `PLAN.md` (Commit „Aktualisieren von
PLAN.md“); sie ersetzt den früheren Entwurf. Jede Aufgabe hat ein Akzeptanzkriterium (AK)
direkt in `PLAN.md` §5; hier stehen nur die profilspezifischen Aufträge.

**Format je Auftrag**
`Ziel | Akzeptanzkriterium | Betroffene Pfade | Constraints | Abhängigkeiten | Offene Fragen`

**Wellen-Regel:** Genau ein Profil pro Aufgabe. DevOps (T1.1–T1.3, T1.7) läuft vor bzw.
parallel zu Backend (T1.4, T1.5); Doku T1.6 liegt beim architect und beim frontend.
Danach 🛑 **Human Gate 1** (Schema, RLS-Konzept, Wireframes freigeben) — QA unterstützt
die Abnahme, entscheidet aber nicht.

> **Achtung, Planwechsel:** Die bereits angelegten Kanban-Karten `t_129c433d` (devops),
> `t_ebc6addd` (backend), `t_adcb479b` (frontend), `t_2f8b0143` (core) und `t_8c46ba0e`
> (QA) wurden auf Basis der **alten** Planfassung geschnitten (u. a. `npm` statt `pnpm`,
> Tabelle `items` statt `list_items`, PWA ohne HTTPS/Caddy, ein Zettel statt Haushalte).
> Sie sind inhaltlich überholt. Vor Start müssen sie auf die unten genannten T1.x-Aufträge
> umgeschnitten werden; der Karten-Body allein ist **nicht** maßgeblich. Core hat in
> Phase 1 keine Aufgabe.

---

## Welle 1 — DevOps (`devops`) · Karte `t_129c433d` (neu zu schneiden)

### T1.1 Monorepo + Tooling
- **Ziel:** pnpm-Workspace-Monorepo mit `apps/web`, `packages/core`, `supabase/`;
  TypeScript strict, ESLint, Prettier, Vitest, Husky.
- **Akzeptanzkriterium:** `pnpm lint && pnpm typecheck && pnpm test` läuft grün (frischer
  Checkout, Output im Commit dokumentiert).
- **Betroffene Pfade:** `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
  ESLint-/Prettier-Konfig, `tsconfig.base.json`, `.husky/`, `vitest.config.*`,
  `apps/web/package.json`, `packages/core/package.json`.
- **Constraints:** Kein Anwendungscode (keine Fachlogik, keine UI, keine Migrationen).
  Keine Secrets. Node-/pnpm-Version pinnen (`packageManager`, `.nvmrc`).
- **Abhängigkeiten:** Keine; muss vor T1.2–T1.7 laufen.
- **Offene Fragen:** pnpm-Version — Entscheidung: `packageManager` auf pnpm 9 pinnen.

### T1.2 CI
- **Ziel:** GitHub Actions CI mit lint, typecheck, test, build.
- **Akzeptanzkriterium:** Pipeline grün auf `master`; YAML lokal via `actionlint`
  geprüft (Output im Review).
- **Betroffene Pfade:** `.github/workflows/`.
- **Constraints:** Keine Deploy-Schritte auf Produktion; keine Secrets außer
  `GITHUB_TOKEN`; pnpm-Caching.
- **Abhängigkeiten:** T1.1.
- **Offene Fragen:** Keine.

### T1.3 Docker Compose + HTTPS (Caddy, ipv64 DNS-01)
- **Ziel:** Compose-Stack aus reduziertem self-hosted Supabase, Next.js und Caddy mit
  HTTPS über ipv64.net (DNS-01); Healthcheck.
- **Akzeptanzkriterium:** `docker compose up` startet alles; App unter
  `https://<name>.ipv64.net` mit gültigem Zertifikat erreichbar; `/health` antwortet.
- **Betroffene Pfade:** `docker-compose.yml`, `Caddyfile` bzw. `caddy/`, `scripts/`,
  `.env.example`.
- **Constraints:** `IPV64_API_KEY` nur in `.env` (gitignored), Platzhalter in
  `.env.example`. Supabase-Versionen pinnen. Variante A (eigenes Caddy-Image,
  `xcaddy build --with github.com/caddy-dns/lego-deprecated`) bevorzugt; Variante B
  (lego-Container + Zertifikats-Volume) als Fallback. Kein offener Port 80/443 nötig.
  Zerstörerische Befehle nur nach Freigabe.
- **Abhängigkeiten:** T1.1 (Compose referenziert Workspace/Web-Image).
- **Offene Fragen:** DNS-Name und Ziel-IP (öffentlich vs. privat) vom PO vorzugeben;
  Renewal-Dry-Run dokumentieren.

### T1.7 Setup-Doku, `.env.example`, Backup
- **Ziel:** README-Setup in max. 5 Schritten, `.env.example`, `scripts/backup.sh` +
  Cron-Beispiel.
- **Akzeptanzkriterium:** Frischer Checkout startet anhand README in ≤ 5 Schritten;
  `bash scripts/backup.sh` erzeugt ein `pg_dump`-Archiv (Exit 0, Datei > 0 Byte).
- **Betroffene Pfade:** `README.md`, `.env.example`, `scripts/backup.sh`, ggf. Eintrag in
  `docs/DECISIONS.md`.
- **Constraints:** Keine Secrets; Backup-Skript ohne destruktive Schritte. Restore-Test
  gehört zu T5.4, nicht hierher.
- **Abhängigkeiten:** T1.3 (Datenbankdienst vorhanden).
- **Offene Fragen:** Backup-Ziel — Default `./backups/` (gitignored).

## Welle 1 — Backend (`backend`) · Karte `t_ebc6addd` (neu zu schneiden)

### T1.4 Migrationen Datenmodell + RLS
- **Ziel:** Migrationen für das Datenmodell aus `PLAN.md` §4.1 (profiles, households,
  household_members, invites, lists, list_items, categories, category_rules, recipes,
  recipe_ingredients) inkl. Trigger, Indizes und RLS-Policies.
- **Akzeptanzkriterium:** pgTAP-Tests belegen: Nichtmitglied sieht nichts; Viewer kann
  nicht schreiben; Editor kann Items ändern; nur Owner verwaltet Mitglieder. Alle IDs
  clientseitig UUIDv7; `updated_at` per Trigger; `deleted_at` statt physischem DELETE.
- **Betroffene Pfade:** `supabase/migrations/`, `supabase/tests/` (pgTAP).
- **Constraints:** Nur Migrationen/Tests; kein Frontend, kein `packages/core`. Keine
  manuellen Studio-Änderungen. Keine Secrets.
- **Abhängigkeiten:** T1.1 (Projektstruktur); fachlich keine.
- **Offene Fragen:** `unit_enum`-Werte = Taxonomie aus §4.3 (g, kg, ml, l, TL, EL, Stk,
  Bund, Dose, Packung, Zehe, Prise, n. B.) — Abweichung nur mit PO klären.

### T1.5 Seed
- **Ziel:** Seed für Kategorien (§4.4), Keyword-Regeln (≈ 300 deutsche Begriffe) und
  Einheiten.
- **Akzeptanzkriterium:** `supabase db reset` liefert lauffähige Basisdaten; Zählabfrage
  ergibt 13 Kategorien und > 0 Regeln; Seed ist idempotent (zweiter Reset ohne Duplikate).
- **Betroffene Pfade:** `supabase/seed.sql` bzw. `supabase/migrations/`.
- **Constraints:** Nur Seed/SQL; keine App-Logik. Deutsche Keywords, keine Secrets.
- **Abhängigkeiten:** T1.4 (Tabellen vorhanden).
- **Offene Fragen:** Keyword-Liste startet kuratiert; PO kann erweitern.

## Welle 1 — Architect (`architect`, Selbstauftrag)

### T1.6a Architektur- und Entscheidungsdoku
- **Ziel:** `docs/ARCHITECTURE.md` und `docs/DECISIONS.md` (u. a. Caddy-Variante A/B,
  LWW-Sync, Einheiten-Taxonomie).
- **Akzeptanzkriterium:** Beide Dateien existieren, verweisen auf `PLAN.md` §4 und halten
  je Entscheidung Datum, Begründung und Alternative fest; keine Widersprüche zu `PLAN.md`.
- **Betroffene Pfade:** `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`.
- **Constraints:** Kein Produktivcode; keine Änderung an `PLAN.md`.
- **Abhängigkeiten:** Keine.
- **Offene Fragen:** Keine.

## Welle 1 — Frontend (`frontend`) · Karte `t_adcb479b` (neu zu schneiden)

### T1.6b Wireframes
- **Ziel:** Low-Fi-Skizzen für Liste, Rezept und Import-Dialog in `docs/wireframes.md`.
- **Akzeptanzkriterium:** Drei Skizzen mit Beschriftung der Kerninteraktionen
  (Hinzufügen ≤ 2 Taps, Abhaken, Import-Vorschau); im Human Gate 1 vorzeigbar.
- **Betroffene Pfade:** `docs/wireframes.md` (nur dieses Dokument; keine App-Dateien).
- **Constraints:** Reine Doku/ASCII-Skizzen; kein App-Code in dieser Aufgabe. App-Scaffold
  (Next.js) gehört zu T1.1/T2.x, nicht hierher.
- **Abhängigkeiten:** Keine.
- **Offene Fragen:** Keine.

## Welle 1 — Core (`core`) · Karte `t_2f8b0143` (in Phase 1 nicht einplanen)

- **Status:** **Keine Welle-1-Aufgabe.** Phase 1 enthält keine Core-Fachlogik. Erste
  Core-Arbeit ist T2.7 (Auto-Kategorisierung, Phase 2) bzw. T3.1 (Einheiten-Parser,
  Phase 3). Die bestehende Karte ist auf die alte Planfassung geschnitten und sollte
  zurückgezogen oder auf T2.7/T3.1 umgeschrieben werden.
- **Constraint:** Nicht vorzeitig mit Einheiten/Aggregation beginnen — Phase 1 liefert
  zuerst Schema, Seed und Infrastruktur; die Einheiten-Taxonomie steht in `PLAN.md` §4.3.

## Welle 1 — QA (`qa`) · Karte `t_8c46ba0e` (neu zu schneiden)

- **Ziel:** Abnahme Phase 1 (T1.1–T1.7) gegen die AKs in `PLAN.md` §5; Vorbereitung von
  Human Gate 1.
- **Akzeptanzkriterium:** `docs/REVIEW.md` enthält je T1.x ein Urteil
  „bestanden“/„nicht bestanden“ mit Begründung und echtem Test-Output; kritische Befunde
  als Kommentar an der jeweiligen Aufgabe; Human-Gate-1-Checkliste (Schema, RLS-Konzept,
  Wireframes) mit Befund.
- **Betroffene Pfade:** `docs/REVIEW.md`, Kanban-Kommentare; lesend alles.
- **Constraints:** Nie Produktivcode; kein Commit an Produktivpfaden. Kein Urteil über
  Produktentscheidungen (die liegen beim PO).
- **Abhängigkeiten:** T1.1–T1.7 auf `done`.
- **Offene Fragen:** Keine.

---

**Nächster Schritt:** Karten neu schneiden (Orchestrator/PO), dann T1.1 starten.
Rückmeldung an architect: Commit-Hash, erfüllte T1.x/AK, offene Punkte.
