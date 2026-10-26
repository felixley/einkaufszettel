-- =============================================================================
-- Einkaufszettel — pgTAP: RLS-Abdeckungsluecken (T5.3a)
-- =============================================================================
-- Ausfuehren mit: supabase test db   (oder psql -f auf einer Wegwerf-DB)
-- Die Tests laufen in einer Transaktion und werden am Ende zurueckgerollt.
--
-- Diese Suite schliesst Abdeckungsluecken aus 01_rls.sql fuer Policies, die
-- dort nicht (oder nur indirekt ueber RPCs) geprueft werden:
--   * categories        SELECT/INSERT/UPDATE/NO_DELETE
--   * category_rules    SELECT/INSERT/UPDATE/NO_DELETE
--   * recipes           SELECT/INSERT/UPDATE/NO_DELETE (Write-Policies)
--   * recipe_ingredients SELECT/INSERT/UPDATE/NO_DELETE
--   * profiles          INSERT/UPDATE/NO_DELETE + Soft-Delete-Sichtbarkeit
--   * invites           SELECT/INSERT/UPDATE/NO_DELETE (direkte DML-Policies)
--   * lists             INSERT/UPDATE/NO_DELETE + Soft-Delete-Sichtbarkeit
--   * list_items        NO_DELETE (Policy-Ebene)
--   * add_to_list_requests SELECT/INSERT (Isolation zwischen Nutzern)
--
-- Systemgrenze (siehe docs/SECURITY-RLS-COVERAGE.md):
--   authenticated hat laut Migration 002 nur SELECT/INSERT/UPDATE-Grants,
--   KEIN DELETE-Grant. Ein DELETE-Versuch scheitert daher bereits an der
--   Privilegienpruefung (SQLSTATE 42501), bevor RLS/Trigger greifen. Die
--   Tests belegen damit das End-zu-End-Verbot, nicht isoliert die
--   USING(false)-Policy. Rest-Risiko fuer service_role ist dokumentiert.
--
-- Restluecken (bewusst nicht als gruener Test, siehe Coverage-Doku):
--   * Soft-Delete per UPDATE ist fuer categories/category_rules/recipes/
--     recipe_ingredients/households/invites derzeit durch die jeweilige
--     SELECT-Policy (deleted_at IS NULL) blockiert (analog Befund 004/006).
--     Diese Pfade sind im MVP nicht bebaut; Fix waere eine eigene Migration.
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

-- Feste, clientseitig erzeugte UUIDv7-IDs (13. Zeichen = '7').
--   H1  0192f1a2-3001-7000-8000-000000000001   (Owner A)
--   H2  0192f1a2-3001-7000-8000-000000000002   (Owner C)
--   Cat 0192f1a2-3002-7000-8000-00000000000{1,2}
--   Rule 0192f1a2-3003-7000-8000-00000000000{1,2}
--   Liste 0192f1a2-3004-7000-8000-00000000000{1,2}
--   Item 0192f1a2-3005-7000-8000-00000000000{1,2}
--   Rezept 0192f1a2-3006-7000-8000-00000000000{1,2}
--   Zutat 0192f1a2-3007-7000-8000-00000000000{1,2}
--   Invite 0192f1a2-3008-7000-8000-00000000000{1,2}
--   Ledger 0192f1a2-3009-7000-8000-00000000000{1,2}
insert into public.households (id, name, owner_id) values
  ('0192f1a2-3001-7000-8000-000000000001', 'H1 RLS-Gaps', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('0192f1a2-3001-7000-8000-000000000002', 'H2 RLS-Gaps', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
on conflict (id) do nothing;

insert into public.household_members (id, household_id, user_id, role) values
  ('0192f1a2-3000-7000-8000-000000000001', '0192f1a2-3001-7000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner'),
  ('0192f1a2-3000-7000-8000-000000000002', '0192f1a2-3001-7000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'editor'),
  ('0192f1a2-3000-7000-8000-000000000003', '0192f1a2-3001-7000-8000-000000000001', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'viewer'),
  ('0192f1a2-3000-7000-8000-000000000004', '0192f1a2-3001-7000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'owner')
on conflict (id) do nothing;

insert into public.categories (id, household_id, key, label, sort_order) values
  ('0192f1a2-3002-7000-8000-000000000001', '0192f1a2-3001-7000-8000-000000000001', 'h1_cat', 'H1 Kategorie', 10),
  ('0192f1a2-3002-7000-8000-000000000002', '0192f1a2-3001-7000-8000-000000000002', 'h2_cat', 'H2 Kategorie', 20)
on conflict (id) do nothing;

insert into public.category_rules (id, household_id, keyword, category_id) values
  ('0192f1a2-3003-7000-8000-000000000001', '0192f1a2-3001-7000-8000-000000000001', 'h1_kw', '0192f1a2-3002-7000-8000-000000000001'),
  ('0192f1a2-3003-7000-8000-000000000002', '0192f1a2-3001-7000-8000-000000000002', 'h2_kw', '0192f1a2-3002-7000-8000-000000000002')
on conflict (id) do nothing;

insert into public.lists (id, household_id, name) values
  ('0192f1a2-3004-7000-8000-000000000001', '0192f1a2-3001-7000-8000-000000000001', 'Liste H1'),
  ('0192f1a2-3004-7000-8000-000000000002', '0192f1a2-3001-7000-8000-000000000002', 'Liste H2')
on conflict (id) do nothing;

insert into public.list_items (id, list_id, name, name_normalized) values
  ('0192f1a2-3005-7000-8000-000000000001', '0192f1a2-3004-7000-8000-000000000001', 'Milch', 'milch'),
  ('0192f1a2-3005-7000-8000-000000000002', '0192f1a2-3004-7000-8000-000000000002', 'Brot',  'brot')
on conflict (id) do nothing;

insert into public.recipes (id, household_id, title) values
  ('0192f1a2-3006-7000-8000-000000000001', '0192f1a2-3001-7000-8000-000000000001', 'Rezept H1'),
  ('0192f1a2-3006-7000-8000-000000000002', '0192f1a2-3001-7000-8000-000000000002', 'Rezept H2')
on conflict (id) do nothing;

insert into public.recipe_ingredients (id, recipe_id, name) values
  ('0192f1a2-3007-7000-8000-000000000001', '0192f1a2-3006-7000-8000-000000000001', 'Zutat H1'),
  ('0192f1a2-3007-7000-8000-000000000002', '0192f1a2-3006-7000-8000-000000000002', 'Zutat H2')
on conflict (id) do nothing;

insert into public.invites (id, household_id, token_hash, role) values
  ('0192f1a2-3008-7000-8000-000000000001', '0192f1a2-3001-7000-8000-000000000001', repeat('1', 64), 'viewer'),
  ('0192f1a2-3008-7000-8000-000000000002', '0192f1a2-3001-7000-8000-000000000002', repeat('2', 64), 'viewer')
on conflict (id) do nothing;

insert into public.add_to_list_requests (request_id, user_id, list_id) values
  ('0192f1a2-3009-7000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '0192f1a2-3004-7000-8000-000000000001'),
  ('0192f1a2-3009-7000-8000-000000000002', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '0192f1a2-3004-7000-8000-000000000002')
on conflict (request_id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Strukturpruefung: RLS ist auf allen 11 Tabellen aktiv
-- -----------------------------------------------------------------------------
select is(
  (select count(*) from pg_tables
    where schemaname = 'public'
      and rowsecurity
      and tablename in ('profiles','households','household_members','invites',
                        'lists','list_items','categories','category_rules',
                        'recipes','recipe_ingredients','add_to_list_requests')),
  11::bigint,
  'RLS ist auf allen 11 Tabellen aktiv (10 aus PLAN §4.1 + Ledger)'
);

-- =============================================================================
-- 3. categories — SELECT/INSERT/UPDATE/NO_DELETE
-- =============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is((select count(*) from public.categories
            where id = '0192f1a2-3002-7000-8000-000000000001'), 1::bigint,
          'Owner A sieht die H1-Kategorie');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*) from public.categories
            where id = '0192f1a2-3002-7000-8000-000000000001'), 1::bigint,
          'Editor B sieht die H1-Kategorie');

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select is((select count(*) from public.categories
            where id = '0192f1a2-3002-7000-8000-000000000001'), 1::bigint,
          'Viewer D sieht die H1-Kategorie');

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select is((select count(*) from public.categories
            where id = '0192f1a2-3002-7000-8000-000000000001'), 0::bigint,
          'Outsider C (nur H2) sieht die H1-Kategorie nicht');

select is((select count(*) from public.categories
            where id = '0192f1a2-0000-7000-8000-000000000001'), 1::bigint,
          'Outsider C sieht globale Kategorien (Seed)');

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select throws_ok(
  $$ insert into public.categories (id, household_id, key, label)
     values ('0192f1a2-3002-7000-8000-000000000003',
             '0192f1a2-3001-7000-8000-000000000001', 'd_cat', 'D Kategorie') $$,
  '42501', null,
  'Viewer D darf keine H1-Kategorie anlegen'
);

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select throws_ok(
  $$ insert into public.categories (id, household_id, key, label)
     values ('0192f1a2-3002-7000-8000-000000000004',
             '0192f1a2-3001-7000-8000-000000000001', 'c_cat', 'C Kategorie') $$,
  '42501', null,
  'Outsider C darf keine H1-Kategorie anlegen'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select lives_ok(
  $$ insert into public.categories (id, household_id, key, label)
     values ('0192f1a2-3002-7000-8000-000000000003',
             '0192f1a2-3001-7000-8000-000000000001', 'b_cat', 'B Kategorie') $$,
  'Editor B darf eine H1-Kategorie anlegen (Writer)'
);

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok(
  $$ insert into public.categories (id, household_id, key, label)
     values ('0192f1a2-3002-7000-8000-000000000005', null, 'global_x', 'Global X') $$,
  '42501', null,
  'Owner A darf keine globale Kategorie anlegen (household_id NOT NULL)'
);

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
with upd as (
  update public.categories set label = 'Von Viewer geaendert'
   where id = '0192f1a2-3002-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 0::bigint,
          'Viewer D aendert keine H1-Kategorie (0 Zeilen, RLS)');

select is((select label from public.categories
            where id = '0192f1a2-3002-7000-8000-000000000001'),
          'H1 Kategorie',
          'Label der H1-Kategorie bleibt nach Viewer-UPDATE unveraendert');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
with upd as (
  update public.categories set label = 'H1 Kategorie (B)'
   where id = '0192f1a2-3002-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 1::bigint,
          'Editor B aendert die H1-Kategorie (Writer)');

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
with upd as (
  update public.categories set label = 'Von Outsider geaendert'
   where id = '0192f1a2-3002-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 0::bigint,
          'Outsider C aendert keine H1-Kategorie (0 Zeilen, RLS)');

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select label from public.categories
            where id = '0192f1a2-3002-7000-8000-000000000001'),
          'H1 Kategorie (B)',
          'Label bleibt nach Outsider-UPDATE unveraendert');

with upd as (
  update public.categories set label = 'Global gehackt'
   where id = '0192f1a2-0000-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 0::bigint,
          'Owner A aendert keine globale Kategorie (0 Zeilen, RLS)');

select is((select label from public.categories
            where id = '0192f1a2-0000-7000-8000-000000000001'),
          'Obst & Gemüse',
          'Globales Kategorie-Label bleibt unveraendert');

select throws_ok(
  $$ delete from public.categories
     where id = '0192f1a2-3002-7000-8000-000000000001' $$,
  '42501', null,
  'Owner A kann Kategorien nicht physisch loeschen (kein DELETE-Grant)'
);

-- =============================================================================
-- 4. category_rules — SELECT/INSERT/UPDATE/NO_DELETE
-- =============================================================================
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select count(*) from public.category_rules
            where id = '0192f1a2-3003-7000-8000-000000000001'), 1::bigint,
          'Owner A sieht die H1-Regel');

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select is((select count(*) from public.category_rules
            where id = '0192f1a2-3003-7000-8000-000000000001'), 1::bigint,
          'Viewer D sieht die H1-Regel');

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select is((select count(*) from public.category_rules
            where id = '0192f1a2-3003-7000-8000-000000000001'), 0::bigint,
          'Outsider C sieht die H1-Regel nicht');

select ok(
  (select count(*) from public.category_rules where household_id is null) > 0,
  'Outsider C sieht globale Keyword-Regeln (Seed)'
);

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select throws_ok(
  $$ insert into public.category_rules (id, household_id, keyword, category_id)
     values ('0192f1a2-3003-7000-8000-000000000003',
             '0192f1a2-3001-7000-8000-000000000001', 'd_kw',
             '0192f1a2-3002-7000-8000-000000000001') $$,
  '42501', null,
  'Viewer D darf keine H1-Regel anlegen'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select lives_ok(
  $$ insert into public.category_rules (id, household_id, keyword, category_id)
     values ('0192f1a2-3003-7000-8000-000000000003',
             '0192f1a2-3001-7000-8000-000000000001', 'b_kw',
             '0192f1a2-3002-7000-8000-000000000001') $$,
  'Editor B darf eine H1-Regel anlegen (Writer)'
);

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok(
  $$ insert into public.category_rules (id, household_id, keyword, category_id)
     values ('0192f1a2-3003-7000-8000-000000000005', null, 'global_kw',
             '0192f1a2-0000-7000-8000-000000000001') $$,
  '42501', null,
  'Owner A darf keine globale Regel anlegen (household_id NOT NULL)'
);

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
with upd as (
  update public.category_rules set keyword = 'viewer_kw'
   where id = '0192f1a2-3003-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 0::bigint,
          'Viewer D aendert keine H1-Regel (0 Zeilen, RLS)');

select is((select keyword from public.category_rules
            where id = '0192f1a2-3003-7000-8000-000000000001'),
          'h1_kw',
          'Keyword der H1-Regel bleibt nach Viewer-UPDATE unveraendert');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
with upd as (
  update public.category_rules set keyword = 'h1_kw_b'
   where id = '0192f1a2-3003-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 1::bigint,
          'Editor B aendert die H1-Regel (Writer)');

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok(
  $$ delete from public.category_rules
     where id = '0192f1a2-3003-7000-8000-000000000001' $$,
  '42501', null,
  'Owner A kann Regeln nicht physisch loeschen (kein DELETE-Grant)'
);

-- =============================================================================
-- 5. recipes — Write-Policies (SELECT bereits in 01/05)
-- =============================================================================
set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select is((select count(*) from public.recipes
            where id = '0192f1a2-3006-7000-8000-000000000001'), 1::bigint,
          'Viewer D sieht das H1-Rezept (SELECT)');

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select is((select count(*) from public.recipes
            where id = '0192f1a2-3006-7000-8000-000000000001'), 0::bigint,
          'Outsider C sieht das H1-Rezept nicht');

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select throws_ok(
  $$ insert into public.recipes (id, household_id, title)
     values ('0192f1a2-3006-7000-8000-000000000003',
             '0192f1a2-3001-7000-8000-000000000001', 'Viewer-Rezept') $$,
  '42501', null,
  'Viewer D darf kein H1-Rezept anlegen'
);

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select throws_ok(
  $$ insert into public.recipes (id, household_id, title)
     values ('0192f1a2-3006-7000-8000-000000000004',
             '0192f1a2-3001-7000-8000-000000000001', 'Outsider-Rezept') $$,
  '42501', null,
  'Outsider C darf kein H1-Rezept anlegen'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select lives_ok(
  $$ insert into public.recipes (id, household_id, title)
     values ('0192f1a2-3006-7000-8000-000000000003',
             '0192f1a2-3001-7000-8000-000000000001', 'B-Rezept') $$,
  'Editor B darf ein H1-Rezept anlegen (Writer)'
);

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
with upd as (
  update public.recipes set title = 'Von Viewer geaendert'
   where id = '0192f1a2-3006-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 0::bigint,
          'Viewer D aendert kein H1-Rezept (0 Zeilen, RLS)');

select is((select title from public.recipes
            where id = '0192f1a2-3006-7000-8000-000000000001'),
          'Rezept H1',
          'Rezept-Titel bleibt nach Viewer-UPDATE unveraendert');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
with upd as (
  update public.recipes set title = 'Rezept H1 (B)'
   where id = '0192f1a2-3006-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 1::bigint,
          'Editor B aendert das H1-Rezept (Writer)');

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok(
  $$ delete from public.recipes
     where id = '0192f1a2-3006-7000-8000-000000000001' $$,
  '42501', null,
  'Owner A kann Rezepte nicht physisch loeschen (kein DELETE-Grant)'
);

-- =============================================================================
-- 6. recipe_ingredients — SELECT/INSERT/UPDATE/NO_DELETE
-- =============================================================================
set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select is((select count(*) from public.recipe_ingredients
            where id = '0192f1a2-3007-7000-8000-000000000001'), 1::bigint,
          'Viewer D sieht die H1-Zutat');

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select is((select count(*) from public.recipe_ingredients
            where id = '0192f1a2-3007-7000-8000-000000000001'), 0::bigint,
          'Outsider C sieht die H1-Zutat nicht');

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select throws_ok(
  $$ insert into public.recipe_ingredients (id, recipe_id, name)
     values ('0192f1a2-3007-7000-8000-000000000003',
             '0192f1a2-3006-7000-8000-000000000001', 'Viewer-Zutat') $$,
  '42501', null,
  'Viewer D darf keine H1-Zutat anlegen'
);

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select throws_ok(
  $$ insert into public.recipe_ingredients (id, recipe_id, name)
     values ('0192f1a2-3007-7000-8000-000000000004',
             '0192f1a2-3006-7000-8000-000000000001', 'Outsider-Zutat') $$,
  '42501', null,
  'Outsider C darf keine H1-Zutat anlegen'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select lives_ok(
  $$ insert into public.recipe_ingredients (id, recipe_id, name)
     values ('0192f1a2-3007-7000-8000-000000000003',
             '0192f1a2-3006-7000-8000-000000000001', 'B-Zutat') $$,
  'Editor B darf eine H1-Zutat anlegen (Writer)'
);

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
with upd as (
  update public.recipe_ingredients set name = 'Von Viewer geaendert'
   where id = '0192f1a2-3007-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 0::bigint,
          'Viewer D aendert keine H1-Zutat (0 Zeilen, RLS)');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
with upd as (
  update public.recipe_ingredients set name = 'Zutat H1 (B)'
   where id = '0192f1a2-3007-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 1::bigint,
          'Editor B aendert die H1-Zutat (Writer)');

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok(
  $$ delete from public.recipe_ingredients
     where id = '0192f1a2-3007-7000-8000-000000000001' $$,
  '42501', null,
  'Owner A kann Zutaten nicht physisch loeschen (kein DELETE-Grant)'
);

-- =============================================================================
-- 7. invites — direkte DML-Policies (RPC-Pfad bereits in 03)
-- =============================================================================
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select count(*) from public.invites
            where id = '0192f1a2-3008-7000-8000-000000000001'), 1::bigint,
          'Owner A sieht den H1-Invite');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*) from public.invites
            where id = '0192f1a2-3008-7000-8000-000000000001'), 0::bigint,
          'Editor B sieht den H1-Invite nicht (Owner-only)');

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select is((select count(*) from public.invites
            where id = '0192f1a2-3008-7000-8000-000000000001'), 0::bigint,
          'Outsider C sieht den H1-Invite nicht');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
with upd as (
  update public.invites set revoked_at = now()
   where id = '0192f1a2-3008-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 0::bigint,
          'Editor B widerruft keinen H1-Invite (0 Zeilen, RLS)');

select is((select revoked_at from public.invites
            where id = '0192f1a2-3008-7000-8000-000000000001'),
          null::timestamptz,
          'Invite bleibt nach Nicht-Owner-UPDATE unangetastet');

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
with upd as (
  update public.invites set revoked_at = now()
   where id = '0192f1a2-3008-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 1::bigint,
          'Owner A widerruft den H1-Invite (UPDATE erlaubt)');

select ok(
  (select revoked_at from public.invites
    where id = '0192f1a2-3008-7000-8000-000000000001') is not null,
  'revoked_at ist nach Owner-Widerruf gesetzt'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select throws_ok(
  $$ insert into public.invites (id, household_id, token_hash, role)
     values ('0192f1a2-3008-7000-8000-000000000003',
             '0192f1a2-3001-7000-8000-000000000001', repeat('b', 64), 'viewer') $$,
  '42501', null,
  'Editor B darf keinen H1-Invite anlegen (Owner-only)'
);

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select lives_ok(
  $$ insert into public.invites (id, household_id, token_hash, role)
     values ('0192f1a2-3008-7000-8000-000000000003',
             '0192f1a2-3001-7000-8000-000000000001', repeat('b', 64), 'viewer') $$,
  'Owner A darf einen H1-Invite anlegen'
);

select throws_ok(
  $$ delete from public.invites
     where id = '0192f1a2-3008-7000-8000-000000000001' $$,
  '42501', null,
  'Owner A kann Invites nicht physisch loeschen (kein DELETE-Grant)'
);

-- =============================================================================
-- 8. households / household_members — INSERT-Owner-Check und NO_DELETE
-- =============================================================================
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok(
  $$ insert into public.households (id, name, owner_id)
     values ('0192f1a2-3001-7000-8000-000000000003', 'Fremd-Haushalt',
             'cccccccc-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null,
  'Owner A legt keinen Haushalt fuer C an (owner_id = auth.uid() noetig)'
);

select lives_ok(
  $$ insert into public.households (id, name, owner_id)
     values ('0192f1a2-3001-7000-8000-000000000003', 'H3 von A',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  'Owner A legt einen eigenen Haushalt an (Bootstrap-INSERT)'
);

-- Bootstrap wie in echten Clients (create_household): Owner-Mitgliedszeile
-- muss existieren, sonst ist is_household_owner(hid) zu Recht false.
select lives_ok(
  $$ insert into public.household_members (id, household_id, user_id, role)
     values ('0192f1a2-3000-7000-8000-000000000005',
             '0192f1a2-3001-7000-8000-000000000003',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner') $$,
  'Owner A legt die erste Owner-Mitgliedszeile fuer H3 an (Bootstrap)'
);

with upd as (
  update public.households set name = 'H3 von A (umbenannt)'
   where id = '0192f1a2-3001-7000-8000-000000000003'
  returning 1
)
select is((select count(*) from upd), 1::bigint,
          'Owner A darf den eigenen Haushalt umbenennen (households_update)');

select is((select name from public.households
            where id = '0192f1a2-3001-7000-8000-000000000003'),
          'H3 von A (umbenannt)',
          'Umbenennen des eigenen Haushalts ist sichtbar');

select throws_ok(
  $$ delete from public.households
     where id = '0192f1a2-3001-7000-8000-000000000003' $$,
  '42501', null,
  'Owner A kann Haushalte nicht physisch loeschen (kein DELETE-Grant)'
);

select throws_ok(
  $$ delete from public.household_members
     where id = '0192f1a2-3000-7000-8000-000000000002' $$,
  '42501', null,
  'Owner A kann Mitgliedschaften nicht physisch loeschen (kein DELETE-Grant)'
);

-- =============================================================================
-- 9. lists — direkte DML-Policies + Soft-Delete-Sichtbarkeit (Fix 004)
-- =============================================================================
set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select throws_ok(
  $$ insert into public.lists (id, household_id, name)
     values ('0192f1a2-3004-7000-8000-000000000003',
             '0192f1a2-3001-7000-8000-000000000001', 'Viewer-Liste') $$,
  '42501', null,
  'Viewer D darf keine H1-Liste anlegen'
);

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select throws_ok(
  $$ insert into public.lists (id, household_id, name)
     values ('0192f1a2-3004-7000-8000-000000000004',
             '0192f1a2-3001-7000-8000-000000000001', 'Outsider-Liste') $$,
  '42501', null,
  'Outsider C darf keine H1-Liste anlegen'
);

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select lives_ok(
  $$ insert into public.lists (id, household_id, name)
     values ('0192f1a2-3004-7000-8000-000000000003',
             '0192f1a2-3001-7000-8000-000000000001', 'B-Liste') $$,
  'Editor B darf eine H1-Liste anlegen (Writer)'
);

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
with upd as (
  update public.lists set name = 'Von Viewer geaendert'
   where id = '0192f1a2-3004-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 0::bigint,
          'Viewer D aendert keine H1-Liste (0 Zeilen, RLS)');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
with upd as (
  update public.lists set name = 'Liste H1 (B)'
   where id = '0192f1a2-3004-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 1::bigint,
          'Editor B aendert die H1-Liste (Writer)');

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
with upd as (
  update public.lists set name = 'Von Outsider geaendert'
   where id = '0192f1a2-3004-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 0::bigint,
          'Outsider C aendert keine H1-Liste (0 Zeilen, RLS)');

-- Soft-Delete: Writer (Owner/Editor) sehen soft-geloeschte Listen (Fix 004),
-- Viewer nicht.
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
with upd as (
  update public.lists set deleted_at = now()
   where id = '0192f1a2-3004-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 1::bigint,
          'Owner A soft-loescht die H1-Liste (UPDATE deleted_at)');

select is((select count(*) from public.lists
            where id = '0192f1a2-3004-7000-8000-000000000001'), 1::bigint,
          'Owner A sieht die soft-geloeschte H1-Liste weiterhin');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*) from public.lists
            where id = '0192f1a2-3004-7000-8000-000000000001'), 1::bigint,
          'Editor B sieht die soft-geloeschte H1-Liste weiterhin (Writer)');

set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
select is((select count(*) from public.lists
            where id = '0192f1a2-3004-7000-8000-000000000001'), 0::bigint,
          'Viewer D sieht die soft-geloeschte H1-Liste nicht mehr');

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
with upd as (
  update public.lists set deleted_at = null
   where id = '0192f1a2-3004-7000-8000-000000000001'
  returning 1
)
select is((select count(*) from upd), 1::bigint,
          'Owner A stellt die H1-Liste wieder her (deleted_at = null)');

select throws_ok(
  $$ delete from public.lists
     where id = '0192f1a2-3004-7000-8000-000000000001' $$,
  '42501', null,
  'Owner A kann Listen nicht physisch loeschen (kein DELETE-Grant)'
);

-- =============================================================================
-- 10. list_items — NO_DELETE auf Policy-Ebene
-- =============================================================================
select throws_ok(
  $$ delete from public.list_items
     where id = '0192f1a2-3005-7000-8000-000000000001' $$,
  '42501', null,
  'Owner A kann Items nicht physisch loeschen (kein DELETE-Grant)'
);

-- =============================================================================
-- 11. profiles — INSERT/UPDATE/NO_DELETE + Soft-Delete-Sichtbarkeit
-- =============================================================================
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select count(*) from public.profiles
            where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1::bigint,
          'Owner A sieht das eigene Profil');

select is((select count(*) from public.profiles
            where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1::bigint,
          'Owner A sieht das Profil von Editor B (gemeinsamer Haushalt)');

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select is((select count(*) from public.profiles
            where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint,
          'Outsider C sieht das Owner-A-Profil nicht');

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok(
  $$ insert into public.profiles (id, display_name)
     values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Gefaelscht') $$,
  '42501', null,
  'Owner A darf kein fremdes Profil anlegen (id = auth.uid() noetig)'
);

with upd as (
  update public.profiles set display_name = 'Von A geaendert'
   where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  returning 1
)
select is((select count(*) from upd), 0::bigint,
          'Owner A aendert kein fremdes Profil (0 Zeilen, RLS)');

set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
-- Achtung: Migration 007 legt profiles per auth.users-Trigger an und setzt
-- display_name aus dem E-Mail-Lokalteil ('c-outsider'); der Setup-INSERT in
-- profiles ist deshalb ein No-op (ON CONFLICT DO NOTHING).
select is((select display_name from public.profiles
            where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
          'c-outsider',
          'Profil von C bleibt nach fremdem UPDATE unveraendert');

set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
with upd as (
  update public.profiles set display_name = 'Owner A (neu)'
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  returning 1
)
select is((select count(*) from upd), 1::bigint,
          'Owner A aendert das eigene Profil (erlaubt)');

select throws_ok(
  $$ delete from public.profiles
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' $$,
  '42501', null,
  'Owner A kann sein Profil nicht physisch loeschen (kein DELETE-Grant)'
);

-- Soft-Delete eines fremden Profils (Superuser, RLS umgangen): danach ist es
-- fuer Haushaltsmitglieder unsichtbar, der Nutzer selbst sieht es weiter.
reset role;
update public.profiles set deleted_at = now()
 where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select count(*) from public.profiles
            where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0::bigint,
          'Soft-geloeschtes fremdes Profil ist fuer Haushaltsmitglieder unsichtbar');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*) from public.profiles
            where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1::bigint,
          'Eigenes soft-geloeschtes Profil bleibt fuer den Nutzer sichtbar');

-- =============================================================================
-- 12. add_to_list_requests — Isolation zwischen Nutzern
-- =============================================================================
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select ok(
  (select count(*) from public.add_to_list_requests
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') > 0,
  'Owner A sieht eigene Ledger-Eintraege'
);

select is(
  (select count(*) from public.add_to_list_requests
    where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'), 0::bigint,
  'Owner A sieht keine Ledger-Eintraege von Outsider C'
);

select throws_ok(
  $$ insert into public.add_to_list_requests (request_id, user_id, list_id)
     values ('0192f1a2-3009-7000-8000-000000000003',
             'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
             '0192f1a2-3004-7000-8000-000000000001') $$,
  '42501', null,
  'Owner A darf keinen Ledger-Eintrag fuer C anlegen (user_id = auth.uid())'
);

select lives_ok(
  $$ insert into public.add_to_list_requests (request_id, user_id, list_id)
     values ('0192f1a2-3009-7000-8000-000000000004',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
             '0192f1a2-3004-7000-8000-000000000001') $$,
  'Owner A darf einen eigenen Ledger-Eintrag anlegen'
);

-- Ledger ist append-only: Migration 008 gewaehrt authenticated nur
-- SELECT/INSERT. UPDATE/DELETE scheitern daher bereits an der Privilegien-
-- pruefung (kein Grant), zusaetzlich existiert keine UPDATE/DELETE-Policy.
select throws_ok(
  $$ update public.add_to_list_requests
        set list_id = '0192f1a2-3004-7000-8000-000000000002'
      where request_id = '0192f1a2-3009-7000-8000-000000000001' $$,
  '42501', null,
  'Ledger-Eintraege sind unveraenderlich (UPDATE ohne Grant verweigert)'
);

reset role;
select * from finish();
rollback;
