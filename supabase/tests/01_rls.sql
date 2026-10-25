-- =============================================================================
-- Einkaufszettel — pgTAP: Row Level Security (PLAN.md §4.5, T1.4)
-- =============================================================================
-- Ausfuehren mit: supabase test db   (oder psql -f auf einer Wegwerf-DB)
-- Die Tests laufen in einer Transaktion und werden am Ende zurueckgerollt.
--
-- Abgedeckte Akzeptanzkriterien aus PLAN.md §4.1/§4.5:
--   * Nichtmitglied sieht nichts.
--   * Viewer kann nicht schreiben.
--   * Editor kann Items aendern.
--   * Nur Owner verwaltet Mitglieder.
--   * Soft-Delete (deleted_at) statt physischem DELETE.
--   * IDs clientseitig (kein DB-Default), updated_at-Trigger vorhanden.
-- =============================================================================
begin;
select no_plan();

-- -----------------------------------------------------------------------------
-- 1. Setup (als Superuser; RLS wird hier bewusst umgangen)
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.test',    'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'editor@example.test',   'authenticated', 'authenticated'),
  ('33333333-3333-4333-8333-333333333333', 'viewer@example.test',   'authenticated', 'authenticated'),
  ('44444444-4444-4444-8444-444444444444', 'outsider@example.test', 'authenticated', 'authenticated'),
  ('55555555-5555-4555-8555-555555555555', 'newbie@example.test',   'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.profiles (id, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'Owner'),
  ('22222222-2222-4222-8222-222222222222', 'Editor'),
  ('33333333-3333-4333-8333-333333333333', 'Viewer'),
  ('44444444-4444-4444-8444-444444444444', 'Outsider'),
  ('55555555-5555-4555-8555-555555555555', 'Newbie')
on conflict (id) do nothing;

insert into public.households (id, name, owner_id) values
  ('0192f1a2-0002-7000-8000-000000000001', 'Haushalt 1', '11111111-1111-4111-8111-111111111111'),
  ('0192f1a2-0002-7000-8000-000000000002', 'Haushalt 2', '44444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

insert into public.household_members (id, household_id, user_id, role) values
  ('0192f1a2-0003-7000-8000-000000000001', '0192f1a2-0002-7000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('0192f1a2-0003-7000-8000-000000000002', '0192f1a2-0002-7000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'editor'),
  ('0192f1a2-0003-7000-8000-000000000003', '0192f1a2-0002-7000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'viewer')
on conflict (id) do nothing;

insert into public.lists (id, household_id, name) values
  ('0192f1a2-0004-7000-8000-000000000001', '0192f1a2-0002-7000-8000-000000000001', 'Liste 1'),
  ('0192f1a2-0004-7000-8000-000000000002', '0192f1a2-0002-7000-8000-000000000002', 'Liste 2')
on conflict (id) do nothing;

insert into public.list_items (id, list_id, name, name_normalized) values
  ('0192f1a2-0005-7000-8000-000000000001', '0192f1a2-0004-7000-8000-000000000001', 'Milch', 'milch'),
  ('0192f1a2-0005-7000-8000-000000000002', '0192f1a2-0004-7000-8000-000000000002', 'Brot',  'brot')
on conflict (id) do nothing;

insert into public.categories (id, household_id, key, label) values
  ('0192f1a2-0006-7000-8000-000000000001', '0192f1a2-0002-7000-8000-000000000001', 'h1_kategorie', 'H1 Kategorie')
on conflict (id) do nothing;

insert into public.category_rules (id, household_id, keyword, category_id) values
  ('0192f1a2-000a-7000-8000-000000000001', '0192f1a2-0002-7000-8000-000000000001', 'h1keyword', '0192f1a2-0006-7000-8000-000000000001')
on conflict (id) do nothing;

insert into public.invites (id, household_id, token_hash, role) values
  ('0192f1a2-0009-7000-8000-000000000001', '0192f1a2-0002-7000-8000-000000000001', repeat('a', 64), 'viewer')
on conflict (id) do nothing;

insert into public.recipes (id, household_id, title) values
  ('0192f1a2-0007-7000-8000-000000000001', '0192f1a2-0002-7000-8000-000000000001', 'Rezept 1')
on conflict (id) do nothing;

insert into public.recipe_ingredients (id, recipe_id, name) values
  ('0192f1a2-0008-7000-8000-000000000001', '0192f1a2-0007-7000-8000-000000000001', 'Zutat 1')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Strukturpruefungen (Superuser)
-- -----------------------------------------------------------------------------
select is(
  (select count(*) from pg_enum e
     join pg_type t on t.oid = e.enumtypid
     join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'unit_enum'),
  13::bigint,
  'unit_enum enthaelt die 13 Einheiten aus PLAN.md §4.3'
);

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'id' and column_default is not null),
  0::bigint,
  'profiles.id hat keinen DB-Default (UUID vom Client)'
);

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'households'
      and column_name = 'id' and column_default is not null),
  0::bigint,
  'households.id hat keinen DB-Default (UUID vom Client)'
);

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'list_items'
      and column_name = 'id' and column_default is not null),
  0::bigint,
  'list_items.id hat keinen DB-Default (UUID vom Client)'
);

select is(
  (select count(*) from information_schema.triggers
    where trigger_schema = 'public' and trigger_name like '%set_updated_at'),
  10::bigint,
  'updated_at-Trigger ist auf allen 10 Tabellen vorhanden'
);

select is(
  (select count(*) from information_schema.triggers
    where trigger_schema = 'public' and trigger_name like '%prevent_delete'),
  9::bigint,
  'prevent_physical_delete-Trigger ist auf 9 Tabellen vorhanden'
);

select is(
  (select count(*) from public.categories where household_id is null and deleted_at is null),
  13::bigint,
  'Seed liefert genau 13 globale Kategorien'
);

select ok(
  (select count(*) from public.category_rules) > 0,
  'Seed liefert Keyword-Regeln (> 0)'
);

select ok(
  not exists (
    select key from public.categories
    where household_id is null and deleted_at is null
    group by key having count(*) > 1
  ),
  'Seed ist idempotent: keine doppelten globalen Kategorien'
);

-- -----------------------------------------------------------------------------
-- 3. Owner (1111...) — Vollzugriff auf H1
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select is((select count(*) from public.households
            where id = '0192f1a2-0002-7000-8000-000000000001'), 1::bigint,
          'Owner sieht H1');

select is((select count(*) from public.lists
            where id = '0192f1a2-0004-7000-8000-000000000001'), 1::bigint,
          'Owner sieht L1');

select is((select count(*) from public.list_items
            where id = '0192f1a2-0005-7000-8000-000000000001'), 1::bigint,
          'Owner sieht I1');

select is((select count(*) from public.categories
            where id = '0192f1a2-0006-7000-8000-000000000001'), 1::bigint,
          'Owner sieht die H1-Kategorie');

select is((select count(*) from public.invites
            where id = '0192f1a2-0009-7000-8000-000000000001'), 1::bigint,
          'Owner sieht den Invite');

select is((select count(*) from public.recipes
            where id = '0192f1a2-0007-7000-8000-000000000001'), 1::bigint,
          'Owner sieht das Rezept');

select lives_ok(
  $$ insert into public.list_items (id, list_id, name, name_normalized)
     values ('0192f1a2-0005-7000-8000-000000000003',
             '0192f1a2-0004-7000-8000-000000000001', 'Butter', 'butter') $$,
  'Owner darf Items anlegen'
);

update public.list_items set checked = true
 where id = '0192f1a2-0005-7000-8000-000000000003';

select is(
  (select checked from public.list_items
    where id = '0192f1a2-0005-7000-8000-000000000003'),
  true,
  'Owner darf Items aendern'
);

select lives_ok(
  $$ insert into public.household_members (id, household_id, user_id, role)
     values ('0192f1a2-0003-7000-8000-000000000004',
             '0192f1a2-0002-7000-8000-000000000001',
             '55555555-5555-4555-8555-555555555555', 'viewer') $$,
  'Owner darf Mitglieder anlegen'
);

update public.household_members set role = 'editor'
 where id = '0192f1a2-0003-7000-8000-000000000004';

select is(
  (select role::text from public.household_members
    where id = '0192f1a2-0003-7000-8000-000000000004'),
  'editor',
  'Owner darf Mitgliederrollen aendern'
);

-- -----------------------------------------------------------------------------
-- 4. Editor (2222...) — Items ja, Mitglieder nein, Haushalt nein
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

select is((select count(*) from public.lists
            where id = '0192f1a2-0004-7000-8000-000000000001'), 1::bigint,
          'Editor sieht L1');

select lives_ok(
  $$ insert into public.list_items (id, list_id, name, name_normalized)
     values ('0192f1a2-0005-7000-8000-000000000004',
             '0192f1a2-0004-7000-8000-000000000001', 'Käse', 'käse') $$,
  'Editor darf Items anlegen'
);

update public.list_items set checked = true
 where id = '0192f1a2-0005-7000-8000-000000000004';

select is(
  (select checked from public.list_items
    where id = '0192f1a2-0005-7000-8000-000000000004'),
  true,
  'Editor darf Items aendern'
);

select throws_ok(
  $$ insert into public.household_members (id, household_id, user_id, role)
     values ('0192f1a2-0003-7000-8000-000000000005',
             '0192f1a2-0002-7000-8000-000000000001',
             '44444444-4444-4444-8444-444444444444', 'viewer') $$,
  '42501',
  null,
  'Editor darf keine Mitglieder anlegen'
);

update public.household_members set role = 'viewer'
 where id = '0192f1a2-0003-7000-8000-000000000001';

select is(
  (select role::text from public.household_members
    where id = '0192f1a2-0003-7000-8000-000000000001'),
  'owner',
  'Editor darf Mitgliederrollen nicht aendern'
);

update public.households set name = 'Hacked'
 where id = '0192f1a2-0002-7000-8000-000000000001';

select is(
  (select name from public.households
    where id = '0192f1a2-0002-7000-8000-000000000001'),
  'Haushalt 1',
  'Editor darf den Haushalt nicht aendern (nur Owner)'
);

select is((select count(*) from public.invites
            where id = '0192f1a2-0009-7000-8000-000000000001'), 0::bigint,
          'Editor sieht keine Invite-Tokens (nur Owner)');

-- -----------------------------------------------------------------------------
-- 5. Viewer (3333...) — nur lesen
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

select is((select count(*) from public.list_items
            where id = '0192f1a2-0005-7000-8000-000000000001'), 1::bigint,
          'Viewer sieht I1');

select throws_ok(
  $$ insert into public.list_items (id, list_id, name, name_normalized)
     values ('0192f1a2-0005-7000-8000-000000000005',
             '0192f1a2-0004-7000-8000-000000000001', 'X', 'x') $$,
  '42501',
  null,
  'Viewer darf keine Items anlegen'
);

update public.list_items set name = 'Y'
 where id = '0192f1a2-0005-7000-8000-000000000001';

select is(
  (select name from public.list_items
    where id = '0192f1a2-0005-7000-8000-000000000001'),
  'Milch',
  'Viewer darf Items nicht aendern'
);

select throws_ok(
  $$ insert into public.household_members (id, household_id, user_id, role)
     values ('0192f1a2-0003-7000-8000-000000000006',
             '0192f1a2-0002-7000-8000-000000000001',
             '44444444-4444-4444-8444-444444444444', 'viewer') $$,
  '42501',
  null,
  'Viewer darf keine Mitglieder anlegen'
);

-- -----------------------------------------------------------------------------
-- 6. Nichtmitglied / Outsider (4444...) — sieht nichts aus H1
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';

select is((select count(*) from public.households
            where id = '0192f1a2-0002-7000-8000-000000000001'), 0::bigint,
          'Nichtmitglied sieht H1 nicht');

select is((select count(*) from public.lists
            where id = '0192f1a2-0004-7000-8000-000000000001'), 0::bigint,
          'Nichtmitglied sieht L1 nicht');

select is((select count(*) from public.list_items
            where id = '0192f1a2-0005-7000-8000-000000000001'), 0::bigint,
          'Nichtmitglied sieht I1 nicht');

select throws_ok(
  $$ insert into public.list_items (id, list_id, name, name_normalized)
     values ('0192f1a2-0005-7000-8000-000000000006',
             '0192f1a2-0004-7000-8000-000000000001', 'Z', 'z') $$,
  '42501',
  null,
  'Nichtmitglied darf keine Items anlegen'
);

select is((select count(*) from public.invites
            where id = '0192f1a2-0009-7000-8000-000000000001'), 0::bigint,
          'Nichtmitglied sieht keinen Invite');

select is((select count(*) from public.categories
            where id = '0192f1a2-0006-7000-8000-000000000001'), 0::bigint,
          'Nichtmitglied sieht die H1-Kategorie nicht');

-- -----------------------------------------------------------------------------
-- 7. Soft-Delete: Zeile bleibt in der DB. Owner/Editor (Writer) sehen sie
--    weiterhin (z. B. zum Wiederherstellen), Viewer sehen sie nicht mehr.
--    PostgreSQL wendet die USING-Klausel der SELECT-Policy beim UPDATE auch
--    auf die neue Zeile an; daher muss list_items_select fuer Writer auch
--    soft-geloeschte Zeilen erlauben, sonst ist Soft-Delete unmoeglich.
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

update public.list_items set deleted_at = now()
 where id = '0192f1a2-0005-7000-8000-000000000001';

select is(
  (select count(*) from public.list_items
    where id = '0192f1a2-0005-7000-8000-000000000001'),
  1::bigint,
  'Editor (Writer) sieht soft-geloeschtes I1 weiterhin'
);

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

select is((select count(*) from public.list_items
            where id = '0192f1a2-0005-7000-8000-000000000001'), 0::bigint,
          'Viewer sieht soft-geloeschtes I1 nicht mehr');

-- -----------------------------------------------------------------------------
-- 8. Profile: eigenes Profil + Profile aus gemeinsamem Haushalt
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select is((select count(*) from public.profiles
            where id = '11111111-1111-4111-8111-111111111111'), 1::bigint,
          'Owner sieht das eigene Profil');

select is((select count(*) from public.profiles
            where id = '22222222-2222-4222-8222-222222222222'), 1::bigint,
          'Owner sieht das Profil des Editors (gemeinsamer Haushalt)');

set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';

select is((select count(*) from public.profiles
            where id = '11111111-1111-4111-8111-111111111111'), 0::bigint,
          'Nichtmitglied sieht das Owner-Profil nicht');

-- -----------------------------------------------------------------------------
-- 9. Bootstrap: Creator legt Haushalt + erste Owner-Mitgliedszeile an
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select lives_ok(
  $$ insert into public.households (id, name, owner_id)
     values ('0192f1a2-0002-7000-8000-000000000003', 'Haushalt 3',
             '11111111-1111-4111-8111-111111111111') $$,
  'Owner legt H3 an'
);

select lives_ok(
  $$ insert into public.household_members (id, household_id, user_id, role)
     values ('0192f1a2-0003-7000-8000-000000000007',
             '0192f1a2-0002-7000-8000-000000000003',
             '11111111-1111-4111-8111-111111111111', 'owner') $$,
  'Bootstrap: erste Owner-Mitgliedszeile ist erlaubt'
);

select is((select count(*) from public.households
            where id = '0192f1a2-0002-7000-8000-000000000003'), 1::bigint,
          'Owner sieht den neu angelegten H3');

-- -----------------------------------------------------------------------------
-- 10. Physisches DELETE ist gesperrt (Trigger, Superuser umgeht RLS)
-- -----------------------------------------------------------------------------
reset role;

select throws_ok(
  $$ delete from public.list_items where id = '0192f1a2-0005-7000-8000-000000000002' $$,
  '23514',
  null,
  'Physisches DELETE wird vom Trigger blockiert'
);

select * from finish();
rollback;
