-- =============================================================================
-- Einkaufszettel — pgTAP: RPC add_to_list + Rezept-RLS (PLAN.md T3.2/T3.4)
-- =============================================================================
-- Ausfuehren mit: supabase test db   (oder psql -f auf einer Wegwerf-DB)
-- Die Tests laufen in einer Transaktion und werden am Ende zurueckgerollt.
--
-- Abgedeckte Akzeptanzkriterien aus PLAN.md §5 T3.2/T3.4:
--   * 2x gleicher Artikel -> Menge wird addiert (atomare Aggregation).
--   * Replay derselben request_id -> kein Doppel-Add, duplicate=true.
--   * Inkompatible Einheit -> eigene Zeile (2 Zeilen).
--   * source_recipe_id wird beim Anlegen gesetzt und beim Aggregieren nur
--     nachgetragen, wenn die bestehende Zeile noch keine Quelle hat.
--   * Serverseitige Normalisierung (trim/lower/Whitespace).
--   * RLS: Nichtmitglied sieht Rezept nicht; Viewer kann Rezept/Item nicht
--     schreiben; Editor kann; Owner kann.
--   * RPC ist SECURITY INVOKER; anon hat kein EXECUTE, authenticated schon.
-- =============================================================================
begin;
select no_plan();

-- -----------------------------------------------------------------------------
-- 1. Setup (als Superuser; RLS wird hier bewusst umgangen)
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a-owner@example.test',    'authenticated', 'authenticated'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b-editor@example.test',   'authenticated', 'authenticated'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c-outsider@example.test', 'authenticated', 'authenticated'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'd-viewer@example.test',   'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.profiles (id, display_name) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Owner A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Editor B'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Outsider C'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Viewer D')
on conflict (id) do nothing;

-- Haushalt 1 (Owner A, Editor B, Viewer D) und Haushalt 2 (Owner C).
insert into public.households (id, name, owner_id) values
  ('0192f1a2-2002-7000-8000-000000000001', 'Haushalt 1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('0192f1a2-2002-7000-8000-000000000002', 'Haushalt 2', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
on conflict (id) do nothing;

insert into public.household_members (id, household_id, user_id, role) values
  ('0192f1a2-2003-7000-8000-000000000001', '0192f1a2-2002-7000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner'),
  ('0192f1a2-2003-7000-8000-000000000002', '0192f1a2-2002-7000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'editor'),
  ('0192f1a2-2003-7000-8000-000000000003', '0192f1a2-2002-7000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'viewer'),
  ('0192f1a2-2003-7000-8000-000000000004', '0192f1a2-2002-7000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'owner')
on conflict (id) do nothing;

insert into public.lists (id, household_id, name) values
  ('0192f1a2-2004-7000-8000-000000000001', '0192f1a2-2002-7000-8000-000000000001', 'Liste 1'),
  ('0192f1a2-2004-7000-8000-000000000002', '0192f1a2-2002-7000-8000-000000000002', 'Liste 2')
on conflict (id) do nothing;

-- Rezepte: R1/R3 in H1 (Owner A), R2 in H2 (Owner C).
insert into public.recipes (id, household_id, title) values
  ('0192f1a2-2007-7000-8000-000000000001', '0192f1a2-2002-7000-8000-000000000001', 'Rezept 1'),
  ('0192f1a2-2007-7000-8000-000000000002', '0192f1a2-2002-7000-8000-000000000002', 'Rezept 2'),
  ('0192f1a2-2007-7000-8000-000000000003', '0192f1a2-2002-7000-8000-000000000001', 'Rezept 3')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Strukturpruefungen (Superuser)
-- -----------------------------------------------------------------------------
select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'add_to_list'),
  1::bigint,
  'RPC public.add_to_list existiert genau einmal'
);

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'add_to_list'
      and p.prosecdef),
  0::bigint,
  'add_to_list laeuft SECURITY INVOKER (RLS greift)'
);

select is(
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'add_to_list_requests'),
  1::bigint,
  'Ledger-Tabelle public.add_to_list_requests existiert'
);

select is(
  (select count(*) from pg_class
    where oid = 'public.add_to_list_requests'::regclass and relrowsecurity),
  1::bigint,
  'RLS ist auf add_to_list_requests aktiviert'
);

select ok(
  has_function_privilege('authenticated',
    'public.add_to_list(uuid,text,numeric,public.unit_enum,uuid,uuid,uuid,text)',
    'execute'),
  'authenticated darf add_to_list ausfuehren'
);

select ok(
  not has_function_privilege('anon',
    'public.add_to_list(uuid,text,numeric,public.unit_enum,uuid,uuid,uuid,text)',
    'execute'),
  'anon darf add_to_list nicht ausfuehren'
);

select ok(
  has_table_privilege('authenticated', 'public.add_to_list_requests', 'select')
  and has_table_privilege('authenticated', 'public.add_to_list_requests', 'insert'),
  'authenticated darf das Ledger lesen und schreiben'
);

select ok(
  not has_table_privilege('anon', 'public.add_to_list_requests', 'select')
  and not has_table_privilege('anon', 'public.add_to_list_requests', 'insert'),
  'anon hat keinen Zugriff auf das Ledger'
);

-- -----------------------------------------------------------------------------
-- 3. Owner A — Aggregation, Replay, Einheiten, Quelle
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- 3.1 Erstes Hinzufuegen: neue Zeile, source_recipe_id gesetzt, checked=false.
create temp table rpc_out (j jsonb);

insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Milch', 1, 'l'::public.unit_enum,
  '0192f1a2-2010-7000-8000-000000000001'::uuid,
  '0192f1a2-2007-7000-8000-000000000001'::uuid
);

select is((select j->>'created' from rpc_out), 'true',
          'Erstes add_to_list legt eine neue Zeile an (created=true)');
select is((select j->>'duplicate' from rpc_out), 'false',
          'Erstes add_to_list ist kein Duplikat');
select is((select (j->'item'->>'quantity')::numeric from rpc_out), 1::numeric,
          'Menge 1 l wurde gespeichert');
select is((select j->'item'->>'unit' from rpc_out), 'l',
          'Einheit l wurde gespeichert');
select is((select (j->'item'->>'source_recipe_id')::uuid from rpc_out),
          '0192f1a2-2007-7000-8000-000000000001'::uuid,
          'source_recipe_id wurde beim Anlegen gesetzt');
select is((select (j->'item'->>'checked')::boolean from rpc_out), false,
          'checked bleibt false');
select is((select count(*) from public.list_items
            where list_id = '0192f1a2-2004-7000-8000-000000000001'
              and name_normalized = 'milch' and deleted_at is null),
          1::bigint,
          'Genau eine aktive Milch-Zeile nach dem ersten Aufruf');

-- 3.2 Zweites Hinzufuegen, gleiche Dimension (500 ml): Summe 1,5 l.
truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Milch', 500, 'ml'::public.unit_enum,
  '0192f1a2-2010-7000-8000-000000000002'::uuid
);

select is((select j->>'created' from rpc_out), 'false',
          'Aggregation legt keine neue Zeile an (created=false)');
select is((select j->>'duplicate' from rpc_out), 'false',
          'Aggregation ist kein Duplikat');
select is((select (j->'item'->>'quantity')::numeric from rpc_out), 1.5::numeric,
          '2x gleicher Artikel: Menge wurde zu 1,5 l addiert');
select is((select j->'item'->>'unit' from rpc_out), 'l',
          'Aggregation behaelt die Einheit der vorhandenen Zeile (l)');
select is((select count(*) from public.list_items
            where list_id = '0192f1a2-2004-7000-8000-000000000001'
              and name_normalized = 'milch' and deleted_at is null),
          1::bigint,
          'Weiterhin genau eine aktive Milch-Zeile');

-- 3.3 Replay derselben request_id: kein Doppel-Add, duplicate=true.
truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Milch', 1, 'l'::public.unit_enum,
  '0192f1a2-2010-7000-8000-000000000001'::uuid,
  '0192f1a2-2007-7000-8000-000000000001'::uuid
);

select is((select j->>'duplicate' from rpc_out), 'true',
          'Replay liefert duplicate=true');
select is((select j->>'created' from rpc_out), 'false',
          'Replay legt keine neue Zeile an');
select is((select (j->'item'->>'quantity')::numeric from rpc_out), 1.5::numeric,
          'Replay addiert die Menge nicht erneut (bleibt 1,5 l)');
select is((select count(*) from public.list_items
            where list_id = '0192f1a2-2004-7000-8000-000000000001'
              and name_normalized = 'milch' and deleted_at is null),
          1::bigint,
          'Replay erzeugt keine zusaetzliche Milch-Zeile');
select is((select count(*) from public.add_to_list_requests
            where request_id = '0192f1a2-2010-7000-8000-000000000001'),
          1::bigint,
          'Ledger enthaelt die request_id genau einmal');

-- 3.4 Normalisierung: "  MILCH  " mit 250 ml landet in derselben Zeile.
truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  '  MILCH  ', 250, 'ml'::public.unit_enum,
  '0192f1a2-2010-7000-8000-000000000004'::uuid
);

select is((select j->>'created' from rpc_out), 'false',
          'Normalisierung: "  MILCH  " aggregiert in die vorhandene Zeile');
select is((select (j->'item'->>'quantity')::numeric from rpc_out), 1.75::numeric,
          'Normalisierung: Menge wurde zu 1,75 l addiert');
select is((select j->'item'->>'name_normalized' from rpc_out), 'milch',
          'name_normalized ist serverseitig normalisiert');

-- 3.5 Inkompatible Einheit (2 Stk): eigene Zeile.
truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Milch', 2, 'Stk'::public.unit_enum,
  '0192f1a2-2010-7000-8000-000000000005'::uuid
);

select is((select j->>'created' from rpc_out), 'true',
          'Inkompatible Einheit legt eine neue Zeile an (created=true)');
select is((select j->'item'->>'unit' from rpc_out), 'Stk',
          'Neue Zeile traegt die inkompatible Einheit Stk');
select is((select count(*) from public.list_items
            where list_id = '0192f1a2-2004-7000-8000-000000000001'
              and name_normalized = 'milch' and deleted_at is null),
          2::bigint,
          'Inkompatible Einheit erzeugt eine zweite Milch-Zeile');

-- 3.6 Quelle: beim Anlegen gesetzt; beim Aggregieren nur nachgetragen, wenn leer.
truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Sahne', 200, 'ml'::public.unit_enum,
  '0192f1a2-2010-7000-8000-000000000006'::uuid
);
select is((select j->'item'->>'source_recipe_id' from rpc_out) is null, true,
          'Sahne ohne Quelle: source_recipe_id ist NULL');

truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Sahne', 100, 'ml'::public.unit_enum,
  '0192f1a2-2010-7000-8000-000000000007'::uuid,
  '0192f1a2-2007-7000-8000-000000000001'::uuid
);
select is((select j->>'created' from rpc_out), 'false',
          'Sahne-Aggregation legt keine neue Zeile an');
select is((select (j->'item'->>'source_recipe_id')::uuid from rpc_out),
          '0192f1a2-2007-7000-8000-000000000001'::uuid,
          'Quelle wird beim Aggregieren nachgetragen, wenn sie fehlt');
select is((select (j->'item'->>'quantity')::numeric from rpc_out), 300::numeric,
          'Sahne-Menge wurde zu 300 ml addiert');

truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Sahne', 50, 'ml'::public.unit_enum,
  '0192f1a2-2010-7000-8000-000000000008'::uuid,
  '0192f1a2-2007-7000-8000-000000000003'::uuid
);
select is((select (j->'item'->>'source_recipe_id')::uuid from rpc_out),
          '0192f1a2-2007-7000-8000-000000000001'::uuid,
          'Bestehende Quelle wird beim Aggregieren nicht ueberschrieben');

-- 3.7 Masse: 1 kg + 500 g -> 1,5 kg in der Einheit der vorhandenen Zeile.
truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Mehl', 1, 'kg'::public.unit_enum,
  '0192f1a2-2010-7000-8000-000000000009'::uuid
);
truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Mehl', 500, 'g'::public.unit_enum,
  '0192f1a2-2010-7000-8000-00000000000a'::uuid
);
select is((select j->>'created' from rpc_out), 'false',
          'Mehl 500 g aggregiert in die 1-kg-Zeile');
select is((select (j->'item'->>'quantity')::numeric from rpc_out), 1.5::numeric,
          'Mehl-Menge wurde zu 1,5 kg addiert');
select is((select j->'item'->>'unit' from rpc_out), 'kg',
          'Mehl bleibt in der Einheit kg');

-- 3.8 Stueck-Einheiten werden nicht zwischen verschiedenen Einheiten umgerechnet.
truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Eier', 6, 'Stk'::public.unit_enum,
  '0192f1a2-2010-7000-8000-00000000000b'::uuid
);
truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Eier', 1, 'Packung'::public.unit_enum,
  '0192f1a2-2010-7000-8000-00000000000c'::uuid
);
select is((select j->>'created' from rpc_out), 'true',
          'Stk und Packung werden nicht umgerechnet: neue Zeile');
select is((select count(*) from public.list_items
            where list_id = '0192f1a2-2004-7000-8000-000000000001'
              and name_normalized = 'eier' and deleted_at is null),
          2::bigint,
          'Eier existieren als zwei Zeilen (Stk und Packung)');

-- 3.9 Eine zusaetzliche Zeile fuer die Ledger-RLS-Pruefung.
truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Zucker', 1, 'kg'::public.unit_enum,
  '0192f1a2-2010-7000-8000-00000000000d'::uuid
);
select is((select j->>'created' from rpc_out), 'true',
          'Zucker wurde als neue Zeile angelegt');

select is((select count(*) from public.add_to_list_requests
            where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
          12::bigint,
          'Owner A hat 12 Request-Eintraege im Ledger (12 neu, Replay erzeugt keinen Eintrag)');

-- -----------------------------------------------------------------------------
-- 4. Viewer D — kein Schreibzugriff
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

select throws_ok(
  $$ select public.add_to_list(
       '0192f1a2-2004-7000-8000-000000000001'::uuid, 'Butter', 1, 'kg'::public.unit_enum,
       '0192f1a2-2010-7000-8000-00000000000e'::uuid) $$,
  '42501', null,
  'Viewer darf add_to_list nicht ausfuehren (RLS)'
);

select throws_ok(
  $$ insert into public.list_items (id, list_id, name, name_normalized)
     values ('0192f1a2-2005-7000-8000-000000000099',
             '0192f1a2-2004-7000-8000-000000000001', 'X', 'x') $$,
  '42501', null,
  'Viewer darf Items nicht direkt anlegen (RLS)'
);

select is((select count(*) from public.recipes
            where id = '0192f1a2-2007-7000-8000-000000000001'),
          1::bigint,
          'Viewer (Mitglied) sieht Rezept R1');

-- -----------------------------------------------------------------------------
-- 5. Nichtmitglied C — kein Zugriff auf H1
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

select throws_ok(
  $$ select public.add_to_list(
       '0192f1a2-2004-7000-8000-000000000001'::uuid, 'Butter', 1, 'kg'::public.unit_enum,
       '0192f1a2-2010-7000-8000-00000000000f'::uuid) $$,
  '42501', null,
  'Nichtmitglied darf add_to_list auf fremder Liste nicht ausfuehren'
);

select is((select count(*) from public.recipes
            where id = '0192f1a2-2007-7000-8000-000000000001'),
          0::bigint,
          'Nichtmitglied sieht Rezept R1 nicht');

select is((select count(*) from public.add_to_list_requests
            where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
          0::bigint,
          'Nichtmitglied sieht fremde Ledger-Eintraege nicht (RLS)');

-- -----------------------------------------------------------------------------
-- 6. Editor B — Schreibzugriff auf H1
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

truncate rpc_out;
insert into rpc_out
select public.add_to_list(
  '0192f1a2-2004-7000-8000-000000000001'::uuid,
  'Milch', 250, 'ml'::public.unit_enum,
  '0192f1a2-2010-7000-8000-000000000010'::uuid
);
select is((select j->>'created' from rpc_out), 'false',
          'Editor darf aggregieren (created=false)');
select is((select (j->'item'->>'quantity')::numeric from rpc_out), 2::numeric,
          'Editor-Aggregation: Milch steht jetzt bei 2 l');

select lives_ok(
  $$ update public.recipes set title = 'Rezept 1 (Editor)'
      where id = '0192f1a2-2007-7000-8000-000000000001' $$,
  'Editor darf ein Rezept aendern'
);

select is((select title from public.recipes
            where id = '0192f1a2-2007-7000-8000-000000000001'),
          'Rezept 1 (Editor)',
          'Editor-Aenderung am Rezept ist sichtbar');

select lives_ok(
  $$ insert into public.recipes (id, household_id, title)
     values ('0192f1a2-2008-7000-8000-000000000001',
             '0192f1a2-2002-7000-8000-000000000001', 'Neues Rezept') $$,
  'Editor darf ein Rezept anlegen'
);

-- -----------------------------------------------------------------------------
-- 7. Rezept-RLS: Viewer/Nichtmitglied schreiben nicht, Editor schon
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

update public.recipes set title = 'Geaendert von Viewer'
 where id = '0192f1a2-2007-7000-8000-000000000001';

select is((select title from public.recipes
            where id = '0192f1a2-2007-7000-8000-000000000001'),
          'Rezept 1 (Editor)',
          'Viewer darf ein Rezept nicht aendern (RLS filtert das UPDATE)');

select throws_ok(
  $$ insert into public.recipes (id, household_id, title)
     values ('0192f1a2-2008-7000-8000-000000000002',
             '0192f1a2-2002-7000-8000-000000000001', 'Viewer-Rezept') $$,
  '42501', null,
  'Viewer darf kein Rezept anlegen (RLS)'
);

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

select throws_ok(
  $$ insert into public.recipes (id, household_id, title)
     values ('0192f1a2-2008-7000-8000-000000000003',
             '0192f1a2-2002-7000-8000-000000000001', 'Fremd-Rezept') $$,
  '42501', null,
  'Nichtmitglied darf kein Rezept in H1 anlegen (RLS)'
);

-- -----------------------------------------------------------------------------
-- 8. Ledger-RLS: Owner A sieht eigene Eintraege
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select ok(
  (select count(*) from public.add_to_list_requests
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') > 0,
  'Owner A sieht eigene Ledger-Eintraege'
);

rollback;
