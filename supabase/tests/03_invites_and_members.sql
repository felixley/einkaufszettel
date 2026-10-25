-- =============================================================================
-- Einkaufszettel — pgTAP: Einladungen (T2.3) + Mitgliederverwaltung (T2.4)
-- =============================================================================
-- Ausfuehren mit: supabase test db   (oder psql -f auf einer Wegwerf-DB)
-- Die Tests laufen in einer Transaktion und werden am Ende zurueckgerollt.
--
-- Abgedeckte Akzeptanzkriterien aus PLAN.md §5 / Anhang A:
--   * A-3 Einladung Link/QR: Einladung ist einloesbar, die gewaehlte Rolle
--     greift danach, ein abgelaufener Link wird abgelehnt (Fehlercode/-meldung).
--   * A-4 Mitgliederverwaltung: Rolle aenderbar (Editor->Viewer wirkt sofort
--     auf das Schreibrecht); Entfernen entzieht Zugriff; letzter Owner kann
--     nicht austreten.
--   * RLS bleibt aktiv: Nicht-Owner legt/widerruft keine Einladungen, Nicht-
--     Owner verwaltet keine Mitglieder; RPCs sind SECURITY INVOKER (Ausnahme:
--     zwei dokumentierte interne Definer-Helfer fuer Einloesung/Austritt).
-- =============================================================================
begin;
select no_plan();

-- -----------------------------------------------------------------------------
-- 1. Setup (als Superuser; RLS wird hier bewusst umgangen)
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('a1a1a1a1-1111-4111-8111-111111111111', 'inv-owner@example.test',   'authenticated', 'authenticated'),
  ('b2b2b2b2-2222-4222-8222-222222222222', 'inv-editor@example.test',  'authenticated', 'authenticated'),
  ('c3c3c3c3-3333-4333-8333-333333333333', 'inv-outsider@example.test','authenticated', 'authenticated'),
  ('d4d4d4d4-4444-4444-8444-444444444444', 'inv-owner2@example.test',  'authenticated', 'authenticated'),
  ('e5e5e5e5-5555-4555-8555-555555555555', 'inv-viewer@example.test',  'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.profiles (id, display_name) values
  ('a1a1a1a1-1111-4111-8111-111111111111', 'Owner A'),
  ('b2b2b2b2-2222-4222-8222-222222222222', 'Editor B'),
  ('c3c3c3c3-3333-4333-8333-333333333333', 'Outsider C'),
  ('d4d4d4d4-4444-4444-8444-444444444444', 'Owner D'),
  ('e5e5e5e5-5555-4555-8555-555555555555', 'Viewer E')
on conflict (id) do nothing;

-- Feste, clientseitig erzeugte UUIDv7-IDs.
--   Haushalt    0192f1a2-2001-7000-8000-000000000001
--   Owner-M. A  0192f1a2-2002-7000-8000-000000000001
--   Liste 1     0192f1a2-2003-7000-8000-000000000001
--   Invite 1    0192f1a2-2004-7000-8000-000000000001  (editor, max_uses 2)
--   Invite 2    0192f1a2-2004-7000-8000-000000000002  (expired)
--   Invite 3    0192f1a2-2004-7000-8000-000000000003  (revoked)
--   Invite 4    0192f1a2-2004-7000-8000-000000000004  (owner, fuer D)
--   Invite 5    0192f1a2-2004-7000-8000-000000000005  (viewer, Re-Invite B)
--   Mitglied B  0192f1a2-2005-7000-8000-000000000001
--   Mitglied B2 0192f1a2-2005-7000-8000-000000000002
--   Mitglied E  0192f1a2-2006-7000-8000-000000000001
--   Mitglied D  0192f1a2-2007-7000-8000-000000000001

-- Token-Hashes (der Roh-Token bleibt beim Client; hier nur Hashes).
--   T1 = 64 x 'a', T2 = 64 x 'b', T3 = 64 x 'c', T4 = 64 x 'd', T5 = 64 x 'e'

-- -----------------------------------------------------------------------------
-- 2. Strukturpruefungen (Superuser)
-- -----------------------------------------------------------------------------
select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_invite', 'revoke_invite', 'list_household_invites',
                        'check_invite', 'accept_invite', 'change_member_role',
                        'remove_member', 'leave_household')),
  8::bigint,
  'Alle 8 oeffentlichen RPC-Funktionen existieren in public'
);

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_invite', 'revoke_invite', 'list_household_invites',
                        'check_invite', 'accept_invite', 'change_member_role',
                        'remove_member', 'leave_household')
      and p.prosecdef),
  0::bigint,
  'Alle oeffentlichen RPCs laufen SECURITY INVOKER (RLS greift)'
);

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal'
      and p.proname in ('active_owner_count', 'reassign_household_owner',
                        'find_invite', 'accept_invite', 'leave_household')
      and p.prosecdef),
  5::bigint,
  'Alle 5 internen Helfer laufen SECURITY DEFINER (nicht per PostgREST exponiert)'
);

select ok(
  has_function_privilege('authenticated',
    'public.create_invite(uuid,uuid,text,public.household_role,integer,timestamp with time zone)',
    'execute'),
  'authenticated darf create_invite ausfuehren'
);

select ok(
  has_function_privilege('authenticated', 'public.accept_invite(text,uuid)', 'execute'),
  'authenticated darf accept_invite ausfuehren'
);

select ok(
  has_function_privilege('authenticated', 'public.leave_household(uuid)', 'execute'),
  'authenticated darf leave_household ausfuehren'
);

select ok(
  not has_function_privilege('anon', 'public.create_invite(uuid,uuid,text,public.household_role,integer,timestamp with time zone)', 'execute'),
  'anon darf create_invite nicht ausfuehren'
);

select ok(
  not has_function_privilege('anon', 'public.accept_invite(text,uuid)', 'execute'),
  'anon darf accept_invite nicht ausfuehren'
);

select ok(
  not has_function_privilege('anon', 'public.leave_household(uuid)', 'execute'),
  'anon darf leave_household nicht ausfuehren'
);

-- -----------------------------------------------------------------------------
-- 3. Owner A legt Haushalt + Standardliste an
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'a1a1a1a1-1111-4111-8111-111111111111';

select lives_ok(
  $$ select * from public.create_household(
       '0192f1a2-2001-7000-8000-000000000001',
       'Haushalt Invite-Test',
       '0192f1a2-2002-7000-8000-000000000001',
       '0192f1a2-2003-7000-8000-000000000001',
       'Einkaufsliste') $$,
  'Owner A legt Haushalt inkl. Standardliste an'
);

-- -----------------------------------------------------------------------------
-- 4. T2.3 — Einladung anlegen: nur Owner, replay-sicher
-- -----------------------------------------------------------------------------
select lives_ok(
  $$ select public.create_invite(
       '0192f1a2-2004-7000-8000-000000000001',
       '0192f1a2-2001-7000-8000-000000000001',
       repeat('a', 64), 'editor', 2, now() + interval '7 days') $$,
  'Owner A legt Einladung 1 (Rolle editor, max_uses 2) an'
);

-- Replay mit identischen Parametern erzeugt kein Duplikat.
select lives_ok(
  $$ select public.create_invite(
       '0192f1a2-2004-7000-8000-000000000001',
       '0192f1a2-2001-7000-8000-000000000001',
       repeat('a', 64), 'editor', 2, now() + interval '7 days') $$,
  'Replay von create_invite ist erlaubt (idempotent)'
);

select is(
  (select count(*) from public.invites
    where household_id = '0192f1a2-2001-7000-8000-000000000001'
      and deleted_at is null),
  1::bigint,
  'Replay erzeugt keine zweite Einladung'
);

select is(
  (select role from public.invites
    where id = '0192f1a2-2004-7000-8000-000000000001'),
  'editor'::public.household_role,
  'Einladung 1 traegt die gewaehlte Rolle editor'
);

select is(
  (select count(*) from public.list_household_invites('0192f1a2-2001-7000-8000-000000000001')),
  1::bigint,
  'Owner A sieht die Einladung in der Liste'
);

-- Ungueltige Token-Hashes / max_uses / Ablauf werden abgelehnt.
select throws_ok(
  $$ select public.create_invite(
       '0192f1a2-2004-7000-8000-000000000091',
       '0192f1a2-2001-7000-8000-000000000001',
       'zu-kurz', 'viewer', 1, null) $$,
  '22023',
  null,
  'Zu kurzer token_hash wird abgelehnt'
);

select throws_ok(
  $$ select public.create_invite(
       '0192f1a2-2004-7000-8000-000000000092',
       '0192f1a2-2001-7000-8000-000000000001',
       repeat('7', 64), 'viewer', 0, null) $$,
  '22023',
  null,
  'max_uses < 1 wird abgelehnt'
);

select throws_ok(
  $$ select public.create_invite(
       '0192f1a2-2004-7000-8000-000000000093',
       '0192f1a2-2001-7000-8000-000000000001',
       repeat('8', 64), 'viewer', 1, now() - interval '1 minute') $$,
  '22023',
  null,
  'expires_at in der Vergangenheit wird abgelehnt'
);

-- -----------------------------------------------------------------------------
-- 5. Nicht-Owner darf keine Einladung anlegen/sehen
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'c3c3c3c3-3333-4333-8333-333333333333';

select throws_ok(
  $$ select public.create_invite(
       '0192f1a2-2004-7000-8000-000000000094',
       '0192f1a2-2001-7000-8000-000000000001',
       repeat('6', 64), 'viewer', 1, null) $$,
  '42501',
  null,
  'Nichtmitglied C darf keine Einladung anlegen'
);

select is(
  (select count(*) from public.list_household_invites('0192f1a2-2001-7000-8000-000000000001')),
  0::bigint,
  'Nichtmitglied C sieht keine Einladungen des fremden Haushalts'
);

-- -----------------------------------------------------------------------------
-- 6. T2.3 — Einladung einloesen, Rolle greift (A-3)
-- -----------------------------------------------------------------------------
-- Vorab-Status ohne Verbrauch
select is(
  (public.check_invite(repeat('a', 64)) ->> 'valid'),
  'true',
  'check_invite meldet gueltig, ohne zu verbrauchen'
);
select is(
  (public.check_invite(repeat('a', 64)) ->> 'role'),
  'editor',
  'check_invite liefert die Einladungsrolle'
);
select is(
  (public.check_invite(repeat('a', 64)) ->> 'remaining_uses'),
  '2',
  'check_invite liefert die verbleibenden Nutzungen'
);
-- Lesen von `invites` ist Owner-only (RLS) — fuer die Statuspruefung kurz
-- als Owner A agieren, danach wieder als Einladender/Eingeladener.
set local request.jwt.claim.sub = 'a1a1a1a1-1111-4111-8111-111111111111';

select is(
  (select used_count from public.invites where id = '0192f1a2-2004-7000-8000-000000000001'),
  0,
  'check_invite hat den used_count nicht erhoeht'
);

set local request.jwt.claim.sub = 'b2b2b2b2-2222-4222-8222-222222222222';

select is(
  (public.accept_invite(repeat('a', 64), '0192f1a2-2005-7000-8000-000000000001') ->> 'role'),
  'editor',
  'B loest Einladung 1 ein und erhaelt die Rolle editor'
);

select is(
  (public.accept_invite(repeat('a', 64), '0192f1a2-2005-7000-8000-000000000001') ->> 'already_member'),
  'true',
  'Replay der Einloesung ist idempotent (already_member)'
);

set local request.jwt.claim.sub = 'a1a1a1a1-1111-4111-8111-111111111111';

select is(
  (select used_count from public.invites where id = '0192f1a2-2004-7000-8000-000000000001'),
  1,
  'Replay verbraucht die Einladung nicht ein zweites Mal'
);

set local request.jwt.claim.sub = 'b2b2b2b2-2222-4222-8222-222222222222';

select is(
  (select count(*) from public.household_members
    where household_id = '0192f1a2-2001-7000-8000-000000000001'
      and user_id = 'b2b2b2b2-2222-4222-8222-222222222222'
      and role = 'editor'
      and deleted_at is null),
  1::bigint,
  'B ist genau einmal als Editor eingetragen'
);

-- Editor B darf jetzt schreiben (Rolle greift).
select lives_ok(
  $$ select public.create_list(
       '0192f1a2-2008-7000-8000-000000000001',
       '0192f1a2-2001-7000-8000-000000000001',
       'Editor-Liste B') $$,
  'Editor B (per Einladung) legt eine Liste an'
);

-- Zweite Einloesung von Einladung 1 durch Viewer E (max_uses = 2).
set local request.jwt.claim.sub = 'e5e5e5e5-5555-4555-8555-555555555555';

select is(
  (public.accept_invite(repeat('a', 64), '0192f1a2-2006-7000-8000-000000000001') ->> 'role'),
  'editor',
  'E loest Einladung 1 ein (zweite und letzte Nutzung)'
);

set local request.jwt.claim.sub = 'a1a1a1a1-1111-4111-8111-111111111111';

select is(
  (select used_count from public.invites where id = '0192f1a2-2004-7000-8000-000000000001'),
  2,
  'used_count steht nach zwei Einloesungen auf 2'
);

select is(
  (public.check_invite(repeat('a', 64)) ->> 'reason'),
  'exhausted',
  'check_invite meldet aufgebraucht'
);

-- Dritte Einloesung wird abgelehnt (aufgebraucht).
set local request.jwt.claim.sub = 'd4d4d4d4-4444-4444-8444-444444444444';

select throws_ok(
  $$ select public.accept_invite(repeat('a', 64), '0192f1a2-2007-7000-8000-000000000001') $$,
  '22023',
  'Einladung ist aufgebraucht.',
  'Aufgebrauchte Einladung wird abgelehnt'
);

-- Unbekannter Token.
select throws_ok(
  $$ select public.accept_invite(repeat('f', 64), '0192f1a2-2007-7000-8000-000000000001') $$,
  'P0002',
  'Einladung nicht gefunden.',
  'Unbekannter Token wird abgelehnt'
);

-- -----------------------------------------------------------------------------
-- 7. T2.3 — Abgelaufener Link wird abgelehnt (A-3)
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'a1a1a1a1-1111-4111-8111-111111111111';

select lives_ok(
  $$ select public.create_invite(
       '0192f1a2-2004-7000-8000-000000000002',
       '0192f1a2-2001-7000-8000-000000000001',
       repeat('b', 64), 'viewer', 1, now() + interval '7 days') $$,
  'Owner A legt Einladung 2 (viewer) an'
);

-- Ablauf simulieren (Superuser umgeht RLS; entspricht dem Verstreichen der Zeit).
reset role;
update public.invites
set expires_at = now() - interval '1 minute'
where id = '0192f1a2-2004-7000-8000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub = 'c3c3c3c3-3333-4333-8333-333333333333';

select is(
  (public.check_invite(repeat('b', 64)) ->> 'reason'),
  'expired',
  'check_invite meldet abgelaufen'
);

select throws_ok(
  $$ select public.accept_invite(repeat('b', 64), '0192f1a2-2009-7000-8000-000000000001') $$,
  '22023',
  'Einladung ist abgelaufen.',
  'Abgelaufener Link wird abgelehnt (A-3)'
);

select is(
  (select count(*) from public.household_members
    where household_id = '0192f1a2-2001-7000-8000-000000000001'
      and user_id = 'c3c3c3c3-3333-4333-8333-333333333333'),
  0::bigint,
  'C wurde durch den abgelaufenen Link nicht Mitglied'
);

-- -----------------------------------------------------------------------------
-- 8. T2.3 — Widerrufener Link wird abgelehnt
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'a1a1a1a1-1111-4111-8111-111111111111';

select lives_ok(
  $$ select public.create_invite(
       '0192f1a2-2004-7000-8000-000000000003',
       '0192f1a2-2001-7000-8000-000000000001',
       repeat('c', 64), 'viewer', 1, now() + interval '7 days') $$,
  'Owner A legt Einladung 3 (viewer) an'
);

select lives_ok(
  $$ select public.revoke_invite('0192f1a2-2004-7000-8000-000000000003') $$,
  'Owner A widerruft Einladung 3'
);

select lives_ok(
  $$ select public.revoke_invite('0192f1a2-2004-7000-8000-000000000003') $$,
  'Widerruf ist idempotent'
);

select is(
  (select revoked_at is not null from public.invites
    where id = '0192f1a2-2004-7000-8000-000000000003'),
  true,
  'Einladung 3 ist als widerrufen markiert'
);

set local request.jwt.claim.sub = 'c3c3c3c3-3333-4333-8333-333333333333';

select is(
  (public.check_invite(repeat('c', 64)) ->> 'reason'),
  'revoked',
  'check_invite meldet widerrufen'
);

select throws_ok(
  $$ select public.accept_invite(repeat('c', 64), '0192f1a2-2009-7000-8000-000000000002') $$,
  '22023',
  'Einladung wurde widerrufen.',
  'Widerrufener Link wird abgelehnt'
);

-- Nicht-Owner darf nicht widerrufen. RLS blendet die Einladungszeile fuer
-- Nicht-Owner aus; konsistent zu Migration 003 wird "keine Berechtigung" und
-- "nicht gefunden" mit demselben Fehler gemeldet (kein Existenz-Orakel).
set local request.jwt.claim.sub = 'b2b2b2b2-2222-4222-8222-222222222222';

select throws_ok(
  $$ select public.revoke_invite('0192f1a2-2004-7000-8000-000000000002') $$,
  'P0002',
  'Einladung nicht gefunden.',
  'Editor B darf keine fremde Einladung widerrufen'
);

-- Gegenprobe als Owner: die Einladung 2 ist durch Bs Versuch unveraendert.
set local request.jwt.claim.sub = 'a1a1a1a1-1111-4111-8111-111111111111';

select is(
  (select revoked_at is null from public.invites
    where id = '0192f1a2-2004-7000-8000-000000000002'),
  true,
  'Einladung 2 ist nach dem fehlgeschlagenen Widerruf weiterhin aktiv'
);

-- -----------------------------------------------------------------------------
-- 9. T2.4 — Rolle aendern wirkt sofort (A-4)
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'a1a1a1a1-1111-4111-8111-111111111111';

select is(
  (public.change_member_role(
     '0192f1a2-2001-7000-8000-000000000001',
     'b2b2b2b2-2222-4222-8222-222222222222',
     'viewer')).role,
  'viewer',
  'Owner A stuft B auf viewer herab'
);

set local request.jwt.claim.sub = 'b2b2b2b2-2222-4222-8222-222222222222';

select throws_ok(
  $$ select public.create_list(
       '0192f1a2-2008-7000-8000-000000000002',
       '0192f1a2-2001-7000-8000-000000000001',
       'Viewer-Liste B') $$,
  '42501',
  null,
  'Viewer B darf nach der Herabstufung nicht mehr schreiben (Rolle greift sofort)'
);

select throws_ok(
  $$ select public.change_member_role(
       '0192f1a2-2001-7000-8000-000000000001',
       'a1a1a1a1-1111-4111-8111-111111111111',
       'viewer') $$,
  '42501',
  'Nur Owner duerfen Rollen aendern.',
  'Nicht-Owner B darf keine Rolle aendern'
);

set local request.jwt.claim.sub = 'a1a1a1a1-1111-4111-8111-111111111111';

select is(
  (public.change_member_role(
     '0192f1a2-2001-7000-8000-000000000001',
     'b2b2b2b2-2222-4222-8222-222222222222',
     'editor')).role,
  'editor',
  'Owner A stuft B wieder auf editor hoch'
);

set local request.jwt.claim.sub = 'b2b2b2b2-2222-4222-8222-222222222222';

select lives_ok(
  $$ select public.create_list(
       '0192f1a2-2008-7000-8000-000000000003',
       '0192f1a2-2001-7000-8000-000000000001',
       'Editor-Liste B2') $$,
  'Editor B darf wieder schreiben'
);

-- Letzter Owner kann nicht herabgestuft werden (A ist aktuell einziger Owner).
set local request.jwt.claim.sub = 'a1a1a1a1-1111-4111-8111-111111111111';

select throws_ok(
  $$ select public.change_member_role(
       '0192f1a2-2001-7000-8000-000000000001',
       'a1a1a1a1-1111-4111-8111-111111111111',
       'editor') $$,
  'P0001',
  'Der letzte Owner kann nicht herabgestuft werden.',
  'Letzter Owner kann die eigene Rolle nicht abgeben'
);

-- -----------------------------------------------------------------------------
-- 10. T2.4 — Letzter Owner kann nicht austreten (A-4)
-- -----------------------------------------------------------------------------
select throws_ok(
  $$ select public.leave_household('0192f1a2-2001-7000-8000-000000000001') $$,
  'P0001',
  'Der letzte Owner kann den Haushalt nicht verlassen.',
  'Letzter Owner kann den Haushalt nicht verlassen (A-4)'
);

select throws_ok(
  $$ select public.remove_member(
       '0192f1a2-2001-7000-8000-000000000001',
       'a1a1a1a1-1111-4111-8111-111111111111') $$,
  'P0001',
  'Der letzte Owner kann den Haushalt nicht verlassen.',
  'Selbstentfernung des letzten Owners wird ebenfalls abgelehnt'
);

-- Zweiten Owner per Einladung aufnehmen (Rolle owner).
select lives_ok(
  $$ select public.create_invite(
       '0192f1a2-2004-7000-8000-000000000004',
       '0192f1a2-2001-7000-8000-000000000001',
       repeat('d', 64), 'owner', 1, now() + interval '7 days') $$,
  'Owner A legt Owner-Einladung 4 fuer D an'
);

set local request.jwt.claim.sub = 'd4d4d4d4-4444-4444-8444-444444444444';

select is(
  (public.accept_invite(repeat('d', 64), '0192f1a2-2007-7000-8000-000000000001') ->> 'role'),
  'owner',
  'D loest Owner-Einladung ein und wird Owner'
);

select is(
  (select count(*) from public.household_members
    where household_id = '0192f1a2-2001-7000-8000-000000000001'
      and role = 'owner'
      and deleted_at is null),
  2::bigint,
  'Haushalt hat jetzt zwei aktive Owner'
);

-- Owner A verlaesst den Haushalt (erlaubt, weil D bleibt).
set local request.jwt.claim.sub = 'a1a1a1a1-1111-4111-8111-111111111111';

select lives_ok(
  $$ select public.leave_household('0192f1a2-2001-7000-8000-000000000001') $$,
  'Owner A verlaesst den Haushalt (zweiter Owner vorhanden)'
);

select is(
  (select count(*) from public.households
    where id = '0192f1a2-2001-7000-8000-000000000001'),
  0::bigint,
  'A sieht den Haushalt nach dem Austritt nicht mehr (owner_id umgehaengt)'
);

select is(
  (select count(*) from public.list_lists('0192f1a2-2001-7000-8000-000000000001')),
  0::bigint,
  'A sieht nach dem Austritt keine Listen mehr'
);

-- owner_id ist fuer A nicht mehr sichtbar (RLS) — Pruefung als Owner D.
set local request.jwt.claim.sub = 'd4d4d4d4-4444-4444-8444-444444444444';

select is(
  (select owner_id from public.households
    where id = '0192f1a2-2001-7000-8000-000000000001'),
  'd4d4d4d4-4444-4444-8444-444444444444'::uuid,
  'households.owner_id wurde auf den verbleibenden Owner D umgehaengt'
);

-- D ist jetzt letzter Owner und kann nicht austreten.

select throws_ok(
  $$ select public.leave_household('0192f1a2-2001-7000-8000-000000000001') $$,
  'P0001',
  'Der letzte Owner kann den Haushalt nicht verlassen.',
  'Neuer letzter Owner D kann nicht austreten'
);

-- -----------------------------------------------------------------------------
-- 11. T2.4 — Entfernen entzieht Zugriff (A-4)
-- -----------------------------------------------------------------------------
-- Editor B entfernen
select lives_ok(
  $$ select public.remove_member(
       '0192f1a2-2001-7000-8000-000000000001',
       'b2b2b2b2-2222-4222-8222-222222222222') $$,
  'Owner D entfernt Editor B'
);

set local request.jwt.claim.sub = 'b2b2b2b2-2222-4222-8222-222222222222';

select is(
  (select count(*) from public.households
    where id = '0192f1a2-2001-7000-8000-000000000001'),
  0::bigint,
  'B sieht den Haushalt nach dem Entfernen nicht mehr'
);

select is(
  (select count(*) from public.list_lists('0192f1a2-2001-7000-8000-000000000001')),
  0::bigint,
  'B sieht nach dem Entfernen keine Listen mehr'
);

select throws_ok(
  $$ select public.create_list(
       '0192f1a2-2008-7000-8000-000000000004',
       '0192f1a2-2001-7000-8000-000000000001',
       'Entfernt-Liste') $$,
  '42501',
  null,
  'B kann nach dem Entfernen nicht mehr schreiben'
);

-- Nicht-Owner (E ist Editor) darf keine Mitglieder entfernen.
set local request.jwt.claim.sub = 'e5e5e5e5-5555-4555-8555-555555555555';

select throws_ok(
  $$ select public.remove_member(
       '0192f1a2-2001-7000-8000-000000000001',
       'd4d4d4d4-4444-4444-8444-444444444444') $$,
  '42501',
  'Nur Owner duerfen Mitglieder entfernen.',
  'Editor E darf keine Mitglieder entfernen'
);

-- -----------------------------------------------------------------------------
-- 12. T2.4 — Re-Invite nach Entfernen (Soft-Delete-Reaktivierung)
-- -----------------------------------------------------------------------------
set local request.jwt.claim.sub = 'd4d4d4d4-4444-4444-8444-444444444444';

select lives_ok(
  $$ select public.create_invite(
       '0192f1a2-2004-7000-8000-000000000005',
       '0192f1a2-2001-7000-8000-000000000001',
       repeat('e', 64), 'viewer', 1, now() + interval '7 days') $$,
  'Owner D legt Re-Invite 5 (viewer) fuer B an'
);

set local request.jwt.claim.sub = 'b2b2b2b2-2222-4222-8222-222222222222';

select is(
  (public.accept_invite(repeat('e', 64), '0192f1a2-2005-7000-8000-000000000002') ->> 'restored_member'),
  'true',
  'B wird durch Re-Invite reaktiviert (Soft-Delete-Zeile wiederverwendet)'
);

select is(
  (select count(*) from public.household_members
    where household_id = '0192f1a2-2001-7000-8000-000000000001'
      and user_id = 'b2b2b2b2-2222-4222-8222-222222222222'),
  1::bigint,
  'Re-Invite erzeugt keine zweite Mitgliedszeile (Reaktivierung)'
);

select is(
  (select role from public.household_members
    where household_id = '0192f1a2-2001-7000-8000-000000000001'
      and user_id = 'b2b2b2b2-2222-4222-8222-222222222222'
      and deleted_at is null),
  'viewer'::public.household_role,
  'Reaktivierter B hat die Rolle der Re-Einladung (viewer)'
);

select is(
  (select count(*) from public.list_lists('0192f1a2-2001-7000-8000-000000000001')),
  3::bigint,
  'B sieht als Viewer wieder die Listen des Haushalts'
);

-- -----------------------------------------------------------------------------
-- 13. T2.4 — Selbst-Herabstufung eines Owners bei zweitem Owner (RLS-Pfad)
-- -----------------------------------------------------------------------------
-- E ist Editor; D macht E zum Owner (jetzt zwei Owner) ...
set local request.jwt.claim.sub = 'd4d4d4d4-4444-4444-8444-444444444444';

select is(
  (public.change_member_role(
     '0192f1a2-2001-7000-8000-000000000001',
     'e5e5e5e5-5555-4555-8555-555555555555',
     'owner')).role,
  'owner',
  'Owner D befoerdert Editor E zum Owner'
);

-- ... und stuft sich danach selbst zum Editor herab (erlaubt, E bleibt Owner).
select is(
  (public.change_member_role(
     '0192f1a2-2001-7000-8000-000000000001',
     'd4d4d4d4-4444-4444-8444-444444444444',
     'editor')).role,
  'editor',
  'Owner D stuft sich selbst herab (zweiter Owner vorhanden)'
);

select is(
  (select owner_id from public.households
    where id = '0192f1a2-2001-7000-8000-000000000001'),
  'e5e5e5e5-5555-4555-8555-555555555555'::uuid,
  'households.owner_id zeigt nach der Selbst-Herabstufung auf E'
);

-- D ist jetzt nur noch Editor und darf keine Rollen mehr aendern.
select throws_ok(
  $$ select public.change_member_role(
       '0192f1a2-2001-7000-8000-000000000001',
       'e5e5e5e5-5555-4555-8555-555555555555',
       'viewer') $$,
  '42501',
  'Nur Owner duerfen Rollen aendern.',
  'Herabgestufter D darf keine Rollen mehr aendern'
);

-- E ist letzter Owner und kann nicht austreten.
set local request.jwt.claim.sub = 'e5e5e5e5-5555-4555-8555-555555555555';

select throws_ok(
  $$ select public.leave_household('0192f1a2-2001-7000-8000-000000000001') $$,
  'P0001',
  'Der letzte Owner kann den Haushalt nicht verlassen.',
  'Befoerdeter E als letzter Owner kann nicht austreten'
);

-- -----------------------------------------------------------------------------
-- 14. Aufraeumen / Abschluss
-- -----------------------------------------------------------------------------
reset role;
select * from finish();
rollback;
