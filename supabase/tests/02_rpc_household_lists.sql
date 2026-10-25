-- =============================================================================
-- Einkaufszettel — pgTAP: RPCs Haushalt/Standardliste/Listen-CRUD (PLAN.md T2.2)
-- =============================================================================
-- Ausfuehren mit: supabase test db   (oder psql -f auf einer Wegwerf-DB)
-- Die Tests laufen in einer Transaktion und werden am Ende zurueckgerollt.
--
-- Abgedeckte Akzeptanzkriterien aus PLAN.md §5 T2.2:
--   * Haushalt anlegen + Standardliste erzeugen (atomar, replay-sicher).
--   * Listen-CRUD (anlegen, lesen, umbenennen, soft-loeschen, wiederherstellen).
--   * Zweiter Nutzer (Nichtmitglied) sieht fremden Haushalt nicht.
--   * Rollen: Editor darf Listen aendern, Viewer nicht.
--   * RPCs sind SECURITY INVOKER; RLS greift auch innerhalb der Funktionen.
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

-- Feste, clientseitig erzeugte UUIDv7-IDs fuer den Test.
-- (Kein DB-Default; die IDs werden wie vom Client an die RPC uebergeben.)
--   Haushalt  0192f1a2-1002-7000-8000-000000000001
--   Owner-M.  0192f1a2-1003-7000-8000-000000000001
--   Liste 1   0192f1a2-1004-7000-8000-000000000001  (Standardliste)
--   Liste 2   0192f1a2-1004-7000-8000-000000000002  (CRUD-Test)
--   Liste 3   0192f1a2-1004-7000-8000-000000000003  (Editor-Test)
--   Liste 4   0192f1a2-1004-7000-8000-000000000004  (ensure_default_list)

-- -----------------------------------------------------------------------------
-- 2. Strukturpruefungen (Superuser)
-- -----------------------------------------------------------------------------
select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_household', 'ensure_default_list', 'create_list',
                        'rename_list', 'soft_delete_list', 'restore_list',
                        'list_lists', 'get_list')),
  8::bigint,
  'Alle 8 RPC-Funktionen existieren in public'
);

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_household', 'ensure_default_list', 'create_list',
                        'rename_list', 'soft_delete_list', 'restore_list',
                        'list_lists', 'get_list')
      and p.prosecdef),
  0::bigint,
  'Alle RPCs laufen SECURITY INVOKER (RLS greift)'
);

select ok(
  has_function_privilege('authenticated',
    'public.create_household(uuid,text,uuid,uuid,text)', 'execute'),
  'authenticated darf create_household ausfuehren'
);

select ok(
  has_function_privilege('authenticated',
    'public.create_list(uuid,uuid,text)', 'execute'),
  'authenticated darf create_list ausfuehren'
);

select ok(
  not has_function_privilege('anon',
    'public.create_household(uuid,text,uuid,uuid,text)', 'execute'),
  'anon darf create_household nicht ausfuehren'
);

select ok(
  not has_function_privilege('anon',
    'public.list_lists(uuid)', 'execute'),
  'anon darf list_lists nicht ausfuehren'
);

-- -----------------------------------------------------------------------------
-- 3. Owner A legt Haushalt + Standardliste an (RPC, atomar)
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select lives_ok(
  $$ select * from public.create_household(
       '0192f1a2-1002-7000-8000-000000000001',
       'Haushalt A',
       '0192f1a2-1003-7000-8000-000000000001',
       '0192f1a2-1004-7000-8000-000000000001',
       'Einkaufsliste') $$,
  'Owner A legt Haushalt inkl. Standardliste an'
);

select is(
  (select count(*) from public.households
    where id = '0192f1a2-1002-7000-8000-000000000001'),
  1::bigint,
  'A sieht den neu angelegten Haushalt'
);

select is(
  (select count(*) from public.household_members
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and role = 'owner'
      and deleted_at is null),
  1::bigint,
  'A ist als Owner-Mitglied eingetragen'
);

select is(
  (select count(*) from public.lists
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and deleted_at is null),
  1::bigint,
  'Standardliste wurde genau einmal angelegt'
);

select is(
  (select name from public.lists
    where id = '0192f1a2-1004-7000-8000-000000000001'),
  'Einkaufsliste',
  'Standardliste heisst "Einkaufsliste"'
);

-- Replay-Sicherheit: identischer Aufruf (Outbox-Replay) erzeugt keine Duplikate.
select lives_ok(
  $$ select * from public.create_household(
       '0192f1a2-1002-7000-8000-000000000001',
       'Haushalt A',
       '0192f1a2-1003-7000-8000-000000000001',
       '0192f1a2-1004-7000-8000-000000000001',
       'Einkaufsliste') $$,
  'Replay von create_household ist erlaubt (idempotent)'
);

select is(
  (select count(*) from public.households
    where id = '0192f1a2-1002-7000-8000-000000000001'),
  1::bigint,
  'Replay erzeugt keinen zweiten Haushalt'
);

select is(
  (select count(*) from public.household_members
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and deleted_at is null),
  1::bigint,
  'Replay erzeugt keine zweite Mitgliedszeile'
);

select is(
  (select count(*) from public.lists
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and deleted_at is null),
  1::bigint,
  'Replay erzeugt keine zweite Standardliste'
);

-- -----------------------------------------------------------------------------
-- 4. Listen-CRUD als Owner
-- -----------------------------------------------------------------------------
select lives_ok(
  $$ select public.create_list(
       '0192f1a2-1004-7000-8000-000000000002',
       '0192f1a2-1002-7000-8000-000000000001',
       'Wocheneinkauf') $$,
  'Owner A legt eine zweite Liste an'
);

select is(
  (select count(*) from public.lists
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and deleted_at is null),
  2::bigint,
  'Haushalt A hat jetzt zwei aktive Listen'
);

select is(
  (select name from public.get_list('0192f1a2-1004-7000-8000-000000000002')),
  'Wocheneinkauf',
  'get_list liefert die angelegte Liste'
);

select is(
  (select count(*) from public.list_lists('0192f1a2-1002-7000-8000-000000000001')),
  2::bigint,
  'list_lists liefert beide aktiven Listen'
);

select lives_ok(
  $$ select public.rename_list(
       '0192f1a2-1004-7000-8000-000000000002', 'Grosswocheneinkauf') $$,
  'Owner A benennt Liste 2 um'
);

select is(
  (select name from public.get_list('0192f1a2-1004-7000-8000-000000000002')),
  'Grosswocheneinkauf',
  'Umbenennen wirkt auf die Liste'
);

select lives_ok(
  $$ select public.soft_delete_list('0192f1a2-1004-7000-8000-000000000002') $$,
  'Owner A soft-loescht Liste 2'
);

select is(
  (select count(*) from public.lists
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and deleted_at is null),
  1::bigint,
  'Soft-geloeschte Liste ist in der aktiven Liste nicht mehr enthalten'
);

-- Writer (Owner A) darf soft-geloeschte Zeilen weiterhin sehen (Restore/Undo).
select is(
  (select count(*) from public.lists
    where id = '0192f1a2-1004-7000-8000-000000000002'),
  1::bigint,
  'Owner A sieht die soft-geloeschte Liste (fuer Restore/Undo)'
);

select is(
  (select count(*) from public.get_list('0192f1a2-1004-7000-8000-000000000002')),
  0::bigint,
  'get_list liefert keine soft-geloeschte Liste'
);

select lives_ok(
  $$ select public.restore_list('0192f1a2-1004-7000-8000-000000000002') $$,
  'Owner A stellt Liste 2 wieder her'
);

select is(
  (select count(*) from public.lists
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and deleted_at is null),
  2::bigint,
  'Wiederhergestellte Liste ist wieder aktiv sichtbar'
);

-- Replay von Soft-Delete und Restore ist ein No-op (Outbox-Replay).
select lives_ok(
  $$ select public.soft_delete_list('0192f1a2-1004-7000-8000-000000000002') $$,
  'Soft-Delete von Liste 2 (1. Aufruf)'
);
select lives_ok(
  $$ select public.soft_delete_list('0192f1a2-1004-7000-8000-000000000002') $$,
  'Replay von Soft-Delete ist erlaubt (idempotent)'
);
select lives_ok(
  $$ select public.restore_list('0192f1a2-1004-7000-8000-000000000002') $$,
  'Restore von Liste 2 (1. Aufruf)'
);
select lives_ok(
  $$ select public.restore_list('0192f1a2-1004-7000-8000-000000000002') $$,
  'Replay von Restore ist erlaubt (idempotent)'
);

select is(
  (select count(*) from public.lists
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and deleted_at is null),
  2::bigint,
  'Nach Replays ist der Listenstand unveraendert (2 aktiv)'
);

-- Der interne Replay-Helfer ist nicht oeffentlich (anon) ausfuehrbar.
select ok(
  not has_function_privilege('anon', 'internal.list_exists(uuid)', 'execute'),
  'anon darf den internen Replay-Helfer nicht ausfuehren'
);

-- -----------------------------------------------------------------------------
-- 5. Mitglieder fuer Rollentests anlegen (Owner A darf das)
-- -----------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.household_members (id, household_id, user_id, role)
     values ('0192f1a2-1003-7000-8000-000000000002',
             '0192f1a2-1002-7000-8000-000000000001',
             'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'editor') $$,
  'Owner A fuegt Editor B hinzu'
);

select lives_ok(
  $$ insert into public.household_members (id, household_id, user_id, role)
     values ('0192f1a2-1003-7000-8000-000000000003',
             '0192f1a2-1002-7000-8000-000000000001',
             'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'viewer') $$,
  'Owner A fuegt Viewer D hinzu'
);

-- -----------------------------------------------------------------------------
-- 6. Editor B darf Listen aendern
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

select is(
  (select count(*) from public.list_lists('0192f1a2-1002-7000-8000-000000000001')),
  2::bigint,
  'Editor B sieht die Listen des Haushalts'
);

select lives_ok(
  $$ select public.create_list(
       '0192f1a2-1004-7000-8000-000000000003',
       '0192f1a2-1002-7000-8000-000000000001',
       'Editor-Liste') $$,
  'Editor B legt eine Liste an'
);

select lives_ok(
  $$ select public.rename_list(
       '0192f1a2-1004-7000-8000-000000000003', 'Editor-Liste 2') $$,
  'Editor B benennt die Liste um'
);

select is(
  (select name from public.get_list('0192f1a2-1004-7000-8000-000000000003')),
  'Editor-Liste 2',
  'Umbenennen durch Editor B wirkt'
);

select lives_ok(
  $$ select public.soft_delete_list('0192f1a2-1004-7000-8000-000000000003') $$,
  'Editor B soft-loescht die Liste'
);

select lives_ok(
  $$ select public.restore_list('0192f1a2-1004-7000-8000-000000000003') $$,
  'Editor B stellt die Liste wieder her'
);

-- -----------------------------------------------------------------------------
-- 7. Viewer D darf lesen, aber nicht schreiben
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

select is(
  (select count(*) from public.list_lists('0192f1a2-1002-7000-8000-000000000001')),
  3::bigint,
  'Viewer D sieht alle aktiven Listen'
);

select throws_ok(
  $$ select public.create_list(
       '0192f1a2-1004-7000-8000-000000000005',
       '0192f1a2-1002-7000-8000-000000000001',
       'Viewer-Liste') $$,
  '42501',
  null,
  'Viewer D darf keine Liste anlegen'
);

select throws_ok(
  $$ select public.rename_list(
       '0192f1a2-1004-7000-8000-000000000001', 'Hacked') $$,
  '42501',
  null,
  'Viewer D darf keine Liste umbenennen'
);

select throws_ok(
  $$ select public.soft_delete_list('0192f1a2-1004-7000-8000-000000000001') $$,
  '42501',
  null,
  'Viewer D darf keine Liste soft-loeschen'
);

-- -----------------------------------------------------------------------------
-- 8. Nichtmitglied C sieht fremden Haushalt nicht (AK T2.2)
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

select is(
  (select count(*) from public.households
    where id = '0192f1a2-1002-7000-8000-000000000001'),
  0::bigint,
  'Nichtmitglied C sieht den fremden Haushalt nicht'
);

select is(
  (select count(*) from public.list_lists('0192f1a2-1002-7000-8000-000000000001')),
  0::bigint,
  'Nichtmitglied C sieht keine Listen des fremden Haushalts'
);

select is(
  (select count(*) from public.get_list('0192f1a2-1004-7000-8000-000000000001')),
  0::bigint,
  'Nichtmitglied C sieht eine fremde Liste nicht'
);

select throws_ok(
  $$ select public.create_list(
       '0192f1a2-1004-7000-8000-000000000006',
       '0192f1a2-1002-7000-8000-000000000001',
       'Fremdliste') $$,
  '42501',
  null,
  'Nichtmitglied C darf keine Liste im fremden Haushalt anlegen'
);

select throws_ok(
  $$ select public.rename_list(
       '0192f1a2-1004-7000-8000-000000000001', 'Fremd') $$,
  '42501',
  null,
  'Nichtmitglied C darf fremde Listen nicht umbenennen'
);

select throws_ok(
  $$ select public.soft_delete_list('0192f1a2-1004-7000-8000-000000000001') $$,
  '42501',
  null,
  'Nichtmitglied C darf fremde Listen nicht soft-loeschen'
);

select throws_ok(
  $$ select public.ensure_default_list(
       '0192f1a2-1002-7000-8000-000000000001',
       '0192f1a2-1004-7000-8000-000000000007') $$,
  '42501',
  null,
  'Nichtmitglied C darf keine Standardliste fuer fremden Haushalt anlegen'
);

-- -----------------------------------------------------------------------------
-- 9. ensure_default_list ist idempotent (Owner A)
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select is(
  (select public.ensure_default_list(
     '0192f1a2-1002-7000-8000-000000000001',
     '0192f1a2-1004-7000-8000-000000000004')),
  '0192f1a2-1004-7000-8000-000000000001'::uuid,
  'ensure_default_list liefert bei vorhandener Liste deren ID (kein Duplikat)'
);

select is(
  (select count(*) from public.lists
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and deleted_at is null),
  3::bigint,
  'ensure_default_list legt keine zusaetzliche Liste an'
);

-- Nach Soft-Delete aller Listen erzeugt ensure_default_list genau eine neue.
select lives_ok(
  $$ select public.soft_delete_list('0192f1a2-1004-7000-8000-000000000001') $$,
  'Owner A soft-loescht Liste 1'
);
select lives_ok(
  $$ select public.soft_delete_list('0192f1a2-1004-7000-8000-000000000002') $$,
  'Owner A soft-loescht Liste 2'
);
select lives_ok(
  $$ select public.soft_delete_list('0192f1a2-1004-7000-8000-000000000003') $$,
  'Owner A soft-loescht Liste 3'
);

select is(
  (select count(*) from public.lists
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and deleted_at is null),
  0::bigint,
  'Keine aktive Liste mehr vorhanden'
);

select is(
  (select public.ensure_default_list(
     '0192f1a2-1002-7000-8000-000000000001',
     '0192f1a2-1004-7000-8000-000000000004')),
  '0192f1a2-1004-7000-8000-000000000004'::uuid,
  'ensure_default_list erzeugt die neue Standardliste mit der Client-ID'
);

select is(
  (select count(*) from public.lists
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and deleted_at is null),
  1::bigint,
  'Nach ensure_default_list existiert genau eine aktive Liste'
);

-- -----------------------------------------------------------------------------
-- 10. Replay-Sicherheit von create_list
-- -----------------------------------------------------------------------------
select lives_ok(
  $$ select public.create_list(
       '0192f1a2-1004-7000-8000-000000000002',
       '0192f1a2-1002-7000-8000-000000000001',
       'Grosswocheneinkauf') $$,
  'Replay von create_list ist erlaubt'
);

-- Liste 2 ist soft-geloescht -> Replay darf sie nicht wiederbeleben.
select is(
  (select count(*) from public.lists
    where household_id = '0192f1a2-1002-7000-8000-000000000001'
      and deleted_at is null),
  1::bigint,
  'Replay von create_list legt keine aktive Liste an und belebt keine geloeschte'
);

select * from finish();
rollback;
