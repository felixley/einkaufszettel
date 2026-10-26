# Testlog T3.2 — RPC `add_to_list` + Rezept-RLS (Backend)

**Datum:** 2026-10-26
**Umgebung:** PostgreSQL 16.2 (Vanilla-Instanz + Supabase-Shim: Rollen `anon`,
`authenticated`, `service_role`, Schema `auth`, `auth.uid()`; pgTAP).
Kein Docker-Daemon und keine Supabase-CLI in der Sandbox verfügbar — der Shim
bildet genau die Teile von Supabase nach, die die Migrationen und Tests nutzen
(siehe `docs/DECISIONS.md`).

**Reproduktion (aus dem Repo):**

```bash
PGROOT=/pfad/zum/pg-shim bash supabase/tests/run_local_verify.sh
# Exit 0 = alle Tests grün
```

Das Skript legt eine Wegwerf-Datenbank an, spielt Shim + pgTAP ein, fährt
Basisschema 001/002 einmalig, die funktionalen Migrationen 003–008 je zweimal
(Idempotenz-Nachweis), den Seed zweimal und führt alle fünf pgTAP-Suiten aus.

## Ergebnis

| Schritt                                                               | Ergebnis                                        |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| Migration `20261025_001_schema.sql`                                   | exit=0                                          |
| Migration `20261025_002_rls.sql`                                      | exit=0                                          |
| Migration `20261025_003_rpc_household_lists.sql` (1. + 2. Lauf)       | exit=0 / exit=0 (idempotent)                    |
| Migration `20261025_004_fix_lists_rls.sql` (1. + 2. Lauf)             | exit=0 / exit=0 (idempotent)                    |
| Migration `20261025_005_invites_and_members.sql` (1. + 2. Lauf)       | exit=0 / exit=0 (idempotent)                    |
| Migration `20261025_006_fix_household_members_rls.sql` (1. + 2. Lauf) | exit=0 / exit=0 (idempotent)                    |
| Migration `20261025_007_sync_auth_profiles.sql` (1. + 2. Lauf)        | exit=0 / exit=0 (idempotent)                    |
| Migration `20261025_008_add_to_list_rpc.sql` (1. + 2. Lauf)           | exit=0 / exit=0 (idempotent)                    |
| Seed (1. + 2. Lauf)                                                   | exit=0 / exit=0 (idempotent)                    |
| pgTAP `01_rls.sql`                                                    | **45/45 ok**, exit=0                            |
| pgTAP `02_rpc_household_lists.sql`                                    | **62/62 ok**, exit=0                            |
| pgTAP `03_invites_and_members.sql`                                    | **77/77 ok**, exit=0                            |
| pgTAP `04_profiles_sync.sql`                                          | **17/17 ok**, exit=0                            |
| pgTAP `05_add_to_list.sql` (neu)                                      | **58/58 ok**, exit=0                            |
| Gesamt                                                                | **259 ok, 0 not ok** (201 bestehende + 58 neue) |

## Echtes Output (Auszug)

```text
=== 4b. Funktionale Migrationen 003-008 (je zweimal = Idempotenz) ===
=== Migration 20261025_008_add_to_list_rpc.sql (1. Lauf) ===
--> exit=0
=== Migration 20261025_008_add_to_list_rpc.sql (2. Lauf = Idempotenz) ===
--> exit=0
=== 5. Seed (idempotent, zweimal) ===
=== Seed (1. Lauf) ===
--> exit=0
=== Seed (2. Lauf = Idempotenz) ===
--> exit=0
=== 10. pgTAP 05_add_to_list ===
...
 ok 40 - Stk und Packung werden nicht umgerechnet: neue Zeile
 ok 41 - Eier existieren als zwei Zeilen (Stk und Packung)
 ok 42 - Zucker wurde als neue Zeile angelegt
 ok 43 - Owner A hat 12 Request-Eintraege im Ledger (12 neu, Replay erzeugt keinen Eintrag)
 ok 44 - Viewer darf add_to_list nicht ausfuehren (RLS)
 ok 45 - Viewer darf Items nicht direkt anlegen (RLS)
 ok 46 - Viewer (Mitglied) sieht Rezept R1
 ok 47 - Nichtmitglied darf add_to_list auf fremder Liste nicht ausfuehren
 ok 48 - Nichtmitglied sieht Rezept R1 nicht
 ok 49 - Nichtmitglied sieht fremde Ledger-Eintraege nicht (RLS)
 ok 50 - Editor darf aggregieren (created=false)
 ok 51 - Editor-Aggregation: Milch steht jetzt bei 2 l
 ok 52 - Editor darf ein Rezept aendern
 ok 53 - Editor-Aenderung am Rezept ist sichtbar
 ok 54 - Editor darf ein Rezept anlegen
 ok 55 - Viewer darf ein Rezept nicht aendern (RLS filtert das UPDATE)
 ok 56 - Viewer darf kein Rezept anlegen (RLS)
 ok 57 - Nichtmitglied darf kein Rezept in H1 anlegen (RLS)
 ok 58 - Owner A sieht eigene Ledger-Eintraege
...
=== 9. Ergebnis ===
ALLE TESTS GRUEN
```

## Abgedeckte Akzeptanzkriterien (T3.2/T3.4, Backend-Anteil)

- **2× gleicher Artikel → Summe:** `add_to_list` aggregiert atomar über
  `name_normalized` + Dimension. 1 l + 500 ml → 1,5 l; 1 kg + 500 g → 1,5 kg
  (pgTAP 12–19, 33–38).
- **Replay ohne Doppel-Add:** Dieselbe `request_id` liefert `duplicate: true`
  und verändert die Menge nicht (pgTAP 21–27).
- **Inkompatible Einheit → eigene Zeile:** Milch l vs. Stk, Eier Stk vs.
  Packung erzeugen je eine zweite Zeile (pgTAP 30–32, 39–41).
- **`source_recipe_id`:** beim Anlegen gesetzt; beim Aggregieren nur
  nachgetragen, wenn die bestehende Zeile keine Quelle hat (pgTAP 9–11,
  33–38).
- **Serverseitige Normalisierung:** `  MILCH  ` → `milch`, aggregiert in die
  vorhandene Zeile (pgTAP 28–29).
- **`checked` bleibt false:** neue Zeilen sind unabgehakt (pgTAP 12).
- **Rollen/RLS:** Viewer darf weder `add_to_list` noch Items/Rezepte
  schreiben; Nichtmitglied sieht Rezept und Ledger nicht und darf nicht
  schreiben; Editor darf aggregieren und Rezepte anlegen/ändern
  (pgTAP 44–57).
- **Sicherheit:** RPC ist `SECURITY INVOKER`, `anon` hat kein EXECUTE auf der
  RPC und keinen Zugriff auf das Ledger; `authenticated` schon
  (pgTAP 1–8).

## Technische Befunde

1. **Namenskollision im `ON CONFLICT`-Ziel.** Der RPC-Parameter heißt laut
   TS-Vertrag/PostgREST `request_id`; die Ledger-Spalte ebenfalls. PL/pgSQL
   lehnte `on conflict (request_id)` als mehrdeutig ab. Fix: `on conflict on
constraint add_to_list_requests_pkey do nothing` (Constraint-Name statt
   Spaltenreferenz).
2. **Keine v7-UUID im Server-Kern.** PostgreSQL 16 hat kein `uuidv7()`.
   `internal.uuid_v7()` erzeugt serverseitig eine v7-förmige UUID (48 Bit
   Millisekunden + Version 7 + Variante 10 + Zufall) ohne Extension, damit der
   Schema-Check (`15. Zeichen = 7`) auch für serverseitig angelegte Zeilen
   erfüllt ist. Der Client erzeugt seine IDs weiterhin selbst
   (`apps/web/lib/db/uuid.ts`).
3. **Einheitenlogik 1:1 aus `packages/core/src/units.ts` gespiegelt.**
   `internal.convert_quantity` rechnet nur innerhalb einer Dimension
   (Masse/Volumen) um; Stück-Einheiten werden bewusst nicht zwischen
   verschiedenen Einheiten umgerechnet (`1 Bund != 1 Stk`), sondern erzeugen
   eine eigene Zeile.
4. **Ledger ist bewusst schlank.** `add_to_list_requests` hat nur
   `request_id`, `user_id`, `list_id`, `created_at` (kein Soft-Delete/
   `updated_at`): Es ist ein technisches Idempotenz-Ledger, kein
   Domänenobjekt. RLS beschränkt auf eigene Zeilen; kein UPDATE/DELETE.

## Nicht Teil dieser Karte

Die Frontend-Checkbox **T3.2** (Rezept-CRUD offline über Dexie/Outbox) bleibt
offen und gehört zur Frontend-Karte. Diese Backend-Karte liefert nur die
serverseitige Persistenz (RPC + RLS-Nachweis).
