-- =============================================================================
-- Einkaufszettel — Migration 004: RLS-Fix fuer Listen (Soft-Delete/Restore)
-- Quelle: PLAN.md §4.2 (Soft-Delete/Undo), §4.5 (Sicherheit), §5 T2.2
-- =============================================================================
-- Zwei Befunde aus pgTAP + manueller PG-Pruefung (PostgreSQL 16.2):
--
-- 1) lists_select blendete soft-geloeschte Zeilen fuer ALLE Mitglieder aus
--    (deleted_at IS NULL). PostgreSQL wendet die USING-Klausel der SELECT-
--    Policy bei UPDATE zusaetzlich auf die NEUE Zeile an. Dadurch schlug
--    jedes Soft-Delete (deleted_at = now()) mit "new row violates row-level
--    security policy" fehl — Owner/Editor konnten Listen also nicht mehr
--    soft-loeschen. Dasselbe Problem wurde fuer list_items bereits in
--    Migration 002 geloest (Writer duerfen soft-geloeschte Zeilen sehen).
--    Fix: Writer (Owner/Editor) sehen auch soft-geloeschte Listen (noetig fuer
--    Restore/Undo und Outbox-Replay); Viewer sehen weiterhin nur aktive Listen.
--    Die Vertraulichkeit bleibt gewahrt: der Haushaltsbezug wird weiterhin
--    ueber is_household_member() geprueft, Nichtmitglieder sehen nichts.
--
-- 2) get_list() war als RETURNS public.lists deklariert, also als EINZELNE
--    Komposit-Zeile. Liefert die Funktion keine Zeile (soft-geloescht oder
--    Nichtmitglied), gibt PostgreSQL NULL zurueck — und "select count(*) from
--    get_list(...)" zaehlt diese NULL-Zeile als 1. Clients, die count(*)
--    auswerten, saehen damit einen Treffer, obwohl keine Liste geliefert
--    wurde. Fix: RETURNS SETOF public.lists. Ein leerer Treffer ist damit
--    sauber "0 Zeilen" (PostgREST: leeres Array; .maybeSingle() -> null).
--    Weil PostgreSQL den Rueckgabetyp einer bestehenden Funktion nicht per
--    CREATE OR REPLACE aendern kann, wird die Funktion vorher gedroppt.
--    Zusaetzlich prueft der Koerper die Mitgliedschaft explizit (Defense in
--    Depth, damit auch bei kuenftigen PG-Versionsaenderungen nichts leakt).
--
-- Die Migration ist idempotent (DROP POLICY IF EXISTS / DROP FUNCTION IF
-- EXISTS + CREATE ... OR REPLACE) und mehrfach ausfuehrbar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SELECT-Policy: Writer duerfen soft-geloeschte Listen sehen
-- -----------------------------------------------------------------------------
drop policy if exists lists_select on public.lists;

create policy lists_select on public.lists
  for select to authenticated
  using (
    public.is_household_member(household_id)
    and (
      deleted_at is null
      or public.is_household_writer(household_id)
    )
  );

comment on policy lists_select on public.lists is
  'Mitglieder sehen aktive Listen; Owner/Editor zusaetzlich soft-geloeschte (Restore/Undo).';

-- -----------------------------------------------------------------------------
-- 2. get_list: SETOF statt Einzel-Komposit + explizite Mitgliedschaftspruefung
-- -----------------------------------------------------------------------------
drop function if exists public.get_list(uuid);

create function public.get_list(p_list_id uuid)
returns setof public.lists
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.*
  from public.lists l
  where l.id = p_list_id
    and l.deleted_at is null
    and public.is_household_member(l.household_id);
$$;

comment on function public.get_list(uuid)
  is 'Liefert 0 oder 1 aktive Liste (SETOF); prueft die Mitgliedschaft explizit (Defense in Depth).';

-- -----------------------------------------------------------------------------
-- 3. list_lists: explizite Mitgliedschaftspruefung (Defense in Depth)
-- -----------------------------------------------------------------------------
create or replace function public.list_lists(p_household_id uuid)
returns setof public.lists
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.*
  from public.lists l
  where l.household_id = p_household_id
    and l.deleted_at is null
    and public.is_household_member(l.household_id)
  order by l.created_at, l.id;
$$;

comment on function public.list_lists(uuid)
  is 'Liefert aktive Listen eines Haushalts (SETOF); prueft die Mitgliedschaft explizit.';

-- -----------------------------------------------------------------------------
-- 4. Ausfuehrungsrechte
--    get_list wurde gedroppt und neu erzeugt -> Rechte muessen neu gesetzt
--    werden. list_lists wurde per CREATE OR REPLACE ersetzt (Rechte bleiben),
--    wird zur Sicherheit aber ebenfalls neu gesetzt (idempotent).
-- -----------------------------------------------------------------------------
revoke all on function public.get_list(uuid) from public;
revoke all on function public.list_lists(uuid) from public;
grant execute on function public.get_list(uuid) to authenticated;
grant execute on function public.list_lists(uuid) to authenticated;
