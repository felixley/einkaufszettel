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
