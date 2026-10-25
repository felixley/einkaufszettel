-- =============================================================================
-- Einkaufszettel — pgTAP: auth.users -> profiles-Synchronisation
-- Quelle: docs/REVIEW.md §8.3 Befund 1 (Welle 2), Migration 007.
-- =============================================================================
-- Ausfuehren mit: supabase test db   (oder psql -f auf einer Wegwerf-DB)
-- Die Tests laufen in einer Transaktion und werden am Ende zurueckgerollt.
--
-- Abgedeckte Akzeptanzkriterien:
--   * Registrierung (INSERT auf auth.users) legt automatisch eine
--     profiles-Zeile an — ohne Client-Aufruf von ensureProfile().
--   * Idempotenz: wiederholte Auth-Aenderungen erzeugen kein Duplikat.
--   * UPDATE spiegelt updated_at aus auth.users auf profiles.updated_at.
--   * Soft-Delete/Restore von auth.users wird auf profiles.deleted_at
--     uebertragen (falls auth.users.deleted_at existiert, wie in GoTrue).
--   * Physisches DELETE eines auth.users entfernt das Profil per FK-Kaskade.
--   * RLS bleibt konform: der Trigger schreibt als SECURITY DEFINER, der
--     Nutzer selbst kann sein Profil anschliessend unter RLS lesen.
-- =============================================================================
begin;
select no_plan();

-- -----------------------------------------------------------------------------
-- 1. Strukturpruefungen
-- -----------------------------------------------------------------------------
select has_function('public', 'sync_auth_user_profile', array[]::text[],
  'Trigger-Funktion public.sync_auth_user_profile() existiert');

select ok(
  (select p.prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'sync_auth_user_profile'),
  'Trigger-Funktion laeuft SECURITY DEFINER (schreibt RLS-frei als Owner)'
);

select has_trigger('auth', 'users', 'on_auth_user_change_sync_profile',
  'Trigger on_auth_user_change_sync_profile haengt an auth.users');

select has_trigger('public', 'profiles', 'profiles_set_updated_at',
  'profiles_set_updated_at bleibt erhalten (10 set_updated_at-Trigger)');

-- -----------------------------------------------------------------------------
-- 2. INSERT: Registrierung legt Profil an (Kernfix, Befund 1)
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, aud, role, created_at, updated_at)
values ('77777777-1111-4111-8111-111111111111', 'sync-new@example.test',
        'authenticated', 'authenticated',
        '2024-05-01 10:00:00+00', '2024-05-01 10:00:00+00');

select is(
  (select count(*) from public.profiles
    where id = '77777777-1111-4111-8111-111111111111'),
  1::bigint,
  'Registrierung (auth.users-INSERT) legt genau eine profiles-Zeile an'
);

select is(
  (select display_name from public.profiles
    where id = '77777777-1111-4111-8111-111111111111'),
  'sync-new',
  'display_name wird aus dem E-Mail-Lokalteil abgeleitet'
);

select is(
  (select updated_at from public.profiles
    where id = '77777777-1111-4111-8111-111111111111'),
  '2024-05-01 10:00:00+00'::timestamptz,
  'updated_at wird beim Anlegen aus auth.users uebernommen'
);

-- -----------------------------------------------------------------------------
-- 3. Idempotenz: erneutes UPDATE erzeugt kein Duplikat
-- -----------------------------------------------------------------------------
update auth.users
   set updated_at = '2024-05-02 12:00:00+00'
 where id = '77777777-1111-4111-8111-111111111111';

select is(
  (select count(*) from public.profiles
    where id = '77777777-1111-4111-8111-111111111111'),
  1::bigint,
  'Wiederholte Auth-Updates erzeugen keine doppelte profiles-Zeile'
);

-- -----------------------------------------------------------------------------
-- 4. UPDATE: updated_at wird gespiegelt (exakt, nicht now())
-- -----------------------------------------------------------------------------
select is(
  (select updated_at from public.profiles
    where id = '77777777-1111-4111-8111-111111111111'),
  '2024-05-02 12:00:00+00'::timestamptz,
  'profiles.updated_at spiegelt auth.users.updated_at exakt'
);

-- -----------------------------------------------------------------------------
-- 5. App-gepflegter display_name bleibt bei Auth-Updates unangetastet
-- -----------------------------------------------------------------------------
update public.profiles
   set display_name = 'Selbst gewaehlt'
 where id = '77777777-1111-4111-8111-111111111111';

update auth.users
   set updated_at = '2024-05-03 09:30:00+00'
 where id = '77777777-1111-4111-8111-111111111111';

select is(
  (select display_name from public.profiles
    where id = '77777777-1111-4111-8111-111111111111'),
  'Selbst gewaehlt',
  'Auth-Update ueberschreibt den selbst gepflegten display_name nicht'
);

select is(
  (select updated_at from public.profiles
    where id = '77777777-1111-4111-8111-111111111111'),
  '2024-05-03 09:30:00+00'::timestamptz,
  'updated_at folgt dem Auth-Update trotz eigenem display_name'
);

-- -----------------------------------------------------------------------------
-- 6. UPDATE ohne vorhandenes Profil: Backfill-Pfad (Upsert)
-- -----------------------------------------------------------------------------
-- Repraesentiert Bestandsnutzer, die sich vor Migration 007 registriert haben.
delete from public.profiles
 where id = '77777777-1111-4111-8111-111111111111';

update auth.users
   set updated_at = '2024-05-04 08:00:00+00'
 where id = '77777777-1111-4111-8111-111111111111';

select is(
  (select count(*) from public.profiles
    where id = '77777777-1111-4111-8111-111111111111'),
  1::bigint,
  'UPDATE auf auth.users legt ein fehlendes Profil nach (Backfill)'
);

-- -----------------------------------------------------------------------------
-- 7. Soft-Delete/Restore von auth.users (GoTrue-Semantik)
-- -----------------------------------------------------------------------------
-- Echtes GoTrue hat auth.users.deleted_at; der lokale Shim nicht. Fehlt die
-- Spalte, legen wir sie hier temporaer an — die Testtransaktion rollt das am
-- Ende zurueck, und der Trigger liest sie ueber to_jsonb(NEW) automatisch mit.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'auth' and table_name = 'users'
                    and column_name = 'deleted_at') then
    alter table auth.users add column deleted_at timestamptz;
  end if;
end $$;

update auth.users set deleted_at = '2024-06-01 00:00:00+00'
 where id = '77777777-1111-4111-8111-111111111111';

select is(
  (select deleted_at from public.profiles
    where id = '77777777-1111-4111-8111-111111111111'),
  '2024-06-01 00:00:00+00'::timestamptz,
  'Soft-Delete in auth.users wird auf profiles.deleted_at uebertragen'
);

update auth.users set deleted_at = null
 where id = '77777777-1111-4111-8111-111111111111';

select ok(
  (select deleted_at from public.profiles
    where id = '77777777-1111-4111-8111-111111111111') is null,
  'Restore in auth.users loescht profiles.deleted_at wieder'
);

-- -----------------------------------------------------------------------------
-- 8. RLS-Konformitaet: Nutzer liest sein per Trigger angelegtes Profil
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '77777777-1111-4111-8111-111111111111';

select is(
  (select count(*) from public.profiles
    where id = '77777777-1111-4111-8111-111111111111'),
  1::bigint,
  'Nutzer sieht sein automatisch angelegtes Profil unter RLS'
);

reset role;

-- -----------------------------------------------------------------------------
-- 9. DELETE: FK-Kaskade raeumt das Profil (Soft-Delete-Empfehlung beachten)
-- -----------------------------------------------------------------------------
-- Eigener Nutzer ohne Haushalt, damit die FK-Kaskade greifen kann.
insert into auth.users (id, email, aud, role)
values ('77777777-2222-4222-8222-222222222222', 'sync-del@example.test',
        'authenticated', 'authenticated');

select is(
  (select count(*) from public.profiles
    where id = '77777777-2222-4222-8222-222222222222'),
  1::bigint,
  'Profil fuer den zweiten Testnutzer existiert vor dem DELETE'
);

delete from auth.users where id = '77777777-2222-4222-8222-222222222222';

select is(
  (select count(*) from public.profiles
    where id = '77777777-2222-4222-8222-222222222222'),
  0::bigint,
  'Physisches DELETE des auth.users entfernt das Profil per FK-Kaskade'
);

-- -----------------------------------------------------------------------------
-- 10. Abschluss
-- -----------------------------------------------------------------------------
select * from finish();
rollback;
