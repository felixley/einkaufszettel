-- =============================================================================
-- Einkaufszettel — Migration 007: auth.users -> profiles synchronisieren
-- Quelle: docs/REVIEW.md §8.3 Befund 1 ("Kein profiles-Insert bei der
--         Registrierung", Welle 2), PLAN.md §4.1/§4.5.
-- =============================================================================
-- Problem:
--   Die Registrierung (GoTrue) legt nur eine Zeile in auth.users an. Ein
--   profiles-Eintrag entsteht erst, wenn die App ensureProfile() im
--   createHousehold()-Flow aufruft (apps/web/lib/household/supabase-adapter.ts).
--   Wer sich registriert und danach nur /lists oeffnet, hat kein Profil —
--   das verletzt das Akzeptanzkriterium "Registrierung legt auth.users- UND
--   profiles-Zeile an".
--
-- Loesung (DB-seitig, unabhaengig vom Client):
--   * AFTER-Trigger auf auth.users fuer INSERT/UPDATE/DELETE.
--   * INSERT  -> Profil anlegen (idempotent: ON CONFLICT DO NOTHING).
--   * UPDATE  -> Profil anlegen, falls es fehlt (Backfill fuer Bestandsnutzer),
--                sonst updated_at spiegeln und Soft-Delete/Restore von
--                auth.users (deleted_at) auf profiles uebertragen.
--   * DELETE  -> kein Eingriff: profiles.id referenziert auth.users
--                ON DELETE CASCADE; die FK-Kaskade raeumt die Zeile. Ein
--                eigenes DELETE im Trigger waere doppelt und von der
--                Trigger-Reihenfolge abhaengig.
--
-- RLS-Konformitaet:
--   Der Trigger laeuft als SECURITY-DEFINER-Funktion (Owner = Migrationsrolle,
--   also Tabelleneigentuemer von public.profiles). Damit greift RLS beim
--   Schreiben nicht, obwohl GoTrue als supabase_auth_admin schreibt und
--   Authenticated-Nutzer kein INSERT/UPDATE auf fremde Profile haben. Die
--   bestehenden profiles-Policies (002) bleiben unveraendert: ein Nutzer darf
--   weiterhin nur sein eigenes Profil schreiben/lesen.
--
-- Idempotenz:
--   CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS; der Backfill nutzt
--   NOT EXISTS/ON CONFLICT. Mehrfaches Ausfuehren ist gefahrlos (der lokale
--   Verifikationslauf fuehrt funktionale Migrationen bewusst zweimal aus).
--
-- Hinweis zur Dateinummer: Der urspruengliche Auftrag nannte
-- "20241025_003_sync_auth_profiles.sql". Beides waere hier falsch: das
-- Praefix 20241025 sortiert VOR der Basisschema-Migration 20261025_001 (der
-- Trigger braucht public.profiles, also muss er danach laufen), und 003 ist
-- bereits durch 20261025_003_rpc_household_lists.sql belegt. Daher 007 in der
-- bestehenden 20261025er-Reihe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trigger-Funktion: auth.users-Aenderungen auf profiles abbilden
-- -----------------------------------------------------------------------------
create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created_at   timestamptz;
  v_updated_at   timestamptz;
  v_deleted_at   timestamptz;
  v_display_name text;
  v_meta         jsonb;
begin
  -- Physisches DELETE eines auth.users: profiles haengt per ON DELETE CASCADE
  -- daran, die FK-Kaskade entfernt die Zeile. Kein Eingriff noetig.
  if tg_op = 'DELETE' then
    return old;
  end if;

  -- to_jsonb(new) statt fester Spaltennamen: So bleibt die Funktion auch auf
  -- auth-Shims ohne raw_user_meta_data/deleted_at lauffaehig (lokale
  -- Verifikation) und liest in echtem GoTrue dieselben Felder.
  v_meta       := coalesce(to_jsonb(new) -> 'raw_user_meta_data', '{}'::jsonb);
  v_created_at := coalesce((to_jsonb(new) ->> 'created_at')::timestamptz, now());
  v_updated_at := coalesce((to_jsonb(new) ->> 'updated_at')::timestamptz, now());
  v_deleted_at := (to_jsonb(new) ->> 'deleted_at')::timestamptz;

  -- Anzeigename nur beim Anlegen setzen; spaetere App-Aenderungen des Nutzers
  -- (profiles.display_name) werden nicht durch Auth-Updates ueberschrieben.
  v_display_name := coalesce(
    nullif(v_meta ->> 'display_name', ''),
    nullif(v_meta ->> 'full_name', ''),
    nullif(split_part(coalesce(to_jsonb(new) ->> 'email', ''), '@', 1), ''),
    ''
  );

  -- Der profiles-BEFORE-Trigger (profiles_set_updated_at) ueberschreibt sonst
  -- den gespiegelten Zeitstempel mit now(). Flag setzen, damit er in dieser
  -- Transaktion nicht eingreift; das Flag faellt am Transaktionsende zurueck.
  perform set_config('einkaufszettel.sync_profile', 'on', true);

  if tg_op = 'INSERT' then
    insert into public.profiles (id, display_name, created_at, updated_at, deleted_at)
    values (new.id, v_display_name, v_created_at, v_updated_at, v_deleted_at)
    on conflict (id) do nothing;
    perform set_config('einkaufszettel.sync_profile', 'off', true);
    return new;
  end if;

  -- UPDATE: upsert, damit auch Bestandsnutzer ohne Profil (registriert, bevor
  -- diese Migration aktiv war) nachgezogen werden. display_name bleibt bei
  -- bestehenden Profilen unangetastet.
  insert into public.profiles (id, display_name, created_at, updated_at, deleted_at)
  values (new.id, v_display_name, v_created_at, v_updated_at, v_deleted_at)
  on conflict (id) do update
    set updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at;

  -- Flag wieder loesen: In einer pgTAP-Suite laeuft alles in EINER Transaktion,
  -- sonst bliebe der Bump fuer profiles auch bei spaeteren direkten Updates aus.
  perform set_config('einkaufszettel.sync_profile', 'off', true);
  return new;
end;
$$;

comment on function public.sync_auth_user_profile() is
  'Spiegelt auth.users-INSERT/UPDATE auf public.profiles (Profil anlegen, '
  'updated_at und deleted_at uebernehmen). DELETE uebernimmt die FK-Kaskade.';

-- -----------------------------------------------------------------------------
-- 2. profiles-BEFORE-Trigger ersetzen: explizite Zeitstempel respektieren
-- -----------------------------------------------------------------------------
-- 001 installiert profiles_set_updated_at -> public.set_updated_at(), das bei
-- JEDEM UPDATE now() setzt. Fuer den Sync-Trigger wuerde das den aus
-- auth.users uebernommenen Wert sofort wieder ueberschreiben. Die Ersatz-
-- funktion verhaelt sich fuer alle uebrigen Updates unveraendert (bump auf
-- now()), ueberspringt den Bump aber waehrend der Synchronisation.
create or replace function public.profiles_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('einkaufszettel.sync_profile', true), '') = 'on' then
    return new;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.profiles_set_updated_at() is
  'BEFORE-UPDATE-Trigger fuer profiles: setzt updated_at auf now(), ausser '
  'waehrend der Synchronisation aus auth.users (Flag einkaufszettel.sync_profile).';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.profiles_set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Trigger auf auth.users
-- -----------------------------------------------------------------------------
-- Ein Trigger fuer alle drei Operationen; die Verzweigung passiert in der
-- Funktion. AFTER ROW, damit die auth.users-Zeile bereits geschrieben ist und
-- NEW.updated_at den endgueltigen Wert des Auth-Stacks enthaelt.
drop trigger if exists on_auth_user_change_sync_profile on auth.users;
create trigger on_auth_user_change_sync_profile
  after insert or update or delete on auth.users
  for each row execute function public.sync_auth_user_profile();

-- -----------------------------------------------------------------------------
-- 4. Backfill: bestehende auth.users ohne Profil nachziehen
-- -----------------------------------------------------------------------------
-- Repariert Nutzer, die sich vor dieser Migration registriert haben. Der
-- AFTER-Trigger greift nur bei kuenftigen Aenderungen; ohne Backfill blieben
-- diese Konten dauerhaft ohne Profil.
insert into public.profiles (id, display_name, created_at, updated_at, deleted_at)
select u.id,
       coalesce(
         nullif(to_jsonb(u) -> 'raw_user_meta_data' ->> 'display_name', ''),
         nullif(to_jsonb(u) -> 'raw_user_meta_data' ->> 'full_name', ''),
         nullif(split_part(coalesce(to_jsonb(u) ->> 'email', ''), '@', 1), ''),
         ''
       ),
       coalesce((to_jsonb(u) ->> 'created_at')::timestamptz, now()),
       coalesce((to_jsonb(u) ->> 'updated_at')::timestamptz, now()),
       (to_jsonb(u) ->> 'deleted_at')::timestamptz
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 5. Rechte
-- -----------------------------------------------------------------------------
-- Authenticated/anon behalten nur SELECT (002); INSERT/UPDATE auf profiles
-- laufen weiterhin ausschliesslich ueber die eigenen Policies bzw. diesen
-- SECURITY-DEFINER-Trigger. In echten Supabase-Stacks schreibt GoTrue als
-- supabase_auth_admin — die Definer-Funktion macht dessen fehlende
-- profiles-Rechte unnoetig. Wo die Rolle existiert, geben wir ihr zusaetzlich
-- minimalen Tabellenzugriff, damit auch ein direkter Zugriff (z. B. manuelles
-- Backfill) funktioniert.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant select, insert, update on public.profiles to supabase_auth_admin';
  end if;
end $$;
