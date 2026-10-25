# Testlog T2.2 — Haushalt / Standardliste / Listen-CRUD (Backend)

**Datum:** 2026-10-25
**Umgebung:** PostgreSQL 16.2 (Vanilla-Instanz + Supabase-Shim: Rollen `anon`,
`authenticated`, `service_role`, Schema `auth`, `auth.uid()`; pgTAP).
Kein Docker-Daemon und keine Supabase-CLI in der Sandbox verfügbar — der Shim
bildet genau die Teile von Supabase nach, die die Migrationen und Tests nutzen.

**Reproduktion (aus dem Repo):**

```bash
PGROOT=/pfad/zum/pg-shim bash supabase/tests/run_local_verify.sh
# Exit 0 = alle Tests grün
```

Das Skript legt eine Wegwerf-Datenbank an, spielt Shim + pgTAP ein, fährt
Basisschema 001/002 einmalig, die funktionalen Migrationen 003/004 je zweimal
(Idempotenz-Nachweis), den Seed zweimal und führt beide pgTAP-Suiten aus.

## Ergebnis

| Schritt | Ergebnis |
| --- | --- |
| Migration `20261025_001_schema.sql` | exit=0 |
| Migration `20261025_002_rls.sql` | exit=0 |
| Migration `20261025_003_rpc_household_lists.sql` (1. + 2. Lauf) | exit=0 / exit=0 (idempotent) |
| Migration `20261025_004_fix_lists_rls.sql` (1. + 2. Lauf) | exit=0 / exit=0 (idempotent) |
| Seed (1. + 2. Lauf) | exit=0 / exit=0 (idempotent) |
| pgTAP `01_rls.sql` | **45/45 ok**, exit=0 |
| pgTAP `02_rpc_household_lists.sql` | **62/62 ok**, exit=0 |
| Gesamt | **107 ok, 0 not ok** |

## Echtes Output (Auszug)

```text
=== 4a. Basisschema 001 + 002 (einmalig) ===
=== Migration 001_schema ===
--> exit=0
=== Migration 002_rls ===
--> exit=0
=== 4b. Funktionale Migrationen 003 + 004 (je zweimal = Idempotenz) ===
=== Migration 20261025_003_rpc_household_lists.sql (1. Lauf) ===
--> exit=0
=== Migration 20261025_003_rpc_household_lists.sql (2. Lauf = Idempotenz) ===
--> exit=0
=== Migration 20261025_004_fix_lists_rls.sql (1. Lauf) ===
--> exit=0
=== Migration 20261025_004_fix_lists_rls.sql (2. Lauf = Idempotenz) ===
--> exit=0
=== 5. Seed (idempotent, zweimal) ===
=== Seed (1. Lauf) ===
--> exit=0
=== Seed (2. Lauf = Idempotenz) ===
--> exit=0
=== 6. pgTAP 01_rls ===
...
 ok 45 - Physisches DELETE wird vom Trigger blockiert
(1 row)

 finish
--------
 1..45
(1 row)

ROLLBACK
--> exit=0

=== 7. pgTAP 02_rpc_household_lists ===
...
 ok 60 - Nach ensure_default_list existiert genau eine aktive Liste
 ok 61 - Replay von create_list ist erlaubt
 ok 62 - Replay von create_list legt keine aktive Liste an und belebt keine geloeschte
 finish
--------
 1..62
(1 row)

ROLLBACK
--> exit=0

=== 8. Ergebnis ===
ALLE TESTS GRUEN
```

## Abgedeckte Akzeptanzkriterien (T2.2, Backend-Anteil)

- **Haushalt + Standardliste atomar:** `create_household` legt Haushalt,
  Owner-Mitgliedszeile und Standardliste in einer Transaktion an; ein Replay
  mit derselben Client-UUID erzeugt keine Duplikate (pgTAP 5–15).
- **Listen-CRUD:** `create_list`, `rename_list`, `soft_delete_list`,
  `restore_list`, `get_list`, `list_lists`; Replays sind No-ops
  (pgTAP 16–30, 54–62).
- **Nichtmitglied sieht fremden Haushalt nicht:** pgTAP 45–48
  („Nichtmitglied C sieht den fremden Haushalt nicht“, „… sieht keine Listen“,
  „… sieht eine fremde Liste nicht“).
- **Rollen:** Editor darf Listen/Items ändern, Viewer nicht; nur Owner
  verwaltet Mitglieder (pgTAP 31–44).
- **Sicherheit:** RPCs sind `SECURITY INVOKER`, `anon` hat kein EXECUTE, RLS
  greift innerhalb der Funktionen (pgTAP 1–6).

## Technische Befunde (in Migration 004 behoben)

1. **Soft-Delete war blockiert.** `lists_select` filterte `deleted_at IS NULL`
   für alle. PostgreSQL wendet die SELECT-`USING`-Klausel bei `UPDATE` auch auf
   die NEUE Zeile an → jedes Soft-Delete scheiterte mit „new row violates
   row-level security policy“. Fix: Owner/Editor sehen zusätzlich
   soft-gelöschte Listen (Viewer weiterhin nur aktive; Nichtmitglieder nichts).
2. **`get_list` zählte „leer“ als Treffer.** Als Einzel-Komposit-Rückgabe
   lieferte die Funktion bei leerem Treffer `NULL`; `count(*)` zählte diese
   NULL-Zeile als 1. Fix: `RETURNS SETOF public.lists` → leer = 0 Zeilen
   (PostgREST: leeres Array, `.maybeSingle()` → `null`).
