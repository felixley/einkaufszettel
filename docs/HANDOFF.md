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

> **Status Planwechsel (geklärt):** Die fünf Kanban-Karten `t_129c433d` (devops),
> `t_ebc6addd` (backend), `t_adcb479b` (frontend), `t_2f8b0143` (core) und `t_8c46ba0e`
> (QA) wurden auf Basis der **alten** Planfassung geschnitten (u. a. `npm` statt `pnpm`,
> Tabelle `items` statt `list_items`, PWA ohne HTTPS/Caddy, ein Zettel statt Haushalte).
> **Der Karten-Body ist nicht maßgeblich** — maßgeblich sind der Auftrag unten und die
> AKs in `PLAN.md` §5. Die Re-Scopes stehen als Kommentar an der jeweiligen Karte:
> devops → T1.1/T1.2/T1.3/T1.7, backend → T1.4/T1.5, frontend → T1.6b,
> QA → Abnahme T1.1–T1.7. **Core (`t_2f8b0143`) hat in Phase 1 keine Aufgabe** und ist
> als „STOP — nicht starten“ markiert; erste Core-Arbeit ist T2.7 (Phase 2) bzw. T3.1. Der MVP-Slice ist in `PLAN.md`
> **Anhang A** definiert (Feature → testbares AK → Nachweis); Anhang A ist additiv und
> ändert §0–§7 nicht.

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

## Welle 2 — Backend (`backend`) · T2.2 Backend-Anteil (Liste/Haushalt)

### T2.2 Haushalt + Standardliste + Listen-CRUD (RPC/RLS)

- **Status Backend:** **fertig** (Migrationen + pgTAP). Der **UI-Anteil** (Onboarding-
  Dialog „Haushalt anlegen“, Listen-Umschalter, Undo nach Soft-Delete, E2E-Nachweis
  A-2 mit zwei Browser-Kontexten) liegt bei `frontend`; die Checkbox in `PLAN.md`
  bleibt deshalb offen, bis beide Anteile zusammen abgenommen sind.
- **Gelieferte Pfade:**
  - `supabase/migrations/20261025_003_rpc_household_lists.sql` — RPCs
    `create_household`, `ensure_default_list`, `create_list`, `rename_list`,
    `soft_delete_list`, `restore_list`, `list_lists`, `get_list`; interner
    Replay-Helfer im Schema `internal` (nicht per PostgREST exponiert).
  - `supabase/migrations/20261025_004_fix_lists_rls.sql` — RLS-Fix für
    Soft-Delete/Restore auf `lists`; `get_list` als `SETOF`.
  - `supabase/tests/02_rpc_household_lists.sql` — 62 pgTAP-Tests.
- **Akzeptanzkriterien (belegt):**
  - Haushalt + Standardliste werden **atomar** und **replay-sicher** angelegt
    (Client-UUIDs; zweiter Aufruf mit derselben ID legt nichts doppelt an).
  - Listen-CRUD: anlegen, lesen (`get_list`, `list_lists`), umbenennen,
    soft-löschen, wiederherstellen; Replay ist jeweils ein No-op.
  - **Nichtmitglied sieht fremde Haushalte/Listen nicht** (0 Zeilen; pgTAP
    „Nichtmitglied C sieht den fremden Haushalt nicht“ / „… sieht keine Listen
    des fremden Haushalts“ / „… sieht eine fremde Liste nicht“).
  - Rollen: Editor darf Listen/Items ändern, Viewer nicht, nur Owner verwaltet
    Mitglieder. RPCs sind durchgehend `SECURITY INVOKER`, RLS greift also auch
    innerhalb der Funktionen; `anon` hat keinerlei EXECUTE.
- **Test-Nachweis:** kompletter Lauf auf frischer PostgreSQL-16.2-Instanz
  (Supabase-Shim + pgTAP): Basisschema 001/002 einmalig (CREATE TYPE/TABLE ist
  naturgemäß nicht wiederholbar), die funktionalen Migrationen 003/004 je
  **zweimal** (Idempotenz), Seed zweimal, danach beide Suites:
  `01_rls` 45/45 ok, `02_rpc_household_lists` 62/62 ok, **107 ok, 0 Fehlschläge**.
  Reproduzierbar aus dem Repo mit
  `PGROOT=<pg-shim> bash supabase/tests/run_local_verify.sh`
  (Exit 0 = alles grün; echtes Output-Snippet in `docs/TESTLOG-T2.2.md`).
- **Technische Entscheidungen (Begründung im Migrationskopf):**
  1. `lists_select` erlaubt Ownern/Editoren den Blick auf soft-gelöschte Zeilen.
     Grund: PostgreSQL wendet die SELECT-`USING`-Klausel bei `UPDATE` zusätzlich
     auf die NEUE Zeile an; mit `deleted_at IS NULL` schlug jedes Soft-Delete
     mit „new row violates row-level security policy“ fehl. Viewer sehen
     weiterhin nur aktive Listen, Nichtmitglieder gar nichts.
  2. `get_list` gibt `SETOF public.lists` zurück statt einer einzelnen
     Komposit-Zeile. Grund: eine Einzel-Komposit-Rückgabe liefert bei leerem
     Treffer `NULL`, und `count(*)` zählt diese NULL-Zeile als 1 — Clients und
     Tests sahen einen Treffer, obwohl nichts geliefert wurde. `SETOF` macht
     „leer“ sauber zu 0 Zeilen (PostgREST: leeres Array, `.maybeSingle()` → null).
- **Offene Fragen:** Keine. Frontend kann die RPCs direkt über
  `supabase.rpc(...)` ansprechen; `get_list`/`list_lists` liefern Arrays.

---

## Welle 2 — Backend (`backend`) · Karte `t_0d433806` (T2.3 + T2.4)

### T2.3 Einladung Link/QR · T2.4 Mitgliederverwaltung (RPC/RLS)

- **Status Backend:** **fertig** (Migrationen + pgTAP). Der **UI-Anteil**
  (`apps/web`: Einladungsdialog mit Rollenwahl, QR-Rendering via `qrcode`,
  Widerruf-Liste, Mitgliederliste mit Rollenwechsel/Entfernen/Austritt sowie
  der E2E-Nachweis A-3/A-4 mit zwei Browser-Kontexten) liegt bei `frontend`.
  Die Checkboxen T2.3/T2.4 in `PLAN.md` bleiben deshalb offen, bis beide
  Anteile zusammen abgenommen sind (gleiche Konvention wie T2.2).
- **Gelieferte Pfade:**
  - `supabase/migrations/20261025_005_invites_and_members.sql` — 8 öffentliche
    RPCs (`create_invite`, `revoke_invite`, `list_household_invites`,
    `check_invite`, `accept_invite`, `change_member_role`, `remove_member`,
    `leave_household`) + 5 interne Helfer im Schema `internal`.
  - `supabase/migrations/20261025_006_fix_household_members_rls.sql` —
    RLS-Fix für Soft-Delete auf `household_members`.
  - `supabase/tests/03_invites_and_members.sql` — 77 pgTAP-Tests.
  - `supabase/tests/run_local_verify.sh` — um Migrationen 005/006 und Suite 03
    erweitert; prüft jetzt zusätzlich die Ausgabe auf rote pgTAP-Assertions
    (`psql -f` liefert sonst Exit 0 trotz Fehlschlägen).
  - `docs/TESTLOG-T2.3-T2.4.md` — Testnachweis inkl. Negativkontrolle.
- **Akzeptanzkriterien (belegt):**
  - **A-3:** Einladung nur als Owner anlegbar/widerrufbar; Einlösung per
    Token-Hash legt die Mitgliedschaft mit der gewählten Rolle an (Editor kann
    danach schreiben); Replay ist idempotent und verbraucht keine zweite
    Nutzung; abgelaufene/widerrufene/aufgebrauchte Links werden mit
    unterscheidbaren Fehlern abgelehnt; `check_invite` zeigt den Status ohne
    Verbrauch.
  - **A-4:** Rollenwechsel wirkt sofort auf das Schreibrecht (RLS liest die
    Rolle live); Entfernen (Soft-Delete) entzieht Lese- und Schreibzugriff;
    **letzter Owner kann nicht austreten** (auch nicht herabgestuft/entfernt
    werden); mit zweitem Owner sind Austritt und Selbst-Herabstufung möglich,
    `households.owner_id` wird umgehängt (kein Owner-Leak über die
    `households_select`-Policy).
- **Test-Nachweis:** kompletter Lauf auf frischer PostgreSQL-16.2-Instanz
  (Supabase-Shim + pgTAP): Basisschema 001/002 einmalig, funktionale
  Migrationen 003–006 je **zweimal** (Idempotenz), Seed zweimal, danach alle
  Suiten: `01_rls` 45/45 ok, `02_rpc_household_lists` 62/62 ok,
  `03_invites_and_members` 77/77 ok = **184 ok, 0 Fehlschläge**.
  Reproduzierbar aus dem Repo mit
  `PGROOT=<pg-shim> bash supabase/tests/run_local_verify.sh` (Exit 0 = grün).
- **Technische Entscheidungen (Begründung in den Migrationsköpfen):**
  1. **Token nur als Hash:** Der Client erzeugt den Roh-Token (≥ 128 Bit) und
     übergibt ausschließlich den Hash an `create_invite`; der Roh-Token bleibt
     beim Client für Link/QR. Kein Server-Wissen über den Token.
  2. **Zwei interne Definer-Helfer** (`internal.accept_invite`,
     `internal.leave_household`) sind eine bewusste, dokumentierte Abweichung
     vom INVOKER-Grundsatz: der Eingeladene darf `invites`/`household_members`
     nicht per RLS beschreiben, und Editor/Viewer dürfen ihre eigene
     Mitgliedszeile nicht soft-löschen. Beide Helfer liegen im Schema
     `internal` (nicht per PostgREST exponiert), nehmen nie eine fremde
     User-ID entgegen und arbeiten mit `auth.uid()`; die Tokenprüfung
     (Widerruf/Ablauf/Auslastung) ist dort explizit implementiert. Alle
     anderen RPCs bleiben `SECURITY INVOKER`.
  3. **RLS-Fix 006** (analog 004): Owner dürfen soft-gelöschte
     Mitgliedszeilen sehen, sonst scheitert das Soft-Delete an der
     SELECT-USING-Klausel, die PostgreSQL bei UPDATE auf die neue Zeile
     anwendet.
- **Offene Fragen:** Keine. Das Frontend spricht die RPCs über
  `supabase.rpc(...)` an; `accept_invite`/`check_invite` liefern `jsonb`
  (`role`, `household_id`, `household_name`, `remaining_uses`, …),
  `change_member_role` liefert die geänderte Mitgliedszeile.

---

## Welle 2 — Frontend (`frontend`) · Karte `t_06dd2e88` (T2.3 + T2.4 UI)

### T2.3 Einladung Link/QR · T2.4 Mitgliederverwaltung (UI + E2E)

- **Status Frontend:** **fertig.** Die UI-Anteile zu T2.3/T2.4 sind umgesetzt und
  per Playwright mit zwei Browser-Kontexten belegt (A-3/A-4). Damit ist der in
  der Backend-Sektion genannte Vorbehalt aufgeloest; die Checkboxen T2.3/T2.4
  in `PLAN.md` sind abgehakt.
- **Gelieferte Pfade (`apps/web`):**
  - `lib/household/` — Adapter-Abstraktion (`getHouseholdAdapter()`), Rollen/
    Typen, UUIDv7, Token-Erzeugung + SHA-256, Supabase-Adapter (RPCs aus
    Migration 005), Mock-Adapter (Dev/E2E ohne Supabase).
  - `app/api/mock/household/route.ts` — In-Memory-Mock-Server (nur im
    Mock-Auth-Modus; spiegelt Rollen, Ablauf, Widerruf, Auslastung und die
    Letzter-Owner-Regel des Backend-Vertrags).
  - `components/household/InvitationDialog.tsx` — Rollenwahl, `max_uses`,
    Ablauf, Link **und** QR (`qrcode`, clientseitig gerendert), Kopieren.
  - `components/household/MemberManagementPanel.tsx` — Mitgliederliste mit
    `profile.display_name`, Rollenwechsel, Entfernen mit Inline-Bestaetigung,
    „Haushalt verlassen“ inkl. `P0001`-Hinweis, sowie Schreib-Probe (Editor
    darf schreiben, Viewer nicht).
  - `app/household/page.tsx` — Onboarding „Haushalt anlegen“ + Verwaltung.
  - `app/invite/[token]/page.tsx` — Vorschau (`check_invite`) und Beitritt
    (`accept_invite`) mit unterscheidbaren Meldungen fuer
    abgelaufen/widerrufen/aufgebraucht/nicht gefunden.
  - `e2e/household.spec.ts` — 2 Tests × 2 Projekte (chromium, mobile-chromium).
- **Akzeptanzkriterien (belegt):**
  - **A-3:** Einladung einloesen → gewaehlte Rolle greift (Editor schreibt,
    Viewer nicht); abgelaufener Link wird mit eigener Meldung abgelehnt
    (Mock: `debug-expire` setzt `expires_at` in die Vergangenheit); widerrufener
    Link ebenso unterscheidbar.
  - **A-4:** Rolle Editor→Viewer wirkt sofort auf das Schreibrecht (ohne
    Reload); Entfernen entzieht den Zugriff (Betroffener sieht wieder den
    Onboarding-Dialog); letzter Owner kann nicht austreten (Meldung sichtbar,
    Haushalt bleibt bestehen).
- **Technische Entscheidungen:**
  1. **Roh-Token bleibt im Client:** 32 Byte Zufall (256 Bit) base64url im Link
     `/invite/<token>`; an die RPC geht nur der SHA-256-Hex-Hash. QR enthaelt
     dieselbe URL.
  2. **Mock nur bei Mock-Auth:** `getHouseholdAdapter()` waehlt anhand von
     `isMockAuth()`. Der Mock-Server ist eine Route im Dev-Server (In-Memory,
     pro Prozess); im Supabase-Modus laufen alle Pfade ueber `supabase.rpc(...)`
     und RLS. Kein Produktions-Server-Roundtrip fuer den QR.
  3. **Ein-Hand-Bedienung:** Dialog als Bottom-Sheet, zentrale Buttons ≥ 48 px,
     Inline-Bestaetigung statt `window.confirm`.
- **Test-Nachweis (frisch in dieser Karte):**
  - `pnpm exec vitest run` → **154/154 Tests, 15 Dateien gruen**.
  - `pnpm exec playwright test` → **10/10 gruen** (chromium + mobile-chromium,
    inkl. `e2e/household.spec.ts`).
  - `pnpm typecheck` → Exit 0 (core build + alle Workspace-Projekte).
  - `pnpm --filter @einkaufszettel/web build` → Exit 0.
- **Offene Fragen:** Keine.

---

**Nächster Schritt:** Re-Scope-Kommentare an den Karten beachten (Body ignorieren),
dann T1.1 starten. MVP-Feature-AKs für Phase 2: `PLAN.md` Anhang A (A-1…A-8).
Rückmeldung an architect: Commit-Hash, erfüllte T1.x/AK, offene Punkte.

---

## Welle 3 — Phase 3 „Rezepte & Smart-Import“ (`architect`, Karte `t_7d11c1b7`)

**Planungsstand 2026-10-26.** Maßgeblich bleiben `PLAN.md` §5 (T3.1–T3.5) und der neue
**Anhang B** (Kartenschnitt + prüfbare AKs B-1…B-6). Phase 2 ist abgenommen; Welle 3
baut Rezepte auf der bestehenden Dexie/Outbox-Schicht und ergänzt die fehlende
serverseitige RPC `add_to_list`.

### Karten (erstellt von architect, Kinder der Planungskarte)

| Karte           | ID           | Assignee | Auftrag                                                                                                                                         | Abhängigkeiten                       |
| --------------- | ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| T3.1/T3.3-Logik | `t_d6fc2927` | core     | Einheiten-Parser/-Formatter/-Aggregator, `scaleRecipe`, `source_recipe_id` im `AddToListRequest`, Sync-Typen für `recipes`/`recipe_ingredients` | keine (gated auf Planungskarte)      |
| T3.2-Persistenz | `t_5fd3abeb` | backend  | Migration 008: `add_to_list`-RPC + Idempotenz-Ledger; pgTAP `05_add_to_list.sql` inkl. Rezept-RLS                                               | keine                                |
| T3.2-UI         | `t_c10073d1` | frontend | Rezept-CRUD offline (Dexie/Outbox), Suche, E2E `recipes.spec.ts`                                                                                | T3.1-Logik                           |
| T3.4-UI         | `t_e8d5e9fe` | frontend | Vorschau-Dialog, Portionswahl, Übertragung, E2E `recipe-transfer.spec.ts`                                                                       | T3.1-Logik, T3.2-Persistenz, T3.2-UI |

**Hinweis zum Kartenschnitt:** Beim Anlegen ging der Karten-Body technisch verloren;
die vollständigen Spezifikationen (Ziel, Scope, Anforderungen, AK/Nachweis, Constraints)
liegen deshalb als **Kommentar** an jeder Karte und sind dort maßgeblich. Drei Karten
wurden vom Dispatcher sofort gestartet, bevor Spezifikation und Verlinkung gesetzt waren;
die Dependency-Kanten konnten nachträglich nicht mehr per `kanban_link` gesetzt werden
(„child is already running“). Ein Retry/Review muss die Spezifikation aus dem Kommentar
lesen; der nächste architect-Lauf soll die Kanten nachziehen, sobald die Läufe beendet sind.

### Entscheidungen

- **T3.5 „Zutaten, die ich schon habe“:** Aufwand deutlich >1 Tag (eigene Tabelle, RLS,
  CRUD, Abgleichlogik) → **nicht in Welle 3**; Eintrag in `docs/BACKLOG.md`.
- **Kein devops-Auftrag:** `ci.yml` und `e2e.yml` decken die neuen Karten automatisch ab
  (Playwright `testDir ./e2e`); pgTAP bleibt bei der lokalen Verifikation per
  Vanilla-PG-16.2-Shim (`docs/DECISIONS.md`).
- **`add_to_list` serverseitig nachziehen:** Die RPC fehlte bisher in der DB; der reine
  TS-Vertrag in `packages/core/src/add-to-list.ts` bleibt Referenz für Verhalten
  (Idempotenz per `request_id`, Aggregation nach Name+Dimension).

### Offene Punkte (nicht blockierend)

- T1.3-Laufzeitnachweis (Compose/HTTPS) weiterhin nur auf einem Docker-Host möglich.
- Dependency-Gating der drei bereits laufenden Karten nachziehen, sobald beendet.

---

## Welle 4 — Phase 4 „PWA, Offline-Härtung & UX“ (`architect`, Karte `t_81b02bfb`)

**Planungsstand 2026-10-26.** Maßgeblich bleiben `PLAN.md` §5 (T4.1–T4.6) und der neue
**Anhang C** (Kartenschnitt + prüfbare AKs C-1…C-8). Phase 2/3 sind abgenommen; Welle 4
baut PWA-Grundlage, Offline-Testbarkeit, Backoff/Dead-Letter, UX/Ergonomie und A11y.

**Karten-IDs (erstellt von architect):**

| Karte              | ID           | Assignee | Abhängig von |
| ------------------ | ------------ | -------- | ------------ |
| T4.1 PWA           | `t_4e27c239` | frontend | —            |
| T4.2a Mock-Sync    | `t_bba90d6d` | frontend | —            |
| T4.2b Offline-E2E  | `t_18741bd9` | qa       | T4.1, T4.2a  |
| T4.3a Backoff      | `t_28db1c12` | core     | —            |
| T4.3b DLQ/Worker   | `t_e8af35e9` | frontend | T4.3a, T4.2a |
| T4.4+4.5 UX/Mobile | `t_d230d8e6` | frontend | T4.1         |
| T4.6 A11y/axe      | `t_e07f902e` | frontend | T4.4+4.5     |

> **Hinweis zum Kartenschnitt:** Der Karten-Body ging beim Anlegen technisch verloren;
> die vollständigen Spezifikationen (Ziel, Scope, Anforderungen, AK/Nachweis, Constraints,
> Abhängigkeiten) liegen deshalb als **Kommentar** an jeder Karte und sind dort maßgeblich.
> Mehrere Karten wurden vom Dispatcher sofort gestartet, bevor Spezifikation/Verlinkung
> gesetzt waren; wo `kanban_link` wegen „child is already running“ abgelehnt wurde, steht
> die Abhängigkeit im Kommentar („falls nicht fertig → `kanban_block(kind="dependency")`“).

### T4.1 PWA-Grundlage (`frontend` · Karte `t_4e27c239`)

- **Ziel:** Manifest, Icons, Service Worker (App-Shell-Precache + SWR für Assets),
  Registrierung, Install-Prompt, Offline-Fallback. Kein Push.
- **Akzeptanzkriterium:** Lighthouse-Installability-Audits bestanden; `e2e/pwa.spec.ts`
  (Manifest 200/valide, SW-Controller nach Reload) in beiden Projekten; Unit-Tests für
  Cache-Strategie-Auswahl; `lint/typecheck/test` + Web-Build grün. PLAN-Checkbox T4.1.
- **Betroffene Pfade:** `apps/web/public/`, `app/manifest.ts` oder `public/manifest.webmanifest`,
  `app/layout.tsx` (minimal), `components/pwa/`, `lib/pwa/` (+Tests).
- **Constraints:** `/rest/v1/*`, `/auth/v1/*`, `/api/*` nie cachen; keine externen Assets/Secrets;
  bestehende E2E nicht brechen (SW-Test-Flag). Keine Sync-Logik.
- **Abhängigkeiten:** keine; parallel zu T4.2a (disjunkte Pfade).
- **Offene Fragen:** keine.

### T4.2a Dev-Mock-Sync + Mock-Realtime (`frontend` · Karte `t_bba90d6d`)

- **Ziel:** Dev-only In-Memory-Sync-Server + `MockSyncAdapter` + `MockRealtimeSource` (Polling),
  damit zwei Browser-Kontexte („zwei Geräte“) im Mock-Modus real konvergieren; Status-Modus
  entsprechend anpassen.
- **Akzeptanzkriterium:** Zwei Clients konvergieren < 5 s; Upsert idempotent; `add_to_list`
  gleiche `request_id` ohne Doppelmenge; Supabase-Pfad unverändert; Integrationstest mit
  echtem Tool-Output in `docs/TESTLOG-T4.2a.md`.
- **Betroffene Pfade:** `app/api/mock/sync/route.ts`, `lib/sync/mock-adapter.ts`,
  `lib/sync/mock-realtime.ts`, `lib/sync/create-adapter.ts`, `lib/sync/status.ts` (+Tests),
  `docs/DECISIONS.md`.
- **Constraints:** dev-only, In-Memory, keine Secrets, keine neuen Runtime-Deps; Supabase-Modus
  unangetastet; PWA-Pfade (T4.1) nicht anfassen.
- **Abhängigkeiten:** keine; T4.2b und T4.3b hängen daran.
- **Offene Fragen:** keine blockierenden.

### T4.2b Offline-E2E (`qa` · Karte `t_18741bd9`)

- **Ziel:** `e2e/offline.spec.ts` mit `context.setOffline(true)` für Szenario A „Supermarkt
  ohne Netz“ (ein Gerät, inkl. Offline-Reload aus SW) und Szenario B „zwei Geräte offline,
  dann online“ (zwei Kontexte, gleicher Haushalt, Konvergenz ohne Duplikate/Verluste).
- **Akzeptanzkriterium:** 2 Szenarien × 2 Playwright-Projekte grün, keine Flakes; Gesamtsuite
  ohne Regression; Server-Assertion über Mock-Sync-API; `docs/TESTLOG-T4.2.md`. PLAN-Checkbox T4.2.
- **Betroffene Pfade:** `apps/web/e2e/offline.spec.ts` (neu), ggf. `e2e/helpers/*`, Testlog.
- **Constraints:** nur Testcode; fehlende Produktivfunktion → Kommentar an T4.2a und
  `kanban_block(kind="dependency")`, nicht selbst bauen. Echter Supabase-Lauf bleibt offen (D14).
- **Abhängigkeiten:** T4.1 (SW/Offline-Reload) und T4.2a (Mock-Sync).
- **Offene Fragen:** keine.

### T4.3a Backoff-Policy (`core` · Karte `t_28db1c12`)

- **Ziel:** Reine Backoff-Logik in `packages/core`: `nextRetryDelayMs` (1/2/4/8/16 s, Cap 60 s,
  ±20 % injizierbarer Jitter), `next_attempt_at` im Outbox-Eintrag, Dead-Letter nach
  `maxAttempts` (5); rückwärtskompatibel/additiv.
- **Akzeptanzkriterium:** ≥10 neue Unit-Tests (Sequenz, Cap, Jitter, attempts-Inkrement,
  next_attempt_at mit fester Uhr, Dead-Letter nach 5, Erfolg ohne next_attempt_at,
  doppeltes Replay idempotent); `packages/core` + Gesamtprojekt grün. Keine PLAN-Checkbox
  (T4.3 tickt T4.3b).
- **Betroffene Pfade:** `packages/core/src/outbox.ts` (+Test), ggf. `sync.ts`, `index.ts`,
  `docs/DECISIONS.md`.
- **Constraints:** reine Funktionen, keine Framework-/I/O-Abhängigkeiten; `apps/web` nicht anfassen;
  bestehende Semantik (Idempotenz, Delete gewinnt) erhalten.
- **Abhängigkeiten:** keine; T4.3b hängt daran.
- **Offene Fragen:** keine.

### T4.3b Worker-Backoff + Dead-Letter-Anzeige (`frontend` · Karte `t_e8af35e9`)

- **Ziel:** Worker respektiert `next_attempt_at` (30-s-Timer), manueller Trigger/Reconnect
  versucht sofort; DeadLetterPanel mit Fehlertext/Versuchen und Aktionen „Erneut versuchen“
  (attempts=0, neu einreihen) und „Verwerfen“; leerer Zustand; Status aktualisiert.
- **Akzeptanzkriterium:** Worker-/Repository-Unit-Tests (Backoff-Skip, Sofort-Retry, DLQ nach 5,
  retry/discard) + Playwright-UI-Nachweis mit Fehlerinjektion; `docs/TESTLOG-T4.3.md`;
  PLAN-Checkbox T4.3.
- **Betroffene Pfade:** `lib/sync/worker.ts` (+Test), `lib/db/repository.ts` (+Test),
  `components/sync/DeadLetterPanel.tsx`, `components/SyncStatusBadge.tsx`, Einbindung, Testlog.
- **Constraints:** nur `apps/web`; keine Änderung an core/Supabase; PWA-/Mock-Sync-Pfade
  anderer Worker nicht überschreiben; bei Index-Lock warten.
- **Abhängigkeiten:** T4.3a (Backoff), T4.2a (Fehlerinjektion).
- **Offene Fragen:** keine.

### T4.4 + T4.5 UI-Polish & Mobile-Ergonomie (`frontend` · Karte `t_d230d8e6`)

- **Ziel:** Dark Mode (System + Toggle, persistiert, kein Flash), Responsive 320–430 px +
  Tablet/Desktop, Empty States, Skeletons, Micro-Interactions (reduced-motion respektiert);
  Touch-Ziele ≥44 px, Eingabefeld unten mit Safe-Area, Enter bleibt im Feld,
  Autovervollständigung aus Historie, Swipe abhaken/löschen; Artikel in ≤2 Taps.
- **Akzeptanzkriterium:** `e2e/ui-polish.spec.ts` in beiden Projekten (Toggle-Persistenz,
  Systemmodus via `emulateMedia`, Touch-Höhen ≥44 px, ≤2-Tap-Ablauf, Swipe, reduced-motion);
  bestehende 32 E2E grün; `lint/typecheck/test/build` grün; PLAN-Checkboxen T4.4 und T4.5;
  `docs/TESTLOG-T4.4-4.5.md`.
- **Betroffene Pfade:** `app/globals.css`, `components/list/*`, `app/lists/*`, `app/list/*`,
  `components/theme/` (neu), ggf. `app/layout.tsx` minimal, `app/recipes/page.tsx` (Empty/Skeleton).
- **Constraints:** keine Sync-/Datenlogik; keine neuen Runtime-Deps ohne Not (Swipe via pointer
  events); Fokusringe nicht entfernen; keine horizontalen Scrollbalken bei 320 px.
- **Abhängigkeiten:** T4.1 (Layout/Theme-Kollision vermeiden); T4.6 hängt an dieser Karte.
- **Offene Fragen:** keine; Swipe links = löschen, rechts = abhaken, Achsen-Lock ab 10 px.

### T4.6 Barrierefreiheit + axe-Check (`frontend` · Karte `t_e07f902e`)

- **Ziel:** WCAG-Basis (Kontrast, sichtbarer Fokus, Labels, Rollen) + `e2e/a11y.spec.ts` mit
  axe (`@axe-core/playwright`) auf Login/Liste/Rezepte/Haushalt; 0 serious/critical; läuft
  in CI über die bestehende `e2e.yml` (kein Workflow-Umbau).
- **Akzeptanzkriterium:** axe-Spec in beiden Projekten grün, Report in `docs/TESTLOG-T4.6.md`;
  Gesamtsuite grün; `lint/typecheck/test` grün; PLAN-Checkbox T4.6.
- **Betroffene Pfade:** `apps/web/package.json` (devDep) + Lockfile, `e2e/a11y.spec.ts`,
  A11y-Fixes in `components/**`/`app/**`, Testlog.
- **Constraints:** keine Verhaltensänderung der App; keine Runtime-Dependency; andere Worker
  in `components/list`, `components/pwa`, `lib/sync` nicht überschreiben.
- **Abhängigkeiten:** T4.4+4.5 (finale UI).
- **Offene Fragen:** keine blockierenden.

### Entscheidungen (Welle 4)

- **Kein devops-Auftrag:** `ci.yml` und `e2e.yml` decken die neuen Karten automatisch ab;
  axe läuft als zusätzliche Playwright-Spec. Nur falls ein Workflow-Umbau nötig würde,
  käme devops hinzu.
- **Mock-Sync (dev-only) statt echtem Supabase-E2E:** In dieser Sandbox ist kein Docker-Daemon
  verfügbar; das PLAN-AK „zwei Geräte offline, dann online“ wird gegen eine In-Memory-Gegenstelle
  real geprüft. Echter Supabase-Lauf bleibt offener Umgebungspunkt (analog D14).
- **T4.3 geteilt** in Core-Logik (`t_28db1c12`) und Web-Verdrahtung/UI (`t_e8af35e9`).
- **T4.4 + T4.5 in einer Karte**, weil dieselben UI-/CSS-Pfade betroffen sind (Kollisionsschutz).

### Offene Punkte (nicht blockierend)

- Echter Supabase-E2E-Lauf (PostgREST/Realtime) auf Docker-Host nachzuholen.
- T1.3 (Compose/HTTPS-Laufzeitnachweis) weiterhin offen; HTTPS ist Voraussetzung für echte
  PWA-Installation, localhost gilt als sicherer Kontext für Lighthouse/Playwright.

---

## Welle 5 — Phase 5 „Test, Betrieb & Go-Live“ (`architect`, Karte `t_0ede60b2`)

**Planungsstand 2026-10-26.** Maßgeblich bleiben `PLAN.md` §5 (T5.1–T5.4) und der neue
**Anhang D** (Kartenschnitt + prüfbare AKs D-1…D-6). Phase 1–4 sind QA-abgenommen.
**Human Gate 3 (Go-Live) bleibt beim PO**; T5.5 (Durchführung) und T5.6 (Release v1.0.0)
sind bewusst **nicht** geschnitten. Die erlaubte T5.5-Vorbereitung ist als eigene Karte
geschnitten. Kein Produktivcode, kein Release/Tagging in dieser Welle.

### Karten-IDs (erstellt von architect)

| Karte                        | ID           | Assignee | Abhängig von                     |
| ---------------------------- | ------------ | -------- | -------------------------------- |
| T5.1 E2E-Suite CI            | `t_1fb12e66` | frontend | —                                |
| T5.2 k6-Lasttest             | `t_d87fc882` | core     | T5.1 (empfohlen; Link abgelehnt) |
| T5.3a RLS-Abdeckung          | `t_5fb3079e` | backend  | —                                |
| T5.3b Security-Baseline      | `t_0094b32d` | devops   | T5.3a (Checkbox-Abschluss)       |
| T5.4 Betrieb                 | `t_cc7a72cf` | devops   | —                                |
| T5.5-Vorbereitung Dogfooding | `t_ade04faa` | frontend | —                                |

> **Hinweis zum Kartenschnitt:** Der Karten-Body von T5.1 ging beim Anlegen technisch
> verloren; die vollständigen Spezifikationen (Ziel, Ist-Stand, Soll, AK, Sandbox-Grenze,
> Pfade, Constraints, Abhängigkeiten, offene Fragen) liegen deshalb als **Kommentar** an
> jeder Karte und sind dort maßgeblich. Mehrere Karten wurden vom Dispatcher sofort
> gestartet, bevor die Verlinkung gesetzt war; `kanban_link` (T5.2 → T5.1) wurde mit
> „child is already running“ abgelehnt. Die Abhängigkeit steht im Kommentar von T5.2;
> falls T5.1 bei Bearbeitung von T5.2 nicht fertig ist, gilt `kanban_block(kind="dependency")`.

### T5.1 E2E-Suite vollständig in CI (`frontend` · Karte `t_1fb12e66`)

- **Ziel:** Playwright-Projekte `chromium`, `mobile-chromium` (bestehend), `webkit` und
  `mobile-webkit` (iPhone 14/15); `e2e.yml` installiert Chromium+WebKit mit System-Deps;
  alle 13 Specs laufen über alle Projekte; Bericht/Artefakte bei Fehlschlag.
- **Akzeptanzkriterium:** Konfiguration enthält WebKit-Projekte; Workflow installiert beide
  Engines; Chromium-Projekte in der Sandbox ohne Regression grün (68/68); WebKit-Konfig per
  `playwright test --list` validiert; `docs/TESTLOG-T5.1.md`; PLAN-Checkbox T5.1.
- **Betroffene Pfade:** `apps/web/playwright.config.ts`, `.github/workflows/e2e.yml`,
  ggf. `apps/web/e2e/*.spec.ts` (projektbezogene Skips), `docs/TESTLOG-T5.1.md`.
- **Constraints:** keine App-Verhaltensänderung; Chromium-Suite muss grün bleiben;
  WebKit-spezifische App-Fehler nur dokumentieren (Folgekarte), nicht hier fixen; kein Docker.
- **Abhängigkeiten:** keine.
- **Offene Fragen:** keine.
- **Sandbox-Grenze:** WebKit-Binary installierbar, aber Systemlibs (`libsecret`, `libhyphen`,
  `libGLESv2`, `libx264`) fehlen → echter WebKit-Lauf ist offener CI-/Docker-Host-Nachweis.

### T5.2 k6-Lasttest 10 Haushalte × 5 Nutzer (`core` · Karte `t_d87fc882`)

- **Ziel:** `perf/k6-sync.js` mit 10 Haushalten × 5 VUs (50 VUs), Ramp-up, Thresholds
  p95 < 1000 ms und Fehlerrate < 1 %; Szenarien Sync-Poll/Upsert und `add_to_list` mit
  `request_id`-Idempotenz; `docs/PERF.md` mit Messwerten, Interpretation und
  Reproduktionsanleitung für den Docker-/Supabase-Host.
- **Akzeptanzkriterium:** Skript vorhanden, `k6 inspect`/Dry-Run grün; Lauf gegen den
  Mock-Sync-Stack dokumentiert (p95 < 1 s, Fehlerrate < 1 %) **oder** als Host-Nachweis
  offen; `docs/PERF.md`; PLAN-Checkbox T5.2.
- **Betroffene Pfade:** `perf/k6-sync.js` (neu), `perf/README.md` (optional),
  `docs/PERF.md` (neu), ggf. `package.json`-Script (kein Runtime-Dep).
- **Constraints:** keine App-/Produktivcode-Änderung; Mock-Sync nur im Dev-Modus;
  keine Secrets; keine Docker-Abhängigkeit im Skript.
- **Abhängigkeiten:** T4.2a abgeschlossen; T5.1 empfohlen (nicht blockierend).
- **Offene Fragen:** keine.
- **Sandbox-Grenze:** k6 nicht installiert; Download versuchen. Echter 50-VU-Lauf gegen
  Supabase bleibt offen (D14).

### T5.3a RLS-Testabdeckung (`backend` · Karte `t_5fb3079e`)

- **Ziel:** `docs/SECURITY-RLS-COVERAGE.md` als Matrix aller 10 Tabellen × Operationen ×
  RPCs gegen die 5 pgTAP-Suiten; Lücken mit Tests schließen oder begründet dokumentieren;
  neue Suite in `run_local_verify.sh` registrieren.
- **Akzeptanzkriterium:** Matrix vollständig; jede Lücke Test oder begründete Restlücke;
  `bash -n` grün; statische Prüfung belegt; echter pgTAP-Lauf als Docker-/PG-Host-Nachweis
  offen. Checkbox T5.3 **nicht** hier ticken (T5.3b koordiniert).
- **Betroffene Pfade:** `supabase/tests/*.sql`, `supabase/tests/run_local_verify.sh`,
  `docs/SECURITY-RLS-COVERAGE.md` (neu), ggf. `docs/DECISIONS.md`.
- **Constraints:** keine Migrationslogik ändern (nur Tests/Doku); pgTAP-Stil beibehalten;
  keine Produktivdaten; keine Secrets.
- **Abhängigkeiten:** keine.
- **Offene Fragen:** keine.
- **Sandbox-Grenze:** kein Docker/`psql`/`pg-shim` → Runner nicht ausführbar; statische
  Matrix ist der Sandbox-Nachweis.

### T5.3b Security-Baseline (`devops` · Karte `t_0094b32d`)

- **Ziel:** CSP, HSTS, X-Frame-Options/frame-ancestors, Referrer-Policy,
  Permissions-Policy, nosniff im Caddyfile; Rate-Limit-Zonen für `/auth/v1/*` und
  `add_to_list` (Caddy-`rate_limit`-Plugin via xcaddy); `npm audit --omit=dev`;
  `scripts/check-security-config.mjs` als Node-Konfigprüfung + CI-Einbindung;
  `docs/SECURITY.md` mit Begründung und Host-Validierungsanleitung.
- **Akzeptanzkriterium:** Header + Limit-Zonen vorhanden; Node-Prüfskript grün und in CI;
  Audit dokumentiert; `docs/SECURITY.md`; Checkbox T5.3 nur nach T5.3a-Abschluss.
- **Betroffene Pfade:** `caddy/Caddyfile`, `caddy/Dockerfile`,
  `scripts/check-security-config.mjs` (neu), `.github/workflows/ci.yml`,
  `docs/SECURITY.md` (neu), ggf. `docs/DECISIONS.md`.
- **Constraints:** keine App-Verhaltensänderung außer Headern; CSP darf die
  Chromium-E2E-Suite nicht brechen; keine Secrets; Plugin-Version pinnen.
- **Abhängigkeiten:** T5.3a für den Checkbox-Abschluss; sonst unabhängig.
- **Offene Fragen:** CSP-Strenge vs. Next.js-Inline-Scripts pragmatisch entscheiden und
  begründen.
- **Sandbox-Grenze:** kein Docker/`caddy`-Binary → `caddy validate` und echte
  Header-/429-Läufe bleiben Docker-Host-Nachweis.

### T5.4 Betrieb (`devops` · Karte `t_cc7a72cf`)

- **Ziel:** Backup-Härtung (Retention, Integritätsprüfung), `restore.sh` +
  `test-restore.sh` (Stub/Dry-Run und optional portables PostgreSQL), Update-Prozedur,
  Healthcheck-Übersicht, Logrotation, Monitoring inkl. Cert-Expiry; `docs/OPERATIONS.md`
  als Runbook.
- **Akzeptanzkriterium:** Skripte vorhanden, `bash -n` grün; Restore-Test im Stub-/Dry-Run
  grün oder als offener Docker-/PG-Host-Nachweis; Retention + Integritätsprüfung
  implementiert; `docs/OPERATIONS.md`; Compose-Logging konfiguriert; PLAN-Checkbox T5.4.
- **Betroffene Pfade:** `scripts/backup.sh`, `scripts/restore.sh` (neu),
  `scripts/test-restore.sh` (neu), `scripts/check-cert-expiry.sh` (neu),
  `scripts/backup.cron.example`, `docs/OPERATIONS.md` (neu), `docker-compose.yml`,
  `README.md`, ggf. `caddy/README.md`.
- **Constraints:** keine destruktiven Defaults (Restore nur mit explizitem Ziel +
  Bestätigung); `backups/` bleibt gitignored; keine Secrets; Healthchecks nicht unnötig
  verlangsamen.
- **Abhängigkeiten:** keine; T5.3b empfohlen (finale Header/Limits), nicht blockierend.
- **Offene Fragen:** Monitoring als optionaler Compose-Service (Uptime Kuma) vs. externe
  Instanz — pragmatisch entscheiden und in `docs/OPERATIONS.md` begründen.
- **Sandbox-Grenze:** kein Docker/`psql` → echter Restore-Lauf bleibt offen; Skripte müssen
  stub-/dry-run-fähig sein.

### T5.5-Vorbereitung Dogfooding (`frontend` · Karte `t_ade04faa`)

- **Ziel:** `docs/DOGFOODING.md` (2-Wochen-Ablauf, Rollen, Kern-Testfälle, Known Issues,
  Eskalation) und `docs/FEEDBACK.md` (Vorlage inkl. Schweregrad/Reproduktion).
- **Akzeptanzkriterium:** beide Dokumente ohne weitere Erklärung nutzbar; keine
  Code-/Produktivänderung; PLAN-Checkbox T5.5 **nicht** ticken (erst nach Gate 3).
- **Betroffene Pfade:** `docs/DOGFOODING.md` (neu), `docs/FEEDBACK.md` (neu).
- **Constraints:** keine Release-/Tagging-Aktion; kein Vorgriff auf Gate 3; keine erfundenen
  Testergebnisse.
- **Abhängigkeiten:** keine.
- **Offene Fragen:** keine.
- **Dokumente (Vorbereitung, Stand vor Gate 3):**
  [`DOGFOODING.md`](DOGFOODING.md) — Ablauf 2 Wochen, Haushalte/Rollen, Kern-Testfälle
  D1–D8 (Liste anlegen/teilen, offline im Supermarkt, Rezepte/Portionen, Einladung/Rollen,
  Dark Mode/Mobile, PWA-Installation, Haushalts-Sichtbarkeit), Known Issues K1–K8 mit
  Umgehungen, Abbruch-/Eskalationskriterien, Rhythmus der Feedback-Sichtung, Kickoff-Checkliste.
  [`FEEDBACK.md`](FEEDBACK.md) — Vorlage (Datum, Haushalt/Rolle, Gerät, Szenario, Schweregrad,
  Reproduktion, Erwartung/Ist, Häufigkeit, Screenshot-Hinweis, Status), Schweregrad-Definitionen,
  fiktives Ausfüllbeispiel, Feedback-Log, Sichtungsprotokoll, Bugfix-Nachtest und Abschlussübersicht.
  Beide Dokumente enthalten **keine Testergebnisse**; das Dogfooding selbst und die
  Bugfix-Runde folgen erst nach Human Gate 3. Die PLAN-Checkbox **T5.5 bleibt offen**.

### Entscheidungen (Welle 5)

- **T5.1 bei `frontend`:** überwiegend Playwright-Konfiguration, projektbezogene Skips und
  WebKit-Kompatibilität; der Eingriff in `e2e.yml` ist klein. `devops` bleibt für T5.3b/T5.4.
- **T5.2 bei `core`:** framework-freies k6-Skript + Lasttest-Semantik (Idempotenz/Outbox);
  `devops` ist mit T5.3b/T5.4 ausgelastet.
- **T5.3 geteilt** in `3a` backend (supabase/tests + Abdeckungsdoku) und `3b` devops
  (Caddy/CI/Security-Doku) — disjunkte Pfade, keine Kollisionen. Checkbox T5.3 tickt `3b`
  nach Abschluss von `3a`.
- **T5.4 als eine devops-Karte:** dieselben Dateien (`scripts/`, `docker-compose.yml`,
  `OPERATIONS.md`); Split würde kollidieren.
- **T5.5 nur Vorbereitung:** Durchführung/Checkbox erst nach Gate 3.
- **Sandbox-Ersatznachweise:** WebKit → Konfig/CI + offener Lauf; k6 → Skript/Mock-Lauf;
  RLS → statische Matrix + offener pgTAP-Lauf; Header/Limits → Node-Prüfung + offenes
  `caddy validate`; Restore → Stub/Dry-Run + offener Docker-/PG-Lauf. Kein Produktivcode,
  kein Release/Tagging.

### Offene Punkte (nicht blockierend für Welle 5)

- WebKit-Laufzeitnachweis (Systemlibs fehlen) auf CI/Docker-Host.
- k6 50-VU-Lauf gegen echtes Supabase/PostgREST (D14).
- pgTAP-/RLS-Lauf auf Docker-/PG-Host; in der Sandbox nur statisch belegt.
- `caddy validate` + Header-/429-Verhalten auf Docker-Host.
- Restore-Test gegen echtes PostgreSQL/Compose.
- T1.3 (Compose/HTTPS-Laufzeitnachweis), D14 Real-Backend-E2E, D16 Zwei-Nutzer-E2E,
  D19 axe-Abdeckung Dead-Letter-Dialog — unverändert offen, nicht Welle-5-blockierend.
- T5.5-Durchführung und T5.6 Release/Tagging: erst nach Human Gate 3 durch den PO.
