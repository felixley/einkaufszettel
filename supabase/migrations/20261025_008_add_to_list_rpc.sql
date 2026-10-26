-- =============================================================================
-- Einkaufszettel — Migration 008: RPC add_to_list + Idempotenz-Ledger
-- Quelle: PLAN.md §4.2 (Mengen-Aggregation, Outbox-Replay), §4.3 (Einheiten),
--         §4.5 (Sicherheit), §5 T3.2/T3.4 ("Auf die Einkaufsliste")
-- =============================================================================
-- Die serverseitige RPC `add_to_list` ist der atomare Schreibpfad fuer
-- "Auf die Einkaufsliste" (Rezept -> Liste) und fuer manuelles Hinzufuegen.
-- Der TS-Vertrag liegt in packages/core/src/add-to-list.ts; diese Migration
-- setzt ihn 1:1 in PostgreSQL um.
--
-- Grundsaetze:
--   * SECURITY INVOKER: RLS aus Migration 002 gilt unveraendert. Owner/Editor
--     duerfen schreiben, Viewer und Nichtmitglieder nicht.
--   * Idempotenz ueber ein Ledger (public.add_to_list_requests). Ein Replay
--     derselben request_id addiert die Menge nicht erneut, sondern liefert die
--     bereits betroffene Zeile mit duplicate=true (Outbox-Replay, §4.2).
--   * Atomare Aggregation: gleicher name_normalized + gleiche Dimension ->
--     UPDATE quantity = quantity + umgerechnete Menge in der Einheit der
--     vorhandenen Zeile. Inkompatible Einheit -> neue Zeile (§4.3/§4.4).
--   * checked bleibt bei neuen Zeilen false; bestehende Zeilen werden beim
--     Aggregieren nicht umgecheckt.
--
-- Die Migration ist idempotent (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE,
-- DROP POLICY IF EXISTS) und mehrfach ausfuehrbar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Internes Schema (bereits aus 003/005 vorhanden; hier defensiv erneut)
--    Hilfsfunktionen liegen in "internal", damit sie nicht als oeffentliche
--    PostgREST-RPCs exponiert werden.
-- -----------------------------------------------------------------------------
create schema if not exists internal;
revoke all on schema internal from public;
grant usage on schema internal to authenticated;

-- -----------------------------------------------------------------------------
-- 1. Hilfsfunktionen (Spiegel von packages/core/src/name.ts + units.ts)
-- -----------------------------------------------------------------------------

-- 1.1 Namensnormalisierung. Gleiche Regel wie name.ts:
--     trimmen, Kleinschreibung, Mehrfach-Whitespace zu einem Leerzeichen.
create or replace function internal.normalize_item_name(p_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(lower(p_name), '^[[:space:]]+|[[:space:]]+$', '', 'g'),
           '[[:space:]]+', ' ', 'g'
         );
$$;

comment on function internal.normalize_item_name(text)
  is 'Normalisiert Artikelnamen (trim/lower/Whitespace) wie packages/core/src/name.ts.';

-- 1.2 Dimension einer Einheit (PLAN.md §4.3).
create or replace function internal.unit_dimension(p_unit public.unit_enum)
returns text
language sql
immutable
as $$
  select case
    when p_unit is null then 'unspecified'
    when p_unit in ('g', 'kg') then 'mass'
    when p_unit in ('ml', 'l', 'TL', 'EL') then 'volume'
    when p_unit in ('Stk', 'Bund', 'Dose', 'Packung', 'Zehe') then 'piece'
    else 'unspecified'
  end;
$$;

comment on function internal.unit_dimension(public.unit_enum)
  is 'Dimension einer Einheit: mass, volume, piece oder unspecified.';

-- 1.3 Faktor zur Basiseinheit je Dimension (g, ml, Stk) — units.ts BASE_FACTORS.
create or replace function internal.unit_factor(p_unit public.unit_enum)
returns numeric
language sql
immutable
as $$
  select case p_unit
    when 'g' then 1::numeric
    when 'kg' then 1000::numeric
    when 'ml' then 1::numeric
    when 'l' then 1000::numeric
    when 'TL' then 5::numeric
    when 'EL' then 15::numeric
    when 'Stk' then 1::numeric
    when 'Bund' then 1::numeric
    when 'Dose' then 1::numeric
    when 'Packung' then 1::numeric
    when 'Zehe' then 1::numeric
    when 'Prise' then 1::numeric
    when 'n. B.' then 1::numeric
    else 1::numeric
  end;
$$;

comment on function internal.unit_factor(public.unit_enum)
  is 'Umrechnungsfaktor zur Basiseinheit der Dimension (units.ts BASE_FACTORS).';

-- 1.4 Mengenumrechnung. Spiegel von units.ts convertQuantity:
--     * gleiche Einheit (oder beide NULL) -> Menge unveraendert
--     * unterschiedliche Dimension -> NULL (nicht umrechenbar)
--     * Masse/Volumen -> auf Basiseinheit normieren, auf 3 Nachkommastellen runden
--     * Stueck-Einheiten werden bewusst NICHT zwischen verschiedenen Einheiten
--       umgerechnet (1 Bund != 1 Stk) -> NULL.
create or replace function internal.convert_quantity(
  p_quantity numeric,
  p_from     public.unit_enum,
  p_to       public.unit_enum
)
returns numeric
language plpgsql
immutable
as $$
begin
  if p_quantity is null then
    return null;
  end if;
  if p_from is not distinct from p_to then
    return p_quantity;
  end if;
  if p_from is null or p_to is null then
    return null;
  end if;
  if internal.unit_dimension(p_from) <> internal.unit_dimension(p_to) then
    return null;
  end if;
  if internal.unit_dimension(p_from) in ('mass', 'volume') then
    return round(p_quantity * internal.unit_factor(p_from) / internal.unit_factor(p_to), 3);
  end if;
  return null;
end;
$$;

comment on function internal.convert_quantity(numeric, public.unit_enum, public.unit_enum)
  is 'Rechnet eine Menge in eine andere Einheit derselben Dimension um (NULL wenn nicht moeglich).';

-- 1.5 UUIDv7-Generator fuer serverseitig angelegte Zeilen. Der Client erzeugt
--     IDs in der App (apps/web/lib/db/uuid.ts); fuer RPC-Insert ohne ID muss
--     der Server eine v7-foermige UUID liefern (Schema-Check: 15. Zeichen = 7).
--     Aufbau: 48 Bit Unix-Millisekunden | 4 Bit Version (7) | 12 Bit Zufall |
--     2 Bit Variante (10) | 62 Bit Zufall. Zufall aus gen_random_uuid()
--     (PG-Kern ab 13), damit keine Extension vorausgesetzt wird.
create or replace function internal.uuid_v7()
returns uuid
language plpgsql
volatile
as $$
declare
  v_ms  bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_hex text;
  v_r1  text := replace(gen_random_uuid()::text, '-', '');
  v_r2  text := replace(gen_random_uuid()::text, '-', '');
  v_var text;
begin
  v_hex := lpad(to_hex(v_ms), 12, '0');
  v_var := substr('89ab', (floor(random() * 4)::int) + 1, 1);
  return (
    substr(v_hex, 1, 8) || '-' ||
    substr(v_hex, 9, 4) || '-' ||
    '7' || substr(v_r1, 1, 3) || '-' ||
    v_var || substr(v_r2, 1, 3) || '-' ||
    substr(v_r1, 4, 12)
  )::uuid;
end;
$$;

comment on function internal.uuid_v7()
  is 'Erzeugt eine zeitlich sortierbare UUIDv7 (serverseitig, ohne Extension).';

-- -----------------------------------------------------------------------------
-- 2. Idempotenz-Ledger
--    Bewusst schlank (kein Soft-Delete/updated_at): Es ist ein technisches
--    Ledger, kein Domaenenobjekt. Ein Replay derselben request_id darf die
--    Menge nicht erneut addieren. Die Zeile wird zusammen mit der
--    Listen-Aenderung in derselben Transaktion geschrieben bzw. zurueckgerollt.
-- -----------------------------------------------------------------------------
create table if not exists public.add_to_list_requests (
  request_id uuid        primary key,
  user_id    uuid        not null,
  list_id    uuid        not null,
  created_at timestamptz not null default now()
);

comment on table public.add_to_list_requests is
  'Idempotenz-Ledger fuer RPC add_to_list: eine request_id wird genau einmal angewendet.';

-- RLS: Jeder Nutzer sieht/schreibt nur seine eigenen Request-Eintraege.
-- Kein UPDATE/DELETE (Ledger ist append-only).
alter table public.add_to_list_requests enable row level security;

drop policy if exists add_to_list_requests_select on public.add_to_list_requests;
create policy add_to_list_requests_select on public.add_to_list_requests
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists add_to_list_requests_insert on public.add_to_list_requests;
create policy add_to_list_requests_insert on public.add_to_list_requests
  for insert to authenticated
  with check (user_id = auth.uid());

comment on policy add_to_list_requests_select on public.add_to_list_requests is
  'Nutzer sehen nur ihre eigenen Idempotenz-Eintraege.';
comment on policy add_to_list_requests_insert on public.add_to_list_requests is
  'Nutzer duerfen nur Eintraege mit ihrer eigenen user_id anlegen.';

-- -----------------------------------------------------------------------------
-- 3. RPC add_to_list
--    Signatur bewusst ohne p_-Praefix: Der Sync-Adapter ruft
--    rpc('add_to_list', { ...request }) mit den JSON-Keys aus
--    AddToListRequest (request_id, list_id, name, quantity, unit) auf.
--    Parameter werden im Body auf v_-Variablen abgebildet, damit keine
--    Namenskollision mit Spalten entsteht.
-- -----------------------------------------------------------------------------
create or replace function public.add_to_list(
  list_id          uuid,
  name             text,
  quantity         numeric,
  unit             public.unit_enum,
  request_id       uuid,
  source_recipe_id uuid default null,
  category_id      uuid default null,
  note             text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid              uuid := auth.uid();
  v_list_id          uuid := list_id;
  v_name             text := name;
  v_quantity         numeric := quantity;
  v_unit             public.unit_enum := unit;
  v_request_id       uuid := request_id;
  v_source_recipe_id uuid := source_recipe_id;
  v_category_id      uuid := category_id;
  v_note             text := note;
  v_norm             text;
  v_new_id           uuid;
  v_target           public.list_items;
  v_row              public.list_items;
  v_converted        numeric;
begin
  if v_uid is null then
    raise exception 'Nicht authentifiziert.' using errcode = '42501';
  end if;
  if v_list_id is null or v_request_id is null then
    raise exception 'IDs muessen vom Client uebergeben werden (UUIDv7).'
      using errcode = '22004';
  end if;
  if nullif(btrim(v_name), '') is null then
    raise exception 'Artikelname darf nicht leer sein.' using errcode = '22023';
  end if;
  if v_quantity is null or v_quantity <= 0 then
    raise exception 'Menge muss groesser 0 sein.' using errcode = '22023';
  end if;

  -- Autorisierung vor dem Ledger-Insert: verhindert Ledger-Muell durch
  -- Nichtmitglieder/Viewer. RLS greift zusaetzlich beim eigentlichen Schreiben.
  if not public.is_list_writer(v_list_id) then
    raise exception 'Liste nicht gefunden oder keine Berechtigung.'
      using errcode = '42501';
  end if;

  v_norm := internal.normalize_item_name(v_name);

  -- 3.1 Idempotenz-Gate. INSERT ... ON CONFLICT DO NOTHING ist atomar: Bei
  --     parallelen Aufrufen mit derselben request_id gewinnt genau einer;
  --     der andere blockiert kurz und faellt dann in den Replay-Zweig.
  --    Der ON-CONFLICT-Zielausdruck nennt bewusst den PK-Constraint statt der
  --    Spalte "request_id": Der Parameter heisst ebenfalls request_id und
  --    PL/pgSQL wuerde die Spaltenreferenz sonst als mehrdeutig ablehnen.
  insert into public.add_to_list_requests (request_id, user_id, list_id)
  values (v_request_id, v_uid, v_list_id)
  on conflict on constraint add_to_list_requests_pkey do nothing;

  if not found then
    -- Replay: bestehende Zeile ermitteln (gleiche Normalisierung + gleiche,
    -- konvertierbare Einheit) und unveraendert zurueckgeben. Keine Mengenaenderung.
    select li.* into v_row
    from public.list_items li
    where li.list_id = v_list_id
      and li.name_normalized = v_norm
      and li.deleted_at is null
      and internal.convert_quantity(v_quantity, v_unit, li.unit) is not null
    order by li.created_at, li.id
    limit 1;

    return jsonb_build_object(
      'duplicate', true,
      'created', false,
      'list_id', v_list_id,
      'item', to_jsonb(v_row)
    );
  end if;

  -- 3.2 Aggregationsziel suchen: gleicher normalisierter Name und eine
  --     Einheit, in die sich die neue Menge umrechnen laesst. FOR UPDATE
  --     serialisiert parallele Aggregationen auf dieselbe Zeile.
  select li.* into v_target
  from public.list_items li
  where li.list_id = v_list_id
    and li.name_normalized = v_norm
    and li.deleted_at is null
    and internal.convert_quantity(v_quantity, v_unit, li.unit) is not null
  order by li.created_at, li.id
  limit 1
  for update;

  if v_target.id is not null then
    v_converted := internal.convert_quantity(v_quantity, v_unit, v_target.unit);

    -- Atomare Aggregation in der Einheit der vorhandenen Zeile. Die Quelle
    -- wird nur nachgetragen, wenn die bestehende Zeile noch keine hat.
    update public.list_items li
       set quantity = round(coalesce(li.quantity, 0) + v_converted, 3),
           source_recipe_id = coalesce(li.source_recipe_id, v_source_recipe_id),
           updated_at = now()
     where li.id = v_target.id
    returning * into v_row;

    return jsonb_build_object(
      'duplicate', false,
      'created', false,
      'list_id', v_list_id,
      'item', to_jsonb(v_row)
    );
  end if;

  -- 3.3 Kein passendes Ziel: neue Zeile anlegen. checked bleibt false.
  v_new_id := internal.uuid_v7();

  insert into public.list_items (
    id, list_id, name, name_normalized, quantity, unit,
    category_id, checked, source_recipe_id, note
  ) values (
    v_new_id, v_list_id, btrim(v_name), v_norm, v_quantity, v_unit,
    v_category_id, false, v_source_recipe_id, v_note
  )
  returning * into v_row;

  return jsonb_build_object(
    'duplicate', false,
    'created', true,
    'list_id', v_list_id,
    'item', to_jsonb(v_row)
  );
end;
$$;

comment on function public.add_to_list(uuid, text, numeric, public.unit_enum, uuid, uuid, uuid, text)
  is 'Idempotente, atomare Mengen-Aggregation auf eine Liste (PLAN.md §4.2/§4.3, T3.2/T3.4).';

-- -----------------------------------------------------------------------------
-- 4. Ausfuehrungsrechte
--    Kein Zugriff fuer anon/PUBLIC. Nur angemeldete Nutzer duerfen die RPC und
--    ihre internen Helfer aufrufen; die Autorisierung erfolgt per RLS.
-- -----------------------------------------------------------------------------
revoke all on function internal.normalize_item_name(text) from public;
revoke all on function internal.unit_dimension(public.unit_enum) from public;
revoke all on function internal.unit_factor(public.unit_enum) from public;
revoke all on function internal.convert_quantity(numeric, public.unit_enum, public.unit_enum) from public;
revoke all on function internal.uuid_v7() from public;

revoke all on function internal.normalize_item_name(text) from anon;
revoke all on function internal.unit_dimension(public.unit_enum) from anon;
revoke all on function internal.unit_factor(public.unit_enum) from anon;
revoke all on function internal.convert_quantity(numeric, public.unit_enum, public.unit_enum) from anon;
revoke all on function internal.uuid_v7() from anon;

grant execute on function internal.normalize_item_name(text) to authenticated;
grant execute on function internal.unit_dimension(public.unit_enum) to authenticated;
grant execute on function internal.unit_factor(public.unit_enum) to authenticated;
grant execute on function internal.convert_quantity(numeric, public.unit_enum, public.unit_enum) to authenticated;
grant execute on function internal.uuid_v7() to authenticated;

revoke all on function public.add_to_list(uuid, text, numeric, public.unit_enum, uuid, uuid, uuid, text) from public;
revoke all on function public.add_to_list(uuid, text, numeric, public.unit_enum, uuid, uuid, uuid, text) from anon;
grant execute on function public.add_to_list(uuid, text, numeric, public.unit_enum, uuid, uuid, uuid, text) to authenticated;

-- Ledger: authenticated darf lesen und schreiben (RLS filtert auf eigene Zeilen);
-- anon/PUBLIC bekommen keinerlei Rechte. Kein UPDATE/DELETE (append-only).
revoke all on public.add_to_list_requests from public;
revoke all on public.add_to_list_requests from anon;
grant select, insert on public.add_to_list_requests to authenticated;
