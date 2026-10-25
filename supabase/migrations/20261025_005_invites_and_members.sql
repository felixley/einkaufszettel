-- =============================================================================
-- Einkaufszettel — Migration 005: Einladungen (T2.3) + Mitgliederverwaltung (T2.4)
-- Quelle: PLAN.md §4.1 (Datenmodell), §4.5 (Sicherheit),
--         §5 T2.3 (Einladung Link/QR, Rollenwahl, Widerruf, Ablauf),
--         §5 T2.4 (Rolle aendern, entfernen, Haushalt verlassen)
-- =============================================================================
-- Sicherheitsmodell (vgl. Migration 002):
--   * Einladungen anlegen/widerrufen/auflisten: nur Owner des Haushalts.
--   * Einloesung: jeder angemeldete Nutzer, der den Token (Hash) besitzt.
--     Der Token ist das Bearer-Geheimnis; gespeichert wird ausschliesslich
--     sein Hash (PLAN.md §4.5).
--   * Mitgliederverwaltung (Rolle aendern, entfernen): nur Owner.
--   * Haushalt verlassen: jedes aktive Mitglied; der LETZTE Owner nicht.
--   * Letzter-Owner-Regel gilt symmetrisch fuer Austritt, Entfernen und
--     Rollenwechsel weg von 'owner' — es bleibt immer >= 1 aktiver Owner.
--
-- Abweichung vom INVOKER-Grundsatz (bewusst, dokumentiert):
--   Zwei Schreibpfade koennen nicht per RLS abgebildet werden, weil der
--   Aufrufer kein Owner ist bzw. nicht Owner sein darf:
--     a) Einloesung einer Einladung — der Eingeladene darf `invites` nicht
--        lesen/schreiben (invites_*-Policies sind Owner-only) und sich nicht
--        selbst in `household_members` eintragen (Insert-Policy: Owner oder
--        Bootstrap). Die Pruefung erfolgt deshalb in `internal.accept_invite`
--        (SECURITY DEFINER) mit expliziter Token-/Ablauf-/Auslastungspruefung.
--     b) Haushalt verlassen — `household_members_update` verlangt Owner-Rechte;
--        ein Editor/Viewer kann seine eigene Zeile daher nicht selbst auf
--        deleted_at setzen. Loesung: `internal.leave_household`
--        (SECURITY DEFINER) mit identischer Letzter-Owner-Pruefung.
--   Diese beiden Helfer liegen im Schema `internal` (nicht per PostgREST
--   exponiert), nehmen NIE eine fremde User-ID entgegen (sie arbeiten mit
--   auth.uid()) und sind nur fuer `authenticated` ausfuehrbar. Alle uebrigen
--   RPCs dieser Migration laufen SECURITY INVOKER, RLS bleibt dort aktiv.
--
-- Replay-Sicherheit (PLAN.md §4.2): Alle Funktionen sind mit Client-IDs und
-- identischen Parametern erneut aufrufbar, ohne Duplikate oder doppelt
-- verbrauchte Einladungen zu erzeugen.
--
-- Die Migration ist idempotent (CREATE OR REPLACE / REVOKE+GRANT).
-- =============================================================================

create schema if not exists internal;
revoke all on schema internal from public;
grant usage on schema internal to authenticated;

-- -----------------------------------------------------------------------------
-- 0. Interne Helfer
-- -----------------------------------------------------------------------------

-- Anzahl aktiver Owner eines Haushalts. SECURITY DEFINER, damit die Pruefung
-- auch in internen (Definer-)Pfaden ohne RLS-Luecke funktioniert.
create or replace function internal.active_owner_count(p_household_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from public.household_members m
  where m.household_id = p_household_id
    and m.role = 'owner'
    and m.deleted_at is null;
$$;

-- Reassigniert households.owner_id, wenn der eingetragene Owner den Haushalt
-- verlaesst/entfernt/wird herabgestuft. Waehlt den aeltesten verbleibenden
-- aktiven Owner. No-op, wenn der betroffene Nutzer nicht owner_id ist oder
-- noch ein anderer Owner eingetragen werden kann.
create or replace function internal.reassign_household_owner(
  p_household_id uuid,
  p_leaving_user uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_owner uuid;
begin
  if not exists (
    select 1 from public.households
    where id = p_household_id and owner_id = p_leaving_user
  ) then
    return;
  end if;

  select m.user_id into v_new_owner
  from public.household_members m
  where m.household_id = p_household_id
    and m.role = 'owner'
    and m.deleted_at is null
    and m.user_id <> p_leaving_user
  order by m.created_at, m.id
  limit 1;

  if v_new_owner is null then
    -- Kein weiterer Owner vorhanden: Aufrufer haette vorher die
    -- Letzter-Owner-Regel pruefen muessen. Wir brechen bewusst ab, damit
    -- kein Haushalt ohne Owner entsteht.
    raise exception 'Haushalt haette danach keinen Owner mehr.'
      using errcode = 'P0001';
  end if;

  update public.households
  set owner_id = v_new_owner, updated_at = now()
  where id = p_household_id;
end;
$$;

-- Einladung per Token-Hash nachschlagen. Liefert auch abgelaufene/widerrufene/
-- aufgebrauchte Zeilen, damit der Aufrufer den konkreten Grund melden kann.
-- Rueckgabe: jsonb oder null.
create or replace function internal.find_invite(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(i)
  from public.invites i
  join public.households h on h.id = i.household_id
  where i.token_hash = p_token_hash
    and i.deleted_at is null
    and h.deleted_at is null
  limit 1;
$$;

-- Einladung einloesen (atomar). Prueft Token, Widerruf, Ablauf, Auslastung,
-- sperrt die Einladungszeile gegen parallele Einloesung und legt die
-- Mitgliedschaft an. Ist der Aufrufer bereits aktives Mitglied, ist der
-- Aufruf ein idempotenter No-op (Replay-Sicherheit, kein zweiter Verbrauch,
-- keine Rollenaenderung durch fremde Links).
create or replace function internal.accept_invite(
  p_token_hash text,
  p_member_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_invite       public.invites;
  v_household    public.households;
  v_existing     public.household_members;
  v_prev_role    public.household_role;
  v_restored     boolean := false;
begin
  if v_uid is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;
  if p_token_hash is null or length(p_token_hash) < 32 then
    raise exception 'Ungueltiger Einladungstoken.' using errcode = '22023';
  end if;
  if p_member_id is null then
    raise exception 'Mitglieds-ID muss vom Client uebergeben werden (UUIDv7).'
      using errcode = '22004';
  end if;

  -- Zeile sperren: zwei gleichzeitige Einloesungen derselben Einladung
  -- serialisieren hier (max_uses wird dadurch verlaesslich eingehalten).
  select * into v_invite
  from public.invites
  where token_hash = p_token_hash
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Einladung nicht gefunden.' using errcode = 'P0002';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'Einladung wurde widerrufen.' using errcode = '22023';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'Einladung ist abgelaufen.' using errcode = '22023';
  end if;

  select * into v_household
  from public.households
  where id = v_invite.household_id
    and deleted_at is null;

  if not found then
    raise exception 'Einladung nicht gefunden.' using errcode = 'P0002';
  end if;

  -- Bereits aktives Mitglied? Dann idempotenter Erfolg ohne Verbrauch.
  select * into v_existing
  from public.household_members
  where household_id = v_invite.household_id
    and user_id = v_uid
    and deleted_at is null;

  if found then
    return jsonb_build_object(
      'household_id',   v_invite.household_id,
      'household_name', v_household.name,
      'role',           v_existing.role,
      'already_member', true
    );
  end if;

  if v_invite.used_count >= v_invite.max_uses then
    raise exception 'Einladung ist aufgebraucht.' using errcode = '22023';
  end if;

  -- Frueher entferntes Mitglied (Soft-Delete) reaktivieren, sonst neu anlegen.
  select * into v_existing
  from public.household_members
  where household_id = v_invite.household_id
    and user_id = v_uid
  order by created_at desc
  limit 1;

  if found then
    v_prev_role := v_existing.role;
    update public.household_members
    set deleted_at = null,
        role = v_invite.role,
        updated_at = now()
    where id = v_existing.id;
    v_restored := true;
  else
    insert into public.household_members (id, household_id, user_id, role)
    values (p_member_id, v_invite.household_id, v_uid, v_invite.role);
  end if;

  update public.invites
  set used_count = used_count + 1, updated_at = now()
  where id = v_invite.id;

  return jsonb_build_object(
    'household_id',    v_invite.household_id,
    'household_name',  v_household.name,
    'role',            v_invite.role,
    'already_member',  false,
    'restored_member', v_restored,
    'previous_role',   v_prev_role
  );
end;
$$;

-- Haushalt verlassen (jedes aktive Mitglied; letzter Owner nicht).
create or replace function internal.leave_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.household_role;
begin
  if v_uid is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;

  select role into v_role
  from public.household_members
  where household_id = p_household_id
    and user_id = v_uid
    and deleted_at is null;

  if not found then
    raise exception 'Keine aktive Mitgliedschaft in diesem Haushalt.'
      using errcode = 'P0002';
  end if;

  if v_role = 'owner' and internal.active_owner_count(p_household_id) <= 1 then
    raise exception 'Der letzte Owner kann den Haushalt nicht verlassen.'
      using errcode = 'P0001';
  end if;

  -- owner_id zuerst umhaengen (der Aufrufer ist in diesem Moment noch Owner),
  -- danach die eigene Mitgliedszeile soft-loeschen.
  if v_role = 'owner' then
    perform internal.reassign_household_owner(p_household_id, v_uid);
  end if;

  update public.household_members
  set deleted_at = now(), updated_at = now()
  where household_id = p_household_id
    and user_id = v_uid
    and deleted_at is null;
end;
$$;

revoke all on function internal.active_owner_count(uuid) from public;
revoke all on function internal.reassign_household_owner(uuid, uuid) from public;
revoke all on function internal.find_invite(text) from public;
revoke all on function internal.accept_invite(text, uuid) from public;
revoke all on function internal.leave_household(uuid) from public;

grant execute on function internal.active_owner_count(uuid) to authenticated;
grant execute on function internal.reassign_household_owner(uuid, uuid) to authenticated;
grant execute on function internal.find_invite(text) to authenticated;
grant execute on function internal.accept_invite(text, uuid) to authenticated;
grant execute on function internal.leave_household(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 1. Einladung anlegen (nur Owner)
-- -----------------------------------------------------------------------------
-- Der Client erzeugt den Token (>= 128 Bit Zufall) und uebermittelt NUR den
-- Hash. Der Roh-Token bleibt beim Client und wird fuer Link/QR verwendet.
create or replace function public.create_invite(
  p_invite_id     uuid,
  p_household_id  uuid,
  p_token_hash    text,
  p_role          public.household_role default 'viewer',
  p_max_uses      integer default 1,
  p_expires_at    timestamptz default null
)
returns public.invites
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_expires timestamptz := coalesce(p_expires_at, now() + interval '7 days');
  v_row     public.invites;
begin
  if auth.uid() is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;
  if p_invite_id is null or p_household_id is null then
    raise exception 'IDs muessen vom Client uebergeben werden (UUIDv7).'
      using errcode = '22004';
  end if;
  if p_token_hash is null or length(p_token_hash) < 32 then
    raise exception 'token_hash muss mindestens 32 Zeichen haben (Hash, kein Roh-Token).'
      using errcode = '22023';
  end if;
  if p_max_uses is null or p_max_uses < 1 then
    raise exception 'max_uses muss mindestens 1 sein.' using errcode = '22023';
  end if;
  if v_expires <= now() then
    raise exception 'expires_at muss in der Zukunft liegen.' using errcode = '22023';
  end if;

  if not public.is_household_owner(p_household_id) then
    raise exception 'Nur Owner duerfen Einladungen anlegen.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.households
    where id = p_household_id and deleted_at is null
  ) then
    raise exception 'Haushalt nicht gefunden oder keine Berechtigung.'
      using errcode = '42501';
  end if;

  -- Replay-sicher: identischer Aufruf (Outbox) legt nichts doppelt an.
  insert into public.invites (id, household_id, token_hash, role, expires_at, max_uses)
  values (p_invite_id, p_household_id, p_token_hash, p_role, v_expires, p_max_uses)
  on conflict (id) do nothing;

  select * into v_row
  from public.invites
  where id = p_invite_id
    and household_id = p_household_id
    and deleted_at is null;

  if not found then
    raise exception 'Einladung konnte nicht angelegt werden.' using errcode = '42501';
  end if;

  return v_row;
end;
$$;

comment on function public.create_invite(uuid, uuid, text, public.household_role, integer, timestamptz)
  is 'Legt eine Einladung an (Owner only); speichert nur den Token-Hash. Replay-sicher.';

-- -----------------------------------------------------------------------------
-- 2. Einladung widerrufen (nur Owner)
-- -----------------------------------------------------------------------------
create or replace function public.revoke_invite(p_invite_id uuid)
returns public.invites
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_household_id uuid;
  v_row          public.invites;
begin
  if auth.uid() is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;

  select household_id into v_household_id
  from public.invites
  where id = p_invite_id and deleted_at is null;

  if not found then
    raise exception 'Einladung nicht gefunden.' using errcode = 'P0002';
  end if;

  if not public.is_household_owner(v_household_id) then
    raise exception 'Nur Owner duerfen Einladungen widerrufen.'
      using errcode = '42501';
  end if;

  update public.invites
  set revoked_at = coalesce(revoked_at, now()), updated_at = now()
  where id = p_invite_id and deleted_at is null;

  select * into v_row from public.invites where id = p_invite_id;
  return v_row;
end;
$$;

comment on function public.revoke_invite(uuid)
  is 'Widerruft eine Einladung (Owner only); idempotent.';

-- -----------------------------------------------------------------------------
-- 3. Einladungen eines Haushalts auflisten (nur Owner; RLS)
-- -----------------------------------------------------------------------------
create or replace function public.list_household_invites(p_household_id uuid)
returns setof public.invites
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select *
  from public.invites
  where household_id = p_household_id
    and deleted_at is null
  order by created_at, id;
$$;

comment on function public.list_household_invites(uuid)
  is 'Listet aktive Einladungen (RLS: nur Owner sehen ihre Einladungen).';

-- -----------------------------------------------------------------------------
-- 4. Einladung pruefen (Statusanzeige vor dem Beitritt, ohne Verbrauch)
-- -----------------------------------------------------------------------------
create or replace function public.check_invite(p_token_hash text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_inv jsonb;
  v_exp  timestamptz;
  v_used integer;
  v_max  integer;
  v_rev  timestamptz;
begin
  if p_token_hash is null or length(p_token_hash) < 32 then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  v_inv := internal.find_invite(p_token_hash);
  if v_inv is null then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  v_exp  := (v_inv->>'expires_at')::timestamptz;
  v_used := (v_inv->>'used_count')::integer;
  v_max  := (v_inv->>'max_uses')::integer;
  v_rev  := (v_inv->>'revoked_at')::timestamptz;

  if v_rev is not null then
    return jsonb_build_object('valid', false, 'reason', 'revoked',
                              'household_id', v_inv->>'household_id');
  end if;
  if v_exp <= now() then
    return jsonb_build_object('valid', false, 'reason', 'expired',
                              'household_id', v_inv->>'household_id');
  end if;
  if v_used >= v_max then
    return jsonb_build_object('valid', false, 'reason', 'exhausted',
                              'household_id', v_inv->>'household_id');
  end if;

  return jsonb_build_object(
    'valid',           true,
    'household_id',    v_inv->>'household_id',
    'role',            v_inv->>'role',
    'expires_at',      v_inv->>'expires_at',
    'max_uses',        v_max,
    'used_count',      v_used,
    'remaining_uses',  v_max - v_used
  );
end;
$$;

comment on function public.check_invite(text)
  is 'Prueft einen Einladungstoken ohne ihn zu verbrauchen (gueltig/abgelaufen/widerrufen/aufgebraucht).';

-- -----------------------------------------------------------------------------
-- 5. Einladung einloesen (jeder angemeldete Nutzer mit Token)
-- -----------------------------------------------------------------------------
create or replace function public.accept_invite(
  p_token_hash text,
  p_member_id  uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;
  -- Die eigentliche Pruefung/Schreibung liegt im internen Definer-Helfer,
  -- weil der Eingeladene `invites` und `household_members` nicht per RLS
  -- beschreiben darf (siehe Migrationskopf).
  return internal.accept_invite(p_token_hash, p_member_id);
end;
$$;

comment on function public.accept_invite(text, uuid)
  is 'Loest eine Einladung ein und legt die Mitgliedschaft mit der Einladungsrolle an (idempotent fuer bestehende Mitglieder).';

-- -----------------------------------------------------------------------------
-- 6. Mitgliederrolle aendern (nur Owner)
-- -----------------------------------------------------------------------------
create or replace function public.change_member_role(
  p_household_id uuid,
  p_user_id      uuid,
  p_new_role     public.household_role
)
returns public.household_members
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.household_members;
begin
  if auth.uid() is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;
  if p_new_role is null then
    raise exception 'Neue Rolle muss angegeben werden.' using errcode = '22004';
  end if;

  if not public.is_household_owner(p_household_id) then
    raise exception 'Nur Owner duerfen Rollen aendern.' using errcode = '42501';
  end if;

  select * into v_row
  from public.household_members
  where household_id = p_household_id
    and user_id = p_user_id
    and deleted_at is null;

  if not found then
    raise exception 'Mitglied nicht gefunden.' using errcode = 'P0002';
  end if;

  -- Letzter-Owner-Regel: der letzte aktive Owner darf nicht herabgestuft werden.
  if v_row.role = 'owner' and p_new_role <> 'owner' then
    if internal.active_owner_count(p_household_id) <= 1 then
      raise exception 'Der letzte Owner kann nicht herabgestuft werden.'
        using errcode = 'P0001';
    end if;
    -- owner_id des Haushalts auf einen verbleibenden Owner umhaengen.
    perform internal.reassign_household_owner(p_household_id, p_user_id);
  end if;

  update public.household_members
  set role = p_new_role, updated_at = now()
  where id = v_row.id;

  select * into v_row from public.household_members where id = v_row.id;
  return v_row;
end;
$$;

comment on function public.change_member_role(uuid, uuid, public.household_role)
  is 'Aendert die Rolle eines Mitglieds (Owner only); Letzter-Owner-Schutz. Wirkt sofort auf RLS-Schreibrechte.';

-- -----------------------------------------------------------------------------
-- 7. Mitglied entfernen (nur Owner; Selbstentfernung = Haushalt verlassen)
-- -----------------------------------------------------------------------------
create or replace function public.remove_member(
  p_household_id uuid,
  p_user_id      uuid
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.household_role;
begin
  if v_uid is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;

  if not public.is_household_owner(p_household_id) then
    raise exception 'Nur Owner duerfen Mitglieder entfernen.' using errcode = '42501';
  end if;

  -- Selbstentfernung ist "Haushalt verlassen" (gleiche Letzter-Owner-Regel).
  if p_user_id = v_uid then
    perform internal.leave_household(p_household_id);
    return;
  end if;

  select role into v_role
  from public.household_members
  where household_id = p_household_id
    and user_id = p_user_id
    and deleted_at is null;

  if not found then
    raise exception 'Mitglied nicht gefunden.' using errcode = 'P0002';
  end if;

  -- Defensive Letzter-Owner-Regel (Owner-only-Policy macht den Fall nur bei
  -- inkonsistenten Daten erreichbar; siehe leave_household).
  if v_role = 'owner' and internal.active_owner_count(p_household_id) <= 1 then
    raise exception 'Der letzte Owner kann nicht entfernt werden.'
      using errcode = 'P0001';
  end if;

  if v_role = 'owner' then
    perform internal.reassign_household_owner(p_household_id, p_user_id);
  end if;

  update public.household_members
  set deleted_at = now(), updated_at = now()
  where household_id = p_household_id
    and user_id = p_user_id
    and deleted_at is null;
end;
$$;

comment on function public.remove_member(uuid, uuid)
  is 'Entfernt ein Mitglied (Owner only); Soft-Delete, entzieht Zugriff sofort. Selbstentfernung = verlassen.';

-- -----------------------------------------------------------------------------
-- 8. Haushalt verlassen (jedes aktive Mitglied; letzter Owner nicht)
-- -----------------------------------------------------------------------------
create or replace function public.leave_household(p_household_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;
  -- RLS erlaubt nur Ownern das UPDATE eigener Mitgliedszeilen; fuer
  -- Editor/Viewer laeuft der Schreibpfad daher im internen Definer-Helfer.
  perform internal.leave_household(p_household_id);
end;
$$;

comment on function public.leave_household(uuid)
  is 'Verlaesst einen Haushalt (Soft-Delete der eigenen Mitgliedschaft); letzter Owner wird abgelehnt.';

-- -----------------------------------------------------------------------------
-- 9. Ausfuehrungsrechte
-- -----------------------------------------------------------------------------
revoke all on function public.create_invite(uuid, uuid, text, public.household_role, integer, timestamptz) from public;
revoke all on function public.revoke_invite(uuid) from public;
revoke all on function public.list_household_invites(uuid) from public;
revoke all on function public.check_invite(text) from public;
revoke all on function public.accept_invite(text, uuid) from public;
revoke all on function public.change_member_role(uuid, uuid, public.household_role) from public;
revoke all on function public.remove_member(uuid, uuid) from public;
revoke all on function public.leave_household(uuid) from public;

grant execute on function public.create_invite(uuid, uuid, text, public.household_role, integer, timestamptz) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.list_household_invites(uuid) to authenticated;
grant execute on function public.check_invite(text) to authenticated;
grant execute on function public.accept_invite(text, uuid) to authenticated;
grant execute on function public.change_member_role(uuid, uuid, public.household_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
