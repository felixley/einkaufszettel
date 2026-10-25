-- =============================================================================
-- Einkaufszettel — Migration 003: RPCs Haushalt + Standardliste + Listen-CRUD
-- Quelle: PLAN.md §4.1 (Datenmodell), §4.2 (Upsert per UUID), §4.5 (Sicherheit)
--         §5 T2.2 (Haushalt anlegen, Standardliste erzeugen, Listen-CRUD)
-- =============================================================================
-- Grundsaetze:
--   * Alle Funktionen laufen mit SECURITY INVOKER. RLS aus Migration 002 gilt
--     damit unveraendert auch innerhalb der Funktionen — ein Nichtmitglied
--     bekommt keine Daten, ein Viewer kann nicht schreiben.
--   * IDs kommen immer vom Client (UUIDv7, PLAN.md §4.1). Es gibt keinen
--     DB-Default und keine serverseitige ID-Erzeugung. Jede Funktion nimmt die
--     IDs deshalb als Parameter entgegen.
--   * Die Funktionen sind replay-sicher: Ein erneuter Aufruf mit denselben
--     Parametern (z. B. Outbox-Replay nach Reconnect) legt keine Duplikate an.
--   * Fehlende Berechtigung und "nicht gefunden" werden bewusst mit demselben
--     Fehlercode 42501 (insufficient_privilege) gemeldet, damit ein Nicht-
--     mitglied nicht durch unterschiedliche Fehlermeldungen die Existenz
--     fremder Haushalte/Listen erfahren kann.
--   * Die Migration ist idempotent (CREATE OR REPLACE / REVOKE+GRANT) und kann
--     erneut eingespielt werden.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Interner Helfer fuer Replay-Erkennung
-- -----------------------------------------------------------------------------
-- Soft-geloeschte Listen sind fuer Mitglieder per SELECT-Policy unsichtbar.
-- Fuer replay-sichere RPCs (Outbox-Replay, PLAN.md §4.2) muss die Funktion
-- aber erkennen koennen, ob eine Zeile mit dieser Client-ID bereits existiert.
-- Der Helfer laeuft SECURITY DEFINER, prueft zuerst die Schreibberechtigung
-- und gibt danach nur ein Boolean zurueck. Er liegt im Schema "internal",
-- damit er nicht als oeffentliche PostgREST-RPC exponiert wird.
create schema if not exists internal;
revoke all on schema internal from public;
grant usage on schema internal to authenticated;

create or replace function internal.list_in_household_exists(
  p_list_id      uuid,
  p_household_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_household_writer(p_household_id)
     and exists (
       select 1 from public.lists
       where id = p_list_id and household_id = p_household_id
     );
$$;

create or replace function internal.list_exists(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.lists l
    where l.id = p_list_id
      and public.is_household_writer(l.household_id)
  );
$$;

revoke all on function internal.list_in_household_exists(uuid, uuid) from public;
revoke all on function internal.list_exists(uuid) from public;
grant execute on function internal.list_in_household_exists(uuid, uuid) to authenticated;
grant execute on function internal.list_exists(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 1. Haushalt anlegen (inkl. erster Owner-Mitgliedszeile + Standardliste)
-- -----------------------------------------------------------------------------
-- Reihenfolge ist durch die RLS-Bootstrap-Policy aus 002 vorgegeben:
--   1) households INSERT  — Policy verlangt owner_id = auth.uid()
--   2) household_members INSERT — Bootstrap erlaubt die erste Owner-Zeile
--   3) lists INSERT — Policy verlangt aktive Owner/Editor-Mitgliedschaft
--      (die Zeile aus Schritt 2 ist innerhalb der Transaktion bereits sichtbar)
-- Der Aufruf ist atomar: schlaegt ein Schritt fehl, wird alles zurueckgerollt.
create or replace function public.create_household(
  p_household_id uuid,
  p_name         text,
  p_member_id    uuid,
  p_list_id      uuid,
  p_list_name    text default 'Einkaufsliste'
)
returns public.households
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_row    public.households;
  v_list   uuid;
begin
  if v_uid is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;
  if p_household_id is null or p_member_id is null or p_list_id is null then
    raise exception 'IDs muessen vom Client uebergeben werden (UUIDv7).'
      using errcode = '22004';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Haushaltsname darf nicht leer sein.' using errcode = '22023';
  end if;

  -- 1) Haushalt. ON CONFLICT DO NOTHING macht den Aufruf replay-sicher.
  insert into public.households (id, name, owner_id)
  values (p_household_id, btrim(p_name), v_uid)
  on conflict do nothing;

  -- Replay-Fall: Zeile existiert bereits. Sie muss dem Aufrufer gehoeren,
  -- sonst ist der Aufruf unzulaessig (RLS blendet fremde Zeilen aus).
  select * into v_row
  from public.households
  where id = p_household_id
    and owner_id = v_uid
    and deleted_at is null;

  if not found then
    raise exception 'Haushalt nicht gefunden oder keine Berechtigung.'
      using errcode = '42501';
  end if;

  -- 2) Erste Owner-Mitgliedszeile (Bootstrap). Replay-sicher.
  insert into public.household_members (id, household_id, user_id, role)
  values (p_member_id, p_household_id, v_uid, 'owner')
  on conflict do nothing;

  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id
      and user_id = v_uid
      and role = 'owner'
      and deleted_at is null
  ) then
    raise exception 'Owner-Mitgliedschaft konnte nicht angelegt werden.'
      using errcode = '42501';
  end if;

  -- 3) Standardliste — nur, wenn der Haushalt noch keine aktive Liste hat.
  if not exists (
    select 1 from public.lists
    where household_id = p_household_id and deleted_at is null
  ) then
    insert into public.lists (id, household_id, name)
    values (
      p_list_id,
      p_household_id,
      coalesce(nullif(btrim(p_list_name), ''), 'Einkaufsliste')
    )
    on conflict do nothing;
  end if;

  -- Sicherstellen, dass mindestens eine aktive Liste existiert.
  select id into v_list
  from public.lists
  where household_id = p_household_id and deleted_at is null
  order by created_at, id
  limit 1;

  if v_list is null then
    raise exception 'Standardliste konnte nicht angelegt werden.'
      using errcode = '42501';
  end if;

  return v_row;
end;
$$;

comment on function public.create_household(uuid, text, uuid, uuid, text)
  is 'Legt Haushalt, erste Owner-Mitgliedszeile und Standardliste atomar an (replay-sicher).';

-- -----------------------------------------------------------------------------
-- 2. Standardliste fuer bestehenden Haushalt sicherstellen (idempotent)
-- -----------------------------------------------------------------------------
-- Fuer Haushalte, die nicht ueber create_household entstanden sind (z. B. per
-- Sync-Upsert aus der Outbox). Gibt die ID der aktiven Standardliste zurueck;
-- existiert bereits eine aktive Liste, wird deren ID zurueckgegeben.
create or replace function public.ensure_default_list(
  p_household_id uuid,
  p_list_id      uuid,
  p_list_name    text default 'Einkaufsliste'
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_list uuid;
begin
  if v_uid is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;
  if p_household_id is null or p_list_id is null then
    raise exception 'IDs muessen vom Client uebergeben werden (UUIDv7).'
      using errcode = '22004';
  end if;
  if not public.is_household_writer(p_household_id) then
    raise exception 'Haushalt nicht gefunden oder keine Berechtigung.'
      using errcode = '42501';
  end if;

  select id into v_list
  from public.lists
  where household_id = p_household_id and deleted_at is null
  order by created_at, id
  limit 1;

  if v_list is not null then
    return v_list;
  end if;

  insert into public.lists (id, household_id, name)
  values (
    p_list_id,
    p_household_id,
    coalesce(nullif(btrim(p_list_name), ''), 'Einkaufsliste')
  )
  on conflict do nothing;

  select id into v_list
  from public.lists
  where id = p_list_id
    and household_id = p_household_id
    and deleted_at is null;

  if v_list is null then
    raise exception 'Standardliste konnte nicht angelegt werden.'
      using errcode = '42501';
  end if;

  return v_list;
end;
$$;

comment on function public.ensure_default_list(uuid, uuid, text)
  is 'Stellt fuer einen bestehenden Haushalt eine aktive Standardliste sicher (idempotent).';

-- -----------------------------------------------------------------------------
-- 3. Listen-CRUD
-- -----------------------------------------------------------------------------
-- 3.1 Liste anlegen. RLS lists_insert verlangt Owner/Editor des Haushalts.
create or replace function public.create_list(
  p_list_id      uuid,
  p_household_id uuid,
  p_name         text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;
  if p_list_id is null or p_household_id is null then
    raise exception 'IDs muessen vom Client uebergeben werden (UUIDv7).'
      using errcode = '22004';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Listenname darf nicht leer sein.' using errcode = '22023';
  end if;

  insert into public.lists (id, household_id, name)
  values (p_list_id, p_household_id, btrim(p_name))
  on conflict do nothing;

  -- Replay: aktive Liste existiert bereits -> Erfolg (kein Duplikat).
  if exists (
    select 1 from public.lists
    where id = p_list_id
      and household_id = p_household_id
      and deleted_at is null
  ) then
    return p_list_id;
  end if;

  -- Replay einer inzwischen soft-geloeschten Liste: Zeile existiert bereits im
  -- richtigen Haushalt. Nicht wiederbeleben (das ist restore_list), aber auch
  -- keinen Fehler erzeugen -> Replay bleibt idempotent.
  if internal.list_in_household_exists(p_list_id, p_household_id) then
    return p_list_id;
  end if;

  raise exception 'Liste konnte nicht angelegt werden (Haushalt nicht gefunden oder keine Berechtigung).'
    using errcode = '42501';
end;
$$;

comment on function public.create_list(uuid, uuid, text)
  is 'Legt eine Liste in einem Haushalt an (nur Owner/Editor, replay-sicher).';

-- 3.2 Liste umbenennen. RLS lists_update verlangt Owner/Editor.
create or replace function public.rename_list(
  p_list_id uuid,
  p_name    text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Listenname darf nicht leer sein.' using errcode = '22023';
  end if;

  update public.lists
     set name = btrim(p_name)
   where id = p_list_id
     and deleted_at is null;

  if not found then
    raise exception 'Liste nicht gefunden oder keine Berechtigung.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.rename_list(uuid, text)
  is 'Benennt eine aktive Liste um (nur Owner/Editor).';

-- 3.3 Liste soft-loeschen. Kein RETURNING, weil lists_select soft-geloeschte
--     Zeilen fuer Mitglieder ausblendet (RETURNING wuerde die SELECT-Policy
--     auf die neue Zeile anwenden und fehlschlagen).
create or replace function public.soft_delete_list(p_list_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;

  update public.lists
     set deleted_at = now()
   where id = p_list_id
     and deleted_at is null;

  if not found then
    -- Replay eines bereits erfolgten Soft-Deletes ist ein No-op (Outbox-Replay).
    if internal.list_exists(p_list_id) then
      return;
    end if;
    raise exception 'Liste nicht gefunden oder keine Berechtigung.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.soft_delete_list(uuid)
  is 'Soft-Delete einer Liste ueber deleted_at (nur Owner/Editor, replay-sicher).';

-- 3.4 Liste wiederherstellen (Undo). RLS lists_update erlaubt Writern das
--     Setzen von deleted_at; RETURNING wird vermieden (siehe 3.3).
create or replace function public.restore_list(p_list_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;

  update public.lists
     set deleted_at = null
   where id = p_list_id
     and deleted_at is not null;

  if not found then
    -- Replay: Liste ist bereits aktiv -> No-op. Sonst keine Berechtigung.
    if internal.list_exists(p_list_id) then
      return;
    end if;
    raise exception 'Liste nicht gefunden oder keine Berechtigung.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.restore_list(uuid)
  is 'Stellt eine soft-geloeschte Liste wieder her (nur Owner/Editor, replay-sicher).';

-- 3.5 Listen eines Haushalts lesen. RLS lists_select filtert nach Mitgliedschaft.
create or replace function public.list_lists(p_household_id uuid)
returns setof public.lists
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select *
  from public.lists
  where household_id = p_household_id
    and deleted_at is null
  order by created_at, id;
$$;

comment on function public.list_lists(uuid)
  is 'Liefert die aktiven Listen eines Haushalts (RLS: nur Mitglieder).';

-- 3.6 Einzelne Liste lesen. RLS lists_select filtert nach Mitgliedschaft.
-- Rueckgabe bewusst als SETOF: eine einzelne Komposit-Zeile wuerde bei
-- leerem Treffer NULL liefern, und "count(*)" wuerde diese NULL-Zeile als
-- 1 zaehlen. SETOF liefert bei leerem Treffer sauber 0 Zeilen.
create or replace function public.get_list(p_list_id uuid)
returns setof public.lists
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select *
  from public.lists
  where id = p_list_id
    and deleted_at is null;
$$;

comment on function public.get_list(uuid)
  is 'Liefert 0 oder 1 aktive Liste (SETOF; RLS: nur Mitglieder).';

-- -----------------------------------------------------------------------------
-- 4. Ausfuehrungsrechte
--    PostgreSQL vergibt EXECUTE standardmaessig an PUBLIC — das wird hier
--    zurueckgenommen. Nur angemeldete Nutzer duerfen die RPCs aufrufen; die
--    eigentliche Autorisierung erfolgt in den Funktionen bzw. per RLS.
-- -----------------------------------------------------------------------------
revoke all on function public.create_household(uuid, text, uuid, uuid, text) from public;
revoke all on function public.ensure_default_list(uuid, uuid, text) from public;
revoke all on function public.create_list(uuid, uuid, text) from public;
revoke all on function public.rename_list(uuid, text) from public;
revoke all on function public.soft_delete_list(uuid) from public;
revoke all on function public.restore_list(uuid) from public;
revoke all on function public.list_lists(uuid) from public;
revoke all on function public.get_list(uuid) from public;

grant execute on function public.create_household(uuid, text, uuid, uuid, text) to authenticated;
grant execute on function public.ensure_default_list(uuid, uuid, text) to authenticated;
grant execute on function public.create_list(uuid, uuid, text) to authenticated;
grant execute on function public.rename_list(uuid, text) to authenticated;
grant execute on function public.soft_delete_list(uuid) to authenticated;
grant execute on function public.restore_list(uuid) to authenticated;
grant execute on function public.list_lists(uuid) to authenticated;
grant execute on function public.get_list(uuid) to authenticated;
