# Testlog T2.3 + T2.4 — Einladungen & Mitgliederverwaltung (Backend)

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
Basisschema 001/002 einmalig, die funktionalen Migrationen 003–006 je zweimal
(Idempotenz-Nachweis), den Seed zweimal und führt alle drei pgTAP-Suiten aus.

## Ergebnis

| Schritt                                                               | Ergebnis                     |
| --------------------------------------------------------------------- | ---------------------------- |
| Migration `20261025_001_schema.sql`                                   | exit=0                       |
| Migration `20261025_002_rls.sql`                                      | exit=0                       |
| Migration `20261025_003_rpc_household_lists.sql` (1. + 2. Lauf)       | exit=0 / exit=0 (idempotent) |
| Migration `20261025_004_fix_lists_rls.sql` (1. + 2. Lauf)             | exit=0 / exit=0 (idempotent) |
| Migration `20261025_005_invites_and_members.sql` (1. + 2. Lauf)       | exit=0 / exit=0 (idempotent) |
| Migration `20261025_006_fix_household_members_rls.sql` (1. + 2. Lauf) | exit=0 / exit=0 (idempotent) |
| Seed (1. + 2. Lauf)                                                   | exit=0 / exit=0 (idempotent) |
| pgTAP `01_rls.sql`                                                    | **45/45 ok**, exit=0         |
| pgTAP `02_rpc_household_lists.sql`                                    | **62/62 ok**, exit=0         |
| pgTAP `03_invites_and_members.sql`                                    | **77/77 ok**, exit=0         |
| Gesamt                                                                | **184 ok, 0 not ok**         |

## Echtes Output (Auszug)

```text
=== 6. pgTAP 01_rls ===
...
 1..45
ROLLBACK
--> exit=0

=== 7. pgTAP 02_rpc_household_lists ===
...
 1..62
ROLLBACK
--> exit=0

=== 8. pgTAP 03_invites_and_members ===
 ok 20 - Nichtmitglied C sieht keine Einladungen des fremden Haushalts
 ok 21 - check_invite meldet gueltig, ohne zu verbrauchen
 ok 22 - check_invite liefert die Einladungsrolle
 ok 23 - check_invite liefert die verbleibenden Nutzungen
 ok 24 - check_invite hat den used_count nicht erhoeht
 ok 25 - B loest Einladung 1 ein und erhaelt die Rolle editor
 ok 26 - Replay der Einloesung ist idempotent (already_member)
 ok 27 - Replay verbraucht die Einladung nicht ein zweites Mal
 ok 28 - B ist genau einmal als Editor eingetragen
 ok 29 - Editor B (per Einladung) legt eine Liste an
 ok 30 - E loest Einladung 1 ein (zweite und letzte Nutzung)
...
 1..77
ROLLBACK
--> exit=0

=== 9. Ergebnis ===
ALLE TESTS GRUEN
```

## Negativkontrolle der Test-Harness

`psql -f` liefert bei fehlgeschlagenen Assertions **Exit 0** — ein Lauf mit
roten Tests hätte also fälschlich „grün“ gemeldet. Deshalb prüft
`run_local_verify.sh` zusätzlich die Ausgabe auf `not ok` / `# Failed test` /
`ERROR:`. Nachweis: eine absichtlich verfälschte Erwartung
(`1 → 999` in „B ist genau einmal als Editor eingetragen“) ergab

```text
psql_exit=0            <- psql selbst meldet keinen Fehler
not ok 28 - B ist genau einmal als Editor eingetragen
# Failed test 28: "B ist genau einmal als Editor eingetragen"
#         have: 1
#         want: 999
```

Die verfälschte Kopie wurde gegen die Wegwerf-DB gefahren; die Grep-Prüfung
erkennt „not ok“ (Match = Treffer), der Runner setzt damit Exit 1. Die echte
Suite ist unverändert und bleibt grün.

## Abgedeckte Akzeptanzkriterien (A-3 / A-4, Backend-Anteil)

- **A-3 Einladung einlösen, Rolle greift, abgelaufener Link abgelehnt:**
  - Einladung anlegen nur als Owner (Nicht-Owner → 42501), Token nur als Hash
    (Länge ≥ 32 erzwungen), `max_uses ≥ 1`, `expires_at` in der Zukunft.
  - Replay von `create_invite` erzeugt kein Duplikat (pgTAP „Replay erzeugt
    keine zweite Einladung“).
  - `accept_invite` legt die Mitgliedschaft mit der Einladungsrolle an
    (editor), Replay ist für bestehende Mitglieder idempotent und verbraucht
    keine zweite Nutzung.
  - `used_count` zählt Einlösungen korrekt (2/2 → „aufgebraucht“, weitere
    Einlösung → 22023).
  - Abgelaufener Link → `22023` „Einladung ist abgelaufen.“, Mitgliedschaft
    entsteht nicht; widerrufener Link → `22023`; unbekannter Token → `P0002`.
  - `check_invite` meldet `valid/expired/revoked/exhausted/not_found` **ohne**
    die Einladung zu verbrauchen.
- **A-4 Mitgliederverwaltung:**
  - Rolle änderbar (Editor → Viewer wirkt **sofort** auf das Schreibrecht:
    Viewer scheitert anschließend an `create_list` mit 42501; Zurückstufung
    auf Editor stellt das Schreibrecht wieder her).
  - Entfernen entzieht Zugriff: soft-gelöschtes Mitglied sieht Haushalt und
    Listen nicht mehr (0 Zeilen) und kann nicht mehr schreiben.
  - **Letzter Owner kann nicht austreten** und nicht herabgestuft/entfernt
    werden (`P0001`); mit zweitem Owner ist Austritt und Selbst-Herabstufung
    erlaubt, `households.owner_id` wird dabei auf den verbleibenden Owner
    umgehängt.
  - Nur Owner verwalten Mitglieder (Editor → 42501).
  - Re-Invite reaktiviert eine soft-gelöschte Mitgliedszeile (kein Duplikat).

## Technische Befunde (in Migration 006 behoben)

1. **Soft-Delete eines Mitglieds war blockiert.** `household_members_select`
   verlangte `deleted_at IS NULL` **und** `is_household_member(...)`.
   PostgreSQL wendet die USING-Klausel der SELECT-Policy bei `UPDATE`
   zusätzlich auf die NEUE Zeile an → `remove_member()` scheiterte mit
   „new row violates row-level security policy for table household_members“
   (derselbe Mechanismus wie bei `lists`, Migration 004). Fix: Owner dürfen
   soft-gelöschte Mitgliedszeilen sehen (nötig für Entfernen, Re-Invite und
   Outbox-Replay); Editor/Viewer sehen weiterhin nur aktive Mitglieder,
   Nichtmitglieder nichts.

## Bewusste Abweichung vom INVOKER-Grundsatz

Zwei Schreibpfade lassen sich nicht per RLS abbilden und laufen deshalb in
`internal`-Helfern (`SECURITY DEFINER`, **nicht** per PostgREST exponiert,
nehmen nie eine fremde User-ID entgegen, arbeiten mit `auth.uid()`):

- `internal.accept_invite` — der Eingeladene ist kein Owner und darf `invites`
  weder lesen noch schreiben, sich auch nicht selbst in `household_members`
  eintragen.
- `internal.leave_household` — `household_members_update` verlangt Owner-Rechte;
  ein Editor/Viewer kann seine eigene Zeile nicht selbst soft-löschen.

Alle übrigen RPCs dieser Migration laufen `SECURITY INVOKER`; die pgTAP-Suite
belegt, dass die öffentlichen Funktionen `prosecdef = false` sind und `anon`
kein EXECUTE hat.
