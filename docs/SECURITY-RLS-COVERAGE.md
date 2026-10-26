# Sicherheits-Coverage: Row Level Security und RPCs (T5.3a)

Stand: 2026-10-26 · Karte: `t_5fb3079e` (T5.3a) · Teil von T5.3 (T5.3b koordiniert den Abschluss)

Diese Datei ist die **Abdeckungsmatrix** aller Tabellen, RLS-Policies und RPCs
gegen die pgTAP-Suiten. Sie beantwortet für jede Policy: _Wo wird sie
getestet, und ist der Test grün?_ Nicht getestete Pfade werden als begründete
Restlücke mit Risiko geführt (§6).

---

## 1. Zweck und Umfang

- **10 Domaenentabellen** aus `PLAN.md` §4.1:
  `profiles`, `households`, `household_members`, `invites`, `lists`,
  `list_items`, `categories`, `category_rules`, `recipes`,
  `recipe_ingredients`.
- **1 technische Tabelle**: `add_to_list_requests` (Idempotenz-Ledger,
  Migration 008) — append-only, kein Domaenenobjekt.
- **Rollen/RPCs**: Haushalt/Liste (003/004), Einladung/Mitglieder (005),
  Auth→Profile-Sync (007), `add_to_list` (008).

`recipes`/`recipe_ingredients` sind seit Migration 001/002 migriert und
RLS-gesichert, aber im MVP nicht bebaut (`PLAN.md` Anhang A.1). Die Policies
sind trotzdem Teil dieser Matrix.

---

## 2. Systemgrenzen — wie RLS tatsaechlich durchgesetzt wird

Drei Schichten greifen ineinander. Wer eine Policy „gruen“ nennt, muss wissen,
welche Schicht den Zugriff verweigert:

1. **Privilegien (Grants)** — `20261025_002_rls.sql`:
   `grant select on all tables to anon, authenticated` und
   `grant insert, update on all tables to authenticated`.
   **Kein `DELETE`-Grant** an `authenticated`; `add_to_list_requests` erhaelt in
   008 nur `select, insert`.
2. **RLS-Policies** — eine Policy pro Operation und Tabelle (Ziel-Zustand aus
   002, korrigiert in 004/006/008). Fehlt eine Policy, verweigert RLS per
   Default-Deny (0 Zeilen bzw. `new row violates row-level security policy`).
3. **Trigger** — `prevent_physical_delete` auf 9 Tabellen (nicht `profiles`,
   damit die `auth.users`-Kaskade greifen kann) erzwingt Soft-Delete auch
   gegenueber einem RLS-bypassenden `service_role`.

**Konsequenz fuer die Tests:** Fuer `authenticated` scheitert ein `DELETE`
bereits an Schicht 1 (SQLSTATE `42501`), bevor Policy/Trigger greifen. Die
Tests belegen damit das End-zu-End-Verbot, nicht isoliert die
`no_delete`-Policy (`USING (false)`). Fuer `service_role` bleibt der Trigger
als Schicht 3. Ausnahme: `add_to_list_requests` hat **keinen**
`prevent_delete`-Trigger (Ledger, Cleanup durch `service_role` vorgesehen) —
siehe Restluecke R2.

---

## 3. Verifikationsmethode und Ist-Stand

Ausgefuehrt mit `supabase/tests/run_local_verify.sh` gegen eine echte
PostgreSQL-16.2-Instanz + Supabase-Shim (`auth.uid()`, Rollen `anon`,
`authenticated`, `service_role`, pgTAP).

```
$ PGROOT=… PGHOST=/tmp PGPORT=55432 PGUSER=postgres \
    bash supabase/tests/run_local_verify.sh
…
=== 11. pgTAP 06_rls_policy_gaps ===
--> exit=0

=== 9. Ergebnis ===
ALLE TESTS GRUEN          # exit=0
```

| Suite                        | Inhalt                                                            | Assertions | Status    |
| ---------------------------- | ----------------------------------------------------------------- | ---------: | --------- |
| `01_rls.sql`                 | Basis-RLS, Rollen, Soft-Delete Items, Bootstrap, Trigger          |         45 | gruen     |
| `02_rpc_household_lists.sql` | RPCs Haushalt/Standardliste/Listen-CRUD                           |         62 | gruen     |
| `03_invites_and_members.sql` | Einladungen, Rollenwechsel, Entfernen, letzter Owner              |         77 | gruen     |
| `04_profiles_sync.sql`       | `auth.users`→`profiles`-Trigger                                   |         17 | gruen     |
| `05_add_to_list.sql`         | `add_to_list`, Aggregation, Rezept-/Ledger-RLS                    |         58 | gruen     |
| `06_rls_policy_gaps.sql`     | **neu in T5.3a**: direkte DML-Policies aller 10 Tabellen + Ledger |         91 | gruen     |
| **Summe**                    |                                                                   |    **350** | **gruen** |

Zusaetzlich beweist der Runner die **Idempotenz** aller Migrationen 003–008
(je zweimal) und des Seeds (zweimal).

---

## 4. Matrix — Tabellen × Operation

Legende: ✅ = durch gruene Assertion belegt · ⚠️ = nur indirekt/ueber andere
Schicht belegt (siehe Restluecke) · Spalte = Suite(n) §Abschnitt.

### 4.1 `profiles`

| Op     | Policy               | Nachweis                                                                                    | Status |
| ------ | -------------------- | ------------------------------------------------------------------------------------------- | ------ |
| SELECT | `profiles_select`    | 01 §8 (eigenes, geteiltes, Fremd-Profil); 06 §11 (soft-geloeschtes Fremd-Profil unsichtbar) | ✅     |
| INSERT | `profiles_insert`    | 06 §11 (Fremd-Profil → `42501`)                                                             | ✅     |
| UPDATE | `profiles_update`    | 06 §11 (eigenes erlaubt; fremdes 0 Zeilen)                                                  | ✅     |
| DELETE | `profiles_no_delete` | 06 §11 (kein DELETE-Grant → `42501`); Policy `USING(false)` plus FK-Kaskade                 | ⚠️ R4  |

### 4.2 `households`

| Op     | Policy                 | Nachweis                                                                   | Status |
| ------ | ---------------------- | -------------------------------------------------------------------------- | ------ |
| SELECT | `households_select`    | 01 §3/§4/§6 (Owner/Editor/Nichtmitglied); 02 §8                            | ✅     |
| INSERT | `households_insert`    | 01 §9 (Bootstrap H3); 06 §8 (fremder `owner_id` → `42501`, eigener OK)     | ✅     |
| UPDATE | `households_update`    | 01 §4 (Editor 0 Zeilen); 06 §8 (Owner nach Owner-Mitgliedszeile = 1 Zeile) | ✅     |
| DELETE | `households_no_delete` | 06 §8 (kein DELETE-Grant → `42501`)                                        | ⚠️ R1  |

### 4.3 `household_members`

| Op     | Policy                           | Nachweis                                                                   | Status |
| ------ | -------------------------------- | -------------------------------------------------------------------------- | ------ |
| SELECT | `household_members_select` (006) | 01 §3/§4/§5; 03 §12/§13 (Owner sieht soft-geloeschte Zeile fuer Re-Invite) | ✅     |
| INSERT | `household_members_insert`       | 01 §3/§4/§5 (Owner ja, Editor/Viewer nein); 01 §9 Bootstrap                | ✅     |
| UPDATE | `household_members_update`       | 01 §4; 03 §9 (Rollenwechsel); 03 §13 (Selbst-Herabstufung)                 | ✅     |
| DELETE | `household_members_no_delete`    | 06 §8 (kein DELETE-Grant → `42501`)                                        | ⚠️ R1  |

### 4.4 `invites`

| Op     | Policy              | Nachweis                                                                   | Status |
| ------ | ------------------- | -------------------------------------------------------------------------- | ------ |
| SELECT | `invites_select`    | 01 §3/§4/§6 (Owner-only); 06 §7                                            | ✅     |
| INSERT | `invites_insert`    | 03 §4/§5 (RPC, SECURITY INVOKER); 06 §7 (direkt: Owner OK, Editor `42501`) | ✅     |
| UPDATE | `invites_update`    | 03 §8 (Widerruf); 06 §7 (Nicht-Owner 0 Zeilen, Owner 1 Zeile)              | ✅     |
| DELETE | `invites_no_delete` | 06 §7 (kein DELETE-Grant → `42501`)                                        | ⚠️ R1  |

### 4.5 `lists`

| Op     | Policy               | Nachweis                                                                    | Status |
| ------ | -------------------- | --------------------------------------------------------------------------- | ------ |
| SELECT | `lists_select` (004) | 01 §3–§6; 02 §4/§6/§7/§8; 06 §9 (Writer sehen soft-geloescht, Viewer nicht) | ✅     |
| INSERT | `lists_insert`       | 02 §6/§7 (RPC); 06 §9 (Viewer/Nichtmitglied `42501`, Editor OK)             | ✅     |
| UPDATE | `lists_update`       | 02 §4/§6/§7; 06 §9 (Viewer 0 Zeilen, Editor 1 Zeile, Soft-Delete + Restore) | ✅     |
| DELETE | `lists_no_delete`    | 06 §9 (kein DELETE-Grant → `42501`)                                         | ⚠️ R1  |

### 4.6 `list_items`

| Op     | Policy                 | Nachweis                                                              | Status |
| ------ | ---------------------- | --------------------------------------------------------------------- | ------ |
| SELECT | `list_items_select`    | 01 §3–§7 (inkl. Soft-Delete Writer vs. Viewer); 05 §4–§6              | ✅     |
| INSERT | `list_items_insert`    | 01 §3–§6; 05 §4–§6                                                    | ✅     |
| UPDATE | `list_items_update`    | 01 §3/§4/§5/§7; 05 §6                                                 | ✅     |
| DELETE | `list_items_no_delete` | 06 §10 (kein DELETE-Grant → `42501`); 01 §10 (Trigger fuer Superuser) | ⚠️ R1  |

### 4.7 `categories`

| Op     | Policy                 | Nachweis                                                                   | Status |
| ------ | ---------------------- | -------------------------------------------------------------------------- | ------ |
| SELECT | `categories_select`    | 01 §3/§6 (H1-Kategorie); 06 §3 (global sichtbar fuer alle, H1 fremd nicht) | ✅     |
| INSERT | `categories_insert`    | 06 §3 (Viewer/Nichtmitglied `42501`; Editor OK; global `42501`)            | ✅     |
| UPDATE | `categories_update`    | 06 §3 (Viewer/Nichtmitglied 0 Zeilen; Editor 1 Zeile; global 0 Zeilen)     | ✅     |
| DELETE | `categories_no_delete` | 06 §3 (kein DELETE-Grant → `42501`)                                        | ⚠️ R1  |

### 4.8 `category_rules`

| Op     | Policy                     | Nachweis                                                                         | Status |
| ------ | -------------------------- | -------------------------------------------------------------------------------- | ------ |
| SELECT | `category_rules_select`    | 01 §2 (Seed-Zaehlung); 06 §4 (H1 sichtbar nur fuer Mitglieder, global fuer alle) | ✅     |
| INSERT | `category_rules_insert`    | 06 §4 (Viewer `42501`; Editor OK; global `42501`)                                | ✅     |
| UPDATE | `category_rules_update`    | 06 §4 (Viewer 0 Zeilen; Editor 1 Zeile)                                          | ✅     |
| DELETE | `category_rules_no_delete` | 06 §4 (kein DELETE-Grant → `42501`)                                              | ⚠️ R1  |

### 4.9 `recipes`

| Op     | Policy              | Nachweis                                               | Status   |
| ------ | ------------------- | ------------------------------------------------------ | -------- |
| SELECT | `recipes_select`    | 01 §3 (Owner); 05 §7 (Viewer/Nichtmitglied); 06 §5     | ✅       |
| INSERT | `recipes_insert`    | 05 §7 (Viewer/Nichtmitglied `42501`, Editor OK); 06 §5 | ✅       |
| UPDATE | `recipes_update`    | 05 §7 (Viewer 0 Zeilen, Editor OK); 06 §5              | ✅       |
| DELETE | `recipes_no_delete` | 06 §5 (kein DELETE-Grant → `42501`)                    | ⚠️ R1/R3 |

### 4.10 `recipe_ingredients`

| Op     | Policy                         | Nachweis                                        | Status   |
| ------ | ------------------------------ | ----------------------------------------------- | -------- |
| SELECT | `recipe_ingredients_select`    | 06 §6 (Viewer sieht, Nichtmitglied nicht)       | ✅       |
| INSERT | `recipe_ingredients_insert`    | 06 §6 (Viewer/Nichtmitglied `42501`, Editor OK) | ✅       |
| UPDATE | `recipe_ingredients_update`    | 06 §6 (Viewer 0 Zeilen, Editor 1 Zeile)         | ✅       |
| DELETE | `recipe_ingredients_no_delete` | 06 §6 (kein DELETE-Grant → `42501`)             | ⚠️ R1/R3 |

### 4.11 `add_to_list_requests` (Ledger)

| Op     | Policy                         | Nachweis                                                                        | Status |
| ------ | ------------------------------ | ------------------------------------------------------------------------------- | ------ |
| SELECT | `add_to_list_requests_select`  | 05 §8 (eigene Eintraege); 06 §12 (fremde unsichtbar)                            | ✅     |
| INSERT | `add_to_list_requests_insert`  | 05 (RPC-Pfad, SECURITY INVOKER); 06 §12 (fremde `user_id` → `42501`, eigene OK) | ✅     |
| UPDATE | — (keine Policy, Default-Deny) | 06 §12 (kein Grant → `42501`)                                                   | ⚠️ R2  |
| DELETE | — (keine Policy, Default-Deny) | 06 §12 (kein Grant); kein `prevent_delete`-Trigger                              | ⚠️ R2  |

---

## 5. Matrix — RPCs und Trigger

| Objekt                                                                                                                                                                     | Typ                             | Suite                                                                            | Status |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- | ------ |
| `create_household`, `ensure_default_list`, `create_list`, `rename_list`, `soft_delete_list`, `restore_list`, `list_lists`, `get_list`                                      | RPC (003/004, SECURITY INVOKER) | 02 §3–§10                                                                        | ✅     |
| `create_invite`, `revoke_invite`, `list_household_invites`, `check_invite`, `accept_invite`                                                                                | RPC (005)                       | 03 §4–§8                                                                         | ✅     |
| `change_member_role`, `remove_member`, `leave_household`                                                                                                                   | RPC (005)                       | 03 §9–§13                                                                        | ✅     |
| `add_to_list`                                                                                                                                                              | RPC (008)                       | 05 §3                                                                            | ✅     |
| `sync_auth_user_profile` (Trigger `auth.users` INSERT/UPDATE)                                                                                                              | Trigger-Fn (007)                | 04 §2–§7                                                                         | ✅     |
| `set_updated_at` / `prevent_physical_delete`                                                                                                                               | Trigger-Fns (001)               | 01 §2 (Trigger-Zaehlung), 01 §10 (DELETE), 04 §4 (`updated_at`)                  | ✅     |
| `public.is_household_member/_role_of/_writer/_owner/_owner_record`, `household_has_members`, `shares_household_with`, `is_list_member/_writer`, `is_recipe_member/_writer` | Helfer (002, SECURITY DEFINER)  | mittelbar ueber alle Policies; Bootstrap-Pfad 01 §9 / 06 §8                      | ✅     |
| `internal.*` (003/005/007/008)                                                                                                                                             | interne Helfer                  | nur mittelbar ueber die oeffentlichen RPCs (Anon-Ausfuehrung in 02 §4 abgelehnt) | ✅     |

---

## 6. Restluecken und Risiken (bewusst, mit Begruendung)

**Leitplanke der Karte:** „Keine Aenderung der Migrationslogik (nur
Tests/Doku)“. Deshalb werden gefundene Luecken dokumentiert statt hier
gefixt; Empfehlung ist jeweils eine eigene Folge-Migration.

- **R1 — Soft-Delete per `UPDATE` ist fuer `categories`, `category_rules`,
  `recipes`, `recipe_ingredients`, `households`, `invites` blockiert.**
  Diese sechs Tabellen haben keine „Writer duerfen soft-geloeschte Zeilen
  sehen“-Ausnahme in ihrer SELECT-Policy (im Gegensatz zu `lists` in 004 und
  `household_members` in 006). PostgreSQL wendet die SELECT-`USING`-Klausel
  beim UPDATE auf die neue Zeile an, d.h. ein `deleted_at = now()` scheitert an
  der RLS (`new row violates row-level security policy`).
  _Risiko:_ **mittel, latent** — im MVP wird fuer diese Tabellen kein
  Soft-Delete/Undo genutzt (`invites` nutzt `revoked_at`, `households`/
  `categories`/`rules`/`recipes` haben keinen Loeschpfad im Client). Sobald
  ein Restore/Undo-Pfad gebaut wird, bricht er. **Empfehlung:** Muster aus
  004/006 als Folge-Migration anwenden und je Tabelle einen Soft-Delete-Test
  nachziehen.
- **R2 — `add_to_list_requests` ist append-only ohne `prevent_delete`-Trigger.**
  Fuer `authenticated` genuegt Default-Deny (kein Grant, keine UPDATE/DELETE-
  Policy) — belegt in 06 §12. `service_role` (bypassrls, vertrauenswuerdig,
  hat keinen Trigger) koennte Ledger-Zeilen physisch loeschen.
  _Risiko:_ **niedrig** — technisches Idempotenz-Ledger ohne Personendaten,
  `service_role` ist serverseitig vertrauenswuerdig, Cleanup ist gewollt.
- **R3 — `recipes`/`recipe_ingredients` sind noch nicht gebaut.** Policies und
  Tests existieren, aber es gibt keinen Anwendungspfad; die Soft-Delete-Luecke
  aus R1 ist hier real, falls Rezepte geloescht werden.
  _Risiko:_ **niedrig im MVP**, steigt in Phase 3.
- **R4 — `profiles_no_delete` ist fuer `authenticated` nicht isoliert
  beobachtbar.** Die Policy setzt `USING (false)`, aber schon der fehlende
  DELETE-Grant verweigert `authenticated` (`42501`, 06 §11). Eine echte
  Loeschung ueber die `auth.users`-FK-Kaskade muss moeglich bleiben
  (`service_role`/GoTrue-Admin, RLS-Bypass).
  _Risiko:_ **niedrig/akzeptiert** — DSGVO-Loeschung erfordert genau das;
  die Policy verhindert nur den direkten Client-DELETE.
- **R5 — Globale Kategorien/Regeln sind fuer `authenticated` schreibgeschuetzt**
  (`household_id IS NOT NULL` in INSERT/UPDATE, in 06 §3/§4 belegt).
  `service_role`/Seed (Superuser) duerfen globale Daten pflegen.
  _Risiko:_ **niedrig/akzeptiert** — Seed und Admin-Pflege sind vertrauens-
  wuerdig; kein Client-Schreibpfad.

---

## 7. Statische Pruefung (Reproduktion)

```console
# 1. Alle Policy-Definitionen auflisten (44 CREATE-Anweisungen;
#    davon 2 Ersetzungen in 004/006  -> 42 aktive Policies auf 11 Tabellen)
$ grep -nE "create policy|drop policy" supabase/migrations/*.sql

# 2. Skript-Syntax
$ bash -n supabase/tests/run_local_verify.sh
bash -n: OK

# 3. Echter pgTAP-Lauf (6 Suiten + Idempotenz)
$ PGROOT=… PGHOST=/tmp PGPORT=55432 PGUSER=postgres \
    bash supabase/tests/run_local_verify.sh
ALLE TESTS GRUEN
```

Zuordnung „Policy → Teststelle“ siehe §4/§5; jede der 42 aktiven Policies ist
in einer der sechs Suiten mindestens einmal positiv **und** negativ belegt,
mit den Ausnahmen R1–R5 (dort nur end-to-end bzw. bewusst unbebaut).

---

## 8. Offener Umgebungsnachweis (Docker-/Supabase-Host)

Dieser Lauf nutzt Vanilla PostgreSQL 16.2 + Shim. Nicht abgedeckt und als
offener Nachweis dokumentiert (analog D14/T4.x):

- `supabase db reset` / `supabase test db` mit echtem GoTrue (`auth.users`
  inkl. `deleted_at`, `raw_user_meta_data`) und PostgREST.
- `service_role`-Pfade (Trigger-Schicht 3, Ledger-Cleanup).
- `anon`-Pfade ueber PostgREST (in den Suiten nicht ausgefuehrt).

Der Shim (`auth.uid()` liest `request.jwt.claim.sub`) ist semantisch
gleichwertig zu den abgedeckten Pfaden; die Abweichung ist das Fehlen echter
Auth-Trigger-Felder.
