# Einkaufszettel – Umsetzungsplan (agent-optimiert für Hermes Agent)

> Diese Datei liegt im Repo-Root als `PLAN.md`. Hermes arbeitet Aufgaben strikt in Reihenfolge ab, hakt sie ab und committet pro Aufgabe.

## 0. Arbeitsregeln für den Agenten

1. **Eine Aufgabe = ein Branch = ein PR/Commit** (`feat/T2.3-invite-links`). Conventional Commits.
2. **Definition of Done (DoD)** jeder Aufgabe: Code + Tests grün (`pnpm lint && pnpm typecheck && pnpm test`), Akzeptanzkriterium erfüllt, Checkbox in diesem Plan abgehakt, kurzer Eintrag in `docs/DECISIONS.md`, falls eine Entscheidung getroffen wurde.
3. **Nicht raten:** Bei Unklarheit die jeweils markierte Default-Entscheidung nehmen und dokumentieren. Nur bei den **🛑 Human Gates** stoppen und auf Freigabe warten.
4. **Keine Secrets im Repo.** Nur `.env.example`; echte Werte in `.env` (gitignored).
5. **Datenbank nur über Migrationen** (`supabase/migrations/*.sql`), nie manuell im Studio ändern.
6. **Reine Logik ohne UI-Abhängigkeit** (Einheiten, Aggregation, Kategorisierung, Sync) liegt in `packages/core` und ist zu >90 % unit-getestet.
7. **Scope-Disziplin:** Nur Dinge aus diesem Plan bauen. Ideen → `docs/BACKLOG.md`.

## 1. Ziel & Scope

**Ziel:** Kollaborative Einkaufslisten-App (PWA) mit Rezepten, Zutaten-Übertrag mit Einheitenlogik, Echtzeit-Sync und echtem Offline-Betrieb.

**In Scope (v1):** E-Mail-Login, Haushalte/Listen, Rollen (Owner/Editor/Viewer), Einladung per Link + QR, Artikel-CRUD + Abhaken, Realtime, Offline-First, Auto-Kategorisierung (regelbasiert), Mengen-Aggregation, Rezepte, Portionsrechner, „Auf die Liste“.

**Out of Scope (v1, → Backlog):** Social-Login, Rezeptimport per URL, Barcode-Scan, Push-Benachrichtigungen, KI-Kategorisierung, native Apps, Preisvergleich.

## 2. Wichtige Optimierungen gegenüber dem Ursprungsplan

| Ursprung | Problem | Optimierung |
|---|---|---|
| Offline erst in Phase 4 | Nachträglicher Umbau auf Offline-First ist der teuerste Refactor | **Local-first-Datenschicht ab MVP** (Phase 2) |
| „CRDT-Konzepte“ | Overkill für Listen | **Last-Write-Wins pro Feld** + Soft-Deletes + Outbox-Queue + serverseitige Mengen-Deltas |
| PWA ohne HTTPS | Service Worker läuft nur über HTTPS (außer localhost) | **Caddy-Reverse-Proxy mit HTTPS** (Tailscale-Domain oder DuckDNS) als Phase-1-Aufgabe |
| Supabase self-hosted nicht bedacht | Schwergewichtiger Stack (~10 Container) | Offizielles `supabase/docker` Compose übernehmen, auf nötige Dienste reduzieren, Backups einplanen |
| Rechte nur als Feature | Sicherheitslücken bei Mehrnutzer | **Row Level Security von Anfang an**, mit pgTAP-Tests |
| Einheiten vage | „1 Prise“ vs. „100 g“ | Feste **Einheiten-Taxonomie** + Konvertierungstabelle, nicht konvertierbare Einheiten bleiben eigene Zeile |
| Usability-Tests mit Fokusgruppen | Unrealistisch für Heimprojekt | **Dogfooding** mit Haushalt + Checkliste |
| Tippfehler „Gemüsekühlung“ | – | Kategorien klar definiert (siehe 4.4) |

## 3. Tech-Stack (festgelegt)

- **Monorepo:** pnpm Workspaces – `apps/web`, `packages/core`, `supabase/`
- **Frontend:** Next.js (App Router, TypeScript strict), Tailwind CSS, `next-pwa`/Serwist für Service Worker
- **Lokaler Speicher:** Dexie (IndexedDB-Wrapper) + eigene Outbox-Queue
- **Backend:** Self-hosted Supabase (Postgres, Auth, Realtime), RLS
- **Validierung:** Zod; **State:** TanStack Query + Dexie `liveQuery`
- **Tests:** Vitest (Unit), pgTAP (RLS), Playwright (E2E, inkl. Offline-Modus), k6 (Last)
- **CI:** GitHub Actions (lint, typecheck, test, build, Docker-Image)
- **Deployment:** Docker Compose (`web`, Supabase-Dienste, `caddy`), automatisches nächtliches `pg_dump`

## 4. Technische Festlegungen

### 4.1 Datenmodell (Kern)
Alle IDs sind **clientseitig generierte UUIDv7**, damit Offline-Erstellung ohne Server möglich ist. Alle Tabellen haben `created_at`, `updated_at`, `deleted_at` (Soft-Delete), Updates setzen `updated_at` per Trigger.

- `profiles(id → auth.users, display_name)`
- `households(id, name, owner_id)`
- `household_members(household_id, user_id, role enum[owner,editor,viewer])`
- `invites(id, household_id, token_hash, role, expires_at, max_uses, used_count, revoked_at)`
- `lists(id, household_id, name)`
- `list_items(id, list_id, name, name_normalized, quantity numeric, unit unit_enum, category_id, checked bool, checked_by, source_recipe_id null, note)`
- `categories(id, household_id null, key, label, sort_order)` – global + haushaltsspezifisch
- `category_rules(id, household_id null, keyword, category_id)` – Auto-Kategorisierung, lernt aus manuellen Änderungen
- `recipes(id, household_id, title, base_servings, tags[], instructions)`
- `recipe_ingredients(id, recipe_id, name, quantity, unit, sort_order)`

### 4.2 Sync-Strategie
- Alle Schreibaktionen gehen **zuerst in Dexie**, dann in die **Outbox** (`{id, table, op, payload, client_ts, attempts}`).
- Sync-Worker spielt die Outbox idempotent ab (Upsert per UUID), bei Reconnect, Fokus und alle 30 s.
- Realtime-Events (Supabase) aktualisieren Dexie; UI liest nur aus Dexie.
- **Konfliktregeln:** Feldweise LWW über `updated_at` (Server-Zeit gewinnt bei Gleichstand). `checked` ist idempotent. Löschen gewinnt gegen Bearbeiten.
- **Mengen-Aggregation serverseitig als RPC** `add_to_list(list_id, name, qty, unit)` mit atomarem `UPDATE … SET quantity = quantity + $x`, damit zwei gleichzeitige „Auf die Liste“-Aktionen nicht überschreiben.
- UI zeigt Sync-Status (synchronisiert / ausstehend: N / offline).

### 4.3 Einheiten
- Dimensionen: **Masse** (g, kg), **Volumen** (ml, l, TL, EL), **Stück** (Stk, Bund, Dose, Packung, Zehe), **Unbestimmt** (Prise, n. B.).
- Basiseinheiten: g, ml, Stk. Konvertierung nur **innerhalb einer Dimension** (kg→g, l→ml, EL=15 ml, TL=5 ml).
- Aggregation nur bei gleichem `name_normalized` **und** gleicher Dimension. Sonst eigene Zeile mit Hinweis.
- Anzeige: automatisch schön formatieren (1500 g → 1,5 kg), Rundung auf sinnvolle Schritte.
- Normalisierung von Namen: Kleinschreibung, Trim, einfache Plural-/Synonymliste (Tomate/Tomaten).

### 4.4 Kategorien (v1)
Obst & Gemüse · Brot & Backwaren · Milch & Eier · Kühlware · Fleisch & Fisch · Tiefkühl · Trockenwaren & Konserven · Gewürze & Öle · Getränke · Snacks & Süßes · Drogerie · Haushalt · Sonstiges
Regelbasiert über `category_rules` (Start-Seed mit ca. 300 deutschen Keywords). Manuelle Korrektur schreibt neue Haushalts-Regel.

### 4.5 Sicherheit
- RLS auf allen Tabellen: Zugriff nur für Mitglieder; Schreibrechte nur Owner/Editor; Rollenverwaltung nur Owner.
- Invite-Tokens: zufällig (≥128 Bit), nur **Hash** gespeichert, Ablauf (Default 7 Tage), widerrufbar, Einlösung per RPC.
- Rate-Limiting für Login/Invites über Caddy.

## 5. Phasen & Aufgaben

Jede Aufgabe enthält ein **Akzeptanzkriterium (AK)**.

### Phase 1 – Fundament & Infrastruktur
- [ ] **T1.1** Monorepo, TypeScript strict, ESLint, Prettier, Vitest, Husky. *AK:* `pnpm lint && pnpm typecheck && pnpm test` läuft grün.
- [ ] **T1.2** GitHub Actions CI (lint, typecheck, test, build). *AK:* Pipeline grün auf `main`.
- [ ] **T1.3** Docker Compose: Supabase-Stack + Next.js + Caddy mit HTTPS über **ipv64.net (DNS-01)**. *AK:* `docker compose up` startet alles; App unter `https://<name>.ipv64.net` (bzw. Subdomain) mit gültigem Zertifikat erreichbar; `/health` antwortet.
  - **Zertifikate:** Let's-Encrypt per **DNS-01-Challenge** mit ipv64-API-Key (`IPV64_API_KEY` in `.env`). Lego unterstützt ipv64 (Provider-Code `ipv64`). Vorteil: kein offener Port 80/443 nötig, Zugriff kann auf LAN/VPN beschränkt bleiben.
  - **Variante A (bevorzugt):** Eigenes Caddy-Image per `xcaddy build --with github.com/caddy-dns/lego-deprecated`, im Caddyfile `tls { dns lego_deprecated ipv64 }`. Hinweis: das Modul ist ein Übergangs-Shim.
  - **Variante B (Fallback, falls A mit der Caddy-Version nicht läuft):** `lego`-Container (`--dns ipv64`) erneuert Zertifikate per Cron; Caddy bindet die Zertifikatsdateien per Volume ein (`tls /certs/fullchain.pem /certs/key.pem`).
  - **DNS:** A-/AAAA-Record bei ipv64 auf die Server-IP. Für reinen Heimnetz-Betrieb darf der Record auf die **private IP** zeigen (Zertifikat funktioniert trotzdem dank DNS-01); für Zugriff von unterwegs Port-Freigabe oder VPN (WireGuard/Tailscale) ergänzen.
  - **Doku:** Entscheidung A/B in `docs/DECISIONS.md`; Renewal-Test (`caddy`-Logs bzw. `lego renew --dry-run`) in `README`.
- [x] **T1.4** Migrationen für Datenmodell 4.1 inkl. Trigger, Indizes, **RLS-Policies**. *AK:* pgTAP-Tests belegen: Nichtmitglied sieht nichts, Viewer kann nicht schreiben, Editor kann Items ändern, nur Owner verwaltet Mitglieder.
- [x] **T1.5** Seed: Kategorien + Keyword-Regeln, Einheiten. *AK:* `supabase db reset` liefert lauffähige Basisdaten.
- [ ] **T1.6** `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, Wireframes als einfache Low-Fi-Komponenten-Skizzen (Liste, Rezept, Import-Dialog) in `docs/wireframes.md`.
- [ ] **T1.7** `.env.example`, `README` mit Setup in max. 5 Schritten, Backup-Skript (`scripts/backup.sh`, Cron-Beispiel).

🛑 **Human Gate 1:** Schema, RLS-Konzept und Wireframes freigeben.

### Phase 2 – MVP: Kollaborative Liste (bereits local-first)
- [ ] **T2.1** Auth: Registrierung, Login, Logout, Passwort-Reset, geschützte Routen. *AK:* E2E-Test Register→Login→Logout.
- [ ] **T2.2** Haushalt anlegen, Standardliste erzeugen, Listen-CRUD. *AK:* Zweiter Nutzer sieht fremde Haushalte nicht.
- [ ] **T2.3** Einladung via Link **und QR** (`qrcode`), Rollenwahl, Widerruf, Ablauf. *AK:* Einladung einlösen, Rolle greift, abgelaufener Link wird abgelehnt.
- [ ] **T2.4** Mitgliederverwaltung (Rolle ändern, entfernen, Haushalt verlassen). *AK:* Letzter Owner kann nicht austreten.
- [ ] **T2.5** Dexie-Datenschicht + Outbox + Sync-Worker + Realtime-Anbindung (4.2). *AK:* Unit-/Integrationstests für Konfliktfälle (gleichzeitiges Abhaken, Edit vs. Delete, doppeltes Replay der Outbox).
- [ ] **T2.6** Listen-UI: Hinzufügen, Bearbeiten, Löschen (Undo), Abhaken, nach Kategorien gruppiert, abgehakte unten. *AK:* Playwright-Test mit zwei Browser-Kontexten: Änderung erscheint in <2 s beim anderen.
- [ ] **T2.7** Auto-Kategorisierung (`packages/core`) + Lernen aus manueller Änderung. *AK:* Unit-Tests mit ≥50 Beispielartikeln, ≥85 % Trefferquote auf Seed-Testset.
- [ ] **T2.8** Duplikat-Zusammenfassung beim manuellen Hinzufügen (gleicher Name+Dimension → Menge addieren, mit Hinweis). *AK:* Unit-Tests.

🛑 **Human Gate 2:** Kurze manuelle Abnahme der Liste auf dem Handy (zwei Geräte).

### Phase 3 – Rezepte & Smart-Import
- [ ] **T3.1** `packages/core/units`: Parser („250 g“, „1,5 EL“, „½ TL“, „1 Prise“), Konverter, Formatter, Aggregator (4.3). *AK:* ≥40 Unit-Tests inkl. Randfälle (Bruchzahlen, Komma, nicht konvertierbar).
- [ ] **T3.2** Rezept-CRUD inkl. Zutatenliste, Tags/Kategorien, Suche. *AK:* Offline-fähig über dieselbe Dexie/Outbox-Schicht.
- [ ] **T3.3** Portionsrechner (Skalierung, Rundung, sinnvolle Anzeige). *AK:* 4→6 Portionen skaliert korrekt; Unit-Test.
- [ ] **T3.4** „Auf die Einkaufsliste“: Vorschau-Dialog mit Zutaten-Checkboxen, Portionswahl, Hinweis „bereits auf Liste (+Menge)“, Aktion über RPC `add_to_list`. *AK:* E2E: Rezept zweimal übertragen → Mengen addiert; inkompatible Einheit → eigene Zeile; `source_recipe_id` gesetzt.
- [ ] **T3.5** „Zutaten, die ich schon habe“ (Vorratsliste pro Haushalt, optional) – *nur wenn Aufwand <1 Tag, sonst Backlog.*

### Phase 4 – PWA, Offline-Härtung & UX
- [ ] **T4.1** Manifest, Icons, Service Worker (App-Shell-Cache, Stale-While-Revalidate für Assets), Install-Prompt. *AK:* Lighthouse PWA-Check bestanden.
- [ ] **T4.2** Offline-Tests: Playwright mit `context.setOffline(true)`; Änderungen offline, Reconnect, Sync ohne Datenverlust. *AK:* Szenarien „Supermarkt ohne Netz“ und „zwei Geräte offline, dann online“ grün.
- [ ] **T4.3** Fehlerbehandlung: Sync-Fehlerstatus, Retry mit Backoff, Dead-Letter-Anzeige für dauerhaft fehlgeschlagene Outbox-Einträge.
- [ ] **T4.4** UI-Polish: Responsive, Dark Mode (System + Toggle), Micro-Interactions, Leere Zustände, Skeletons.
- [ ] **T4.5** Mobile-Ergonomie: Große Touch-Ziele (≥44 px), Eingabefeld unten erreichbar, schnelles Hinzufügen (Enter bleibt im Feld, Autovervollständigung aus Historie), Swipe zum Abhaken/Löschen. *AK:* Hinzufügen eines Artikels in ≤2 Taps.
- [ ] **T4.6** Barrierefreiheit-Basis (Kontrast, Fokus, Labels), axe-Check in CI.

### Phase 5 – Test, Betrieb & Go-Live
- [ ] **T5.1** E2E-Suite vollständig in CI (Chromium + WebKit-Mobile-Emulation).
- [ ] **T5.2** Lasttest k6: 10 Haushalte × 5 gleichzeitige Nutzer, p95 Sync-Latenz <1 s. Ergebnis in `docs/PERF.md`.
- [ ] **T5.3** Security-Check: RLS-Tests vollständig, Dependency-Audit, Header (CSP, HSTS), Rate-Limits.
- [ ] **T5.4** Betrieb: Backup + **getesteter Restore**, Update-Prozedur, Healthchecks, Logrotation, Monitoring (z. B. Uptime Kuma).
- [ ] **T5.5** Dogfooding 2 Wochen im eigenen Haushalt; Feedback in `docs/FEEDBACK.md`; Bugfix-Runde.
- [ ] **T5.6** Release `v1.0.0`, Changelog, Deployment-Doku.

🛑 **Human Gate 3:** Go-Live-Freigabe.

## 6. Risiken & Mitigation (überarbeitet)

| Risiko | W. | Auswirkung | Maßnahme |
|---|---|---|---|
| Bearbeitungskonflikte | Hoch | Mittel | LWW pro Feld, atomare Mengen-RPC, Soft-Deletes, Konflikt-Tests (T2.5) |
| Kein Netz im Supermarkt | Hoch | Hoch | Local-first ab Phase 2, Outbox, Offline-E2E (T4.2) |
| Uneinheitliche Einheiten | Mittel | Mittel | Taxonomie 4.3, Parser-Tests, nicht konvertierbare → eigene Zeile |
| Service Worker ohne HTTPS | Hoch | Hoch | Caddy/HTTPS via ipv64-DNS-01 in T1.3, Fallback lego-Container |
| Zertifikatserneuerung schlägt still fehl | Mittel | Hoch | Renewal-Dry-Run in T1.3, Uptime-Kuma-Check auf Zertifikatsablauf in T5.4 |
| Self-hosted Supabase Wartungsaufwand | Mittel | Mittel | Versionen pinnen, Backups + Restore-Test, Update-Doku |
| Schlechte Auto-Kategorisierung | Mittel | Niedrig | Lernende Haushaltsregeln, einfache manuelle Korrektur |
| Scope Creep | Mittel | Mittel | Out-of-Scope-Liste, Backlog-Datei, Human Gates |
| Datenverlust | Niedrig | Hoch | Nächtliches Backup, Restore-Test, Soft-Deletes |

## 7. Start-Prompt für Hermes

> Lies `PLAN.md` vollständig. Arbeite die Aufgaben der Reihe nach ab, beginnend mit T1.1. Beachte Abschnitt 0 (Arbeitsregeln). Nach jeder Aufgabe: Tests ausführen, Checkbox abhaken, committen. Halte an jedem 🛑 Human Gate an und fasse den Stand zusammen (was fertig, was entschieden, offene Fragen). Bei Blockern: Problem + Optionen + deine Empfehlung dokumentieren, dann mit der Empfehlung fortfahren, sofern keine Sicherheits- oder Datenverlust-Relevanz besteht.

---

## Anhang A — MVP-Slice: Umfang und testbare Akzeptanzkriterien

*Ergänzung von architect (Datum: 2026-10-25) auf Basis der PO-Fassung. Additiv: Die Abschnitte 0–7 bleiben unverändert maßgeblich. Die AKs in §5 bleiben die verbindliche Kurzform; dieser Anhang präzisiert sie auf Prüf-Ebene (Feature → Kriterium → Nachweis) und legt den MVP-Umfang fest.*

### A.1 Definition MVP-Slice

Der MVP ist **Phase 2** aus §5: eine kollaborative Einkaufsliste, die bereits local-first arbeitet. Er ist erreicht, wenn ein Haushalt mit ≥2 Personen eine Liste auf zwei Geräten gleichzeitig pflegen kann, Änderungen in <2 s ankommen, Offline-Eingaben nach Reconnect verlustfrei synchronisieren und Artikel automatisch kategorisiert sowie mengenmäßig zusammengefasst werden.

**Im MVP enthalten (Modelle/Features):**
- `profiles`, `households`, `household_members`, `invites`, `lists`, `list_items`, `categories`, `category_rules` (aus §4.1)
- Auth (Registrierung/Login/Logout/Passwort-Reset), Haushalt + Liste, Einladung per Link/QR mit Rollen, Mitgliederverwaltung
- Artikel-CRUD mit Abhaken/Undo, Kategorien-Gruppierung
- Dexie-Datenschicht + Outbox + Sync-Worker + Realtime, LWW-Konfliktauflösung, RPC `add_to_list`
- Auto-Kategorisierung (regelbasiert) und Duplikat-Zusammenfassung beim manuellen Hinzufügen

**Nicht im MVP (erst Phase 3+):** Rezepte, Portionsrechner, „Auf die Liste“ aus Rezepten, Einheiten-Parser/Bruchzahlen-Formatter, PWA-Install/Service-Worker-Härtung, Offline-E2E-Vollsuite, Lasttest. `recipes`/`recipe_ingredients` werden in T1.4 **migriert**, aber im MVP nicht bebaut.

### A.2 Testbare Akzeptanzkriterien je MVP-Feature

| # | Feature (Plan-ID) | Testbares Akzeptanzkriterium | Nachweis / Artefakt |
|---|---|---|---|
| A-1 | Auth (T2.1) | Ein E2E-Test durchläuft Register → Login → Logout; eine geschützte Route ist ohne Session nicht erreichbar (Redirect/401). | Playwright-Test grün in CI; Testdatei im Commit genannt |
| A-2 | Haushalt + Liste (T2.2) | Nutzer A legt Haushalt + Standardliste an; Nutzer B (nicht Mitglied) sieht diesen Haushalt weder in Listen- noch in Detailansicht. | E2E-Test mit zwei Browser-Kontexten; DB-Assertion auf 0 sichtbare Zeilen für B |
| A-3 | Einladung Link/QR (T2.3) | Einladung ist einlösbar, die gewählte Rolle greift danach, ein abgelaufener Link wird abgelehnt (Fehlercode/-meldung). | E2E-Test (3 Fälle) + pgTAP-Test für `invites`-Ablauf |
| A-4 | Mitgliederverwaltung (T2.4) | Rolle änderbar (Editor→Viewer wirkt sofort auf Schreibrecht); Entfernen entzieht Zugriff; letzter Owner kann nicht austreten. | E2E + pgTAP/Unit-Test für „letzter Owner“-Regel |
| A-5 | Offline-First-Sync (T2.5) | Konfliktfälle getestet: gleichzeitiges Abhaken (idempotent, ein Endzustand), Edit vs. Delete (Delete gewinnt), doppeltes Outbox-Replay (kein Duplikat). Reconnect spielt Outbox vollständig ab. | Vitest-Unit-/Integrationstests; Testnamen im Commit; Outbox-Replay-Test mit 2× Abspielen |
| A-6 | Listen-UI (T2.6) | Zwei Browser-Kontexte: Änderung von A erscheint bei B in <2 s; abgehakte Artikel stehen unten; Löschen ist per Undo rückgängig machbar. | Playwright-Test mit gemessener Latenz-Assertion |
| A-7 | Auto-Kategorisierung (T2.7) | Seed-Testset mit ≥50 deutschen Artikeln erreicht ≥85 % Trefferquote; eine manuelle Korrektur erzeugt eine Haushaltsregel, die beim nächsten gleichen Artikel greift. | Vitest-Test + Trefferquoten-Ausgabe im CI-Log |
| A-8 | Duplikat-Zusammenfassung (T2.8) | Gleicher `name_normalized` + gleiche Dimension → Mengen werden addiert und ein Hinweis angezeigt; unterschiedliche Dimension → eigene Zeile. | Unit-Tests (2 Fälle) + UI-Assertion im E2E |

**Querschnitt (gilt für alle A-1…A-8):** `pnpm lint && pnpm typecheck && pnpm test` grün; keine Secrets im Repo; Datenbankänderungen nur als Migration; RLS bleibt für jeden neuen Schreibpfad aktiv (pgTAP-Nachweis).
