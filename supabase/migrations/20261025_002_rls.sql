-- =============================================================================
-- Einkaufszettel — Migration 002: Row Level Security
-- Quelle: PLAN.md §4.5 (Sicherheit)
-- =============================================================================
-- Sicherheitsmodell:
--   * Zugriff nur fuer Mitglieder des jeweiligen Haushalts.
--   * Schreiben (INSERT/UPDATE) nur fuer Owner und Editor.
--   * Rollenverwaltung (household_members, invites) nur fuer Owner.
--   * Loeschen ausschliesslich ueber deleted_at (UPDATE). DELETE-Policies
--     sind explizit mit USING (false) gesperrt; zusaetzlich greift der
--     prevent_physical_delete-Trigger aus Migration 001.
--
-- Lese-Policies blenden soft-geloeschte Zeilen aus (deleted_at IS NULL).
-- Schreib-Policies erlauben das Setzen/Loeschen von deleted_at (Soft-Delete
-- und Undo), damit der Client "Loeschen rueckgaengig" umsetzen kann.
--
-- Alle Helferfunktionen sind SECURITY DEFINER, damit die Policy-Pruefung auf
-- household_members nicht erneut RLS ausloest (Rekursionsschutz) und damit
-- sie auch dann funktionieren, wenn die aufrufende Rolle keinen direkten
-- Tabellenzugriff hat.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helferfunktionen
-- -----------------------------------------------------------------------------
-- Aktives Mitglied eines aktiven Haushalts (fuer SELECT).
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.household_members m
    join public.households h on h.id = m.household_id
    where m.household_id = hid
      and m.user_id = auth.uid()
      and m.deleted_at is null
      and h.deleted_at is null
  );
$$;

-- Rolle des aktuellen Nutzers im Haushalt (aktive Mitgliedschaft, Haushalt
-- darf soft-geloescht sein, damit Undo/Undelete moeglich bleibt).
create or replace function public.household_role_of(hid uuid)
returns public.household_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
  from public.household_members m
  where m.household_id = hid
    and m.user_id = auth.uid()
    and m.deleted_at is null
  limit 1;
$$;

-- Schreibrecht: Owner/Editor eines AKTIVEN Haushalts.
create or replace function public.is_household_writer(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.household_role_of(hid) in ('owner', 'editor'), false)
         and exists (
           select 1 from public.households h
           where h.id = hid and h.deleted_at is null
         );
$$;

-- Owner-Verwaltung: Rolle Owner (Haushalt darf soft-geloescht sein).
create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.household_role_of(hid) = 'owner', false);
$$;

-- Creator-Bootstrap: Ist der aktuelle Nutzer als owner_id am Haushalt
-- eingetragen? SECURITY DEFINER, damit die Pruefung nicht an der
-- households_select-Policy scheitert, bevor die erste Mitgliedszeile existiert.
create or replace function public.is_household_owner_record(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.households h
    where h.id = hid and h.owner_id = auth.uid() and h.deleted_at is null
  );
$$;

-- Existiert bereits eine aktive Mitgliedszeile im Haushalt? (Bootstrap-Schutz)
create or replace function public.household_has_members(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.deleted_at is null
  );
$$;

-- True, wenn der aktuelle Nutzer und other_user mindestens einen aktiven
-- Haushalt gemeinsam haben. Wird fuer die profiles-SELECT-Policy benoetigt.
create or replace function public.shares_household_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.household_members me
    join public.household_members them
      on them.household_id = me.household_id
    join public.households h
      on h.id = me.household_id
    where me.user_id = auth.uid()
      and me.deleted_at is null
      and them.user_id = other_user
      and them.deleted_at is null
      and h.deleted_at is null
  );
$$;

create or replace function public.is_list_member(lid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.lists l
    where l.id = lid
      and l.deleted_at is null
      and public.is_household_member(l.household_id)
  );
$$;

create or replace function public.is_list_writer(lid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.lists l
    where l.id = lid
      and l.deleted_at is null
      and public.is_household_writer(l.household_id)
  );
$$;

create or replace function public.is_recipe_member(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.recipes r
    where r.id = rid
      and r.deleted_at is null
      and public.is_household_member(r.household_id)
  );
$$;

create or replace function public.is_recipe_writer(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.recipes r
    where r.id = rid
      and r.deleted_at is null
      and public.is_household_writer(r.household_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. RLS aktivieren
-- -----------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.households          enable row level security;
alter table public.household_members   enable row level security;
alter table public.categories          enable row level security;
alter table public.invites             enable row level security;
alter table public.lists               enable row level security;
alter table public.recipes             enable row level security;
alter table public.recipe_ingredients  enable row level security;
alter table public.category_rules      enable row level security;
alter table public.list_items          enable row level security;

-- -----------------------------------------------------------------------------
-- 3. Policies — genau eine pro Operation und Tabelle
-- -----------------------------------------------------------------------------

-- 3.1 profiles — eigenes Profil immer; fremde Profile nur bei gemeinsamem
--     aktivem Haushalt. Soft-geloeschte fremde Profile bleiben verborgen.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (deleted_at is null and public.shares_household_with(id))
  );

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_no_delete on public.profiles
  for delete to authenticated
  using (false);

-- 3.2 households — Lesen: Mitglieder oder der eingetragene Creator-Owner
--     (Bootstrap). Schreiben: nur Owner. Soft-Delete via UPDATE (owner_id
--     bleibt unveraendert, weil WITH CHECK denselben Owner verlangt).
create policy households_select on public.households
  for select to authenticated
  using (
    deleted_at is null
    and (owner_id = auth.uid() or public.is_household_member(id))
  );

create policy households_insert on public.households
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy households_update on public.households
  for update to authenticated
  using (public.is_household_owner(id))
  with check (public.is_household_owner(id));

create policy households_no_delete on public.households
  for delete to authenticated
  using (false);

-- 3.3 household_members — Lesen: Mitglieder. Verwalten: nur Owner.
--     Bootstrap: Der in households.owner_id eingetragene Creator darf die
--     allererste Owner-Mitgliedszeile anlegen, solange noch keine existiert.
create policy household_members_select on public.household_members
  for select to authenticated
  using (deleted_at is null and public.is_household_member(household_id));

create policy household_members_insert on public.household_members
  for insert to authenticated
  with check (
    public.is_household_owner(household_id)
    or (
      user_id = auth.uid()
      and role = 'owner'
      and public.is_household_owner_record(household_id)
      and not public.household_has_members(household_id)
    )
  );

create policy household_members_update on public.household_members
  for update to authenticated
  using (public.is_household_owner(household_id))
  with check (public.is_household_owner(household_id));

create policy household_members_no_delete on public.household_members
  for delete to authenticated
  using (false);

-- 3.4 invites — Tokens sind sensibel: nur Owner darf sie sehen/verwalten.
create policy invites_select on public.invites
  for select to authenticated
  using (deleted_at is null and public.is_household_owner(household_id));

create policy invites_insert on public.invites
  for insert to authenticated
  with check (public.is_household_owner(household_id));

create policy invites_update on public.invites
  for update to authenticated
  using (public.is_household_owner(household_id))
  with check (public.is_household_owner(household_id));

create policy invites_no_delete on public.invites
  for delete to authenticated
  using (false);

-- 3.5 lists — Lesen: Mitglieder; Schreiben: Owner/Editor.
create policy lists_select on public.lists
  for select to authenticated
  using (deleted_at is null and public.is_household_member(household_id));

create policy lists_insert on public.lists
  for insert to authenticated
  with check (public.is_household_writer(household_id));

create policy lists_update on public.lists
  for update to authenticated
  using (public.is_household_writer(household_id))
  with check (public.is_household_writer(household_id));

create policy lists_no_delete on public.lists
  for delete to authenticated
  using (false);

-- 3.6 list_items — Lesen: Mitglieder der Liste; Schreiben: Owner/Editor.
-- Wichtig fuer Soft-Delete: PostgreSQL wendet die USING-Klausel der
-- SELECT-Policy beim UPDATE auch auf die NEUE Zeile an. Wuerde hier
-- ausschliesslich "deleted_at is null" stehen, koennte niemand eine Zeile
-- soft-loeschen (der neue Zustand deleted_at = now() wuerde die Policy
-- verletzen). Owner/Editor duerfen soft-geloeschte Zeilen daher weiterhin
-- sehen (z. B. zum Wiederherstellen); Viewer sehen nur aktive Zeilen.
create policy list_items_select on public.list_items
  for select to authenticated
  using (
    (deleted_at is null or public.is_list_writer(list_id))
    and public.is_list_member(list_id)
  );

create policy list_items_insert on public.list_items
  for insert to authenticated
  with check (public.is_list_writer(list_id));

create policy list_items_update on public.list_items
  for update to authenticated
  using (public.is_list_writer(list_id))
  with check (public.is_list_writer(list_id));

create policy list_items_no_delete on public.list_items
  for delete to authenticated
  using (false);

-- 3.7 categories — global lesbar; haushaltsspezifisch nur fuer Mitglieder.
--     Schreiben nur fuer Owner/Editor des Haushalts (globale Kategorien
--     werden ausschliesslich per Seed/Migration angelegt).
create policy categories_select on public.categories
  for select to authenticated
  using (
    deleted_at is null
    and (household_id is null or public.is_household_member(household_id))
  );

create policy categories_insert on public.categories
  for insert to authenticated
  with check (household_id is not null and public.is_household_writer(household_id));

create policy categories_update on public.categories
  for update to authenticated
  using (household_id is not null and public.is_household_writer(household_id))
  with check (household_id is not null and public.is_household_writer(household_id));

create policy categories_no_delete on public.categories
  for delete to authenticated
  using (false);

-- 3.8 category_rules — global lesbar; haushaltsspezifisch nur fuer Mitglieder.
create policy category_rules_select on public.category_rules
  for select to authenticated
  using (
    deleted_at is null
    and (household_id is null or public.is_household_member(household_id))
  );

create policy category_rules_insert on public.category_rules
  for insert to authenticated
  with check (household_id is not null and public.is_household_writer(household_id));

create policy category_rules_update on public.category_rules
  for update to authenticated
  using (household_id is not null and public.is_household_writer(household_id))
  with check (household_id is not null and public.is_household_writer(household_id));

create policy category_rules_no_delete on public.category_rules
  for delete to authenticated
  using (false);

-- 3.9 recipes — Lesen: Mitglieder; Schreiben: Owner/Editor.
create policy recipes_select on public.recipes
  for select to authenticated
  using (deleted_at is null and public.is_household_member(household_id));

create policy recipes_insert on public.recipes
  for insert to authenticated
  with check (public.is_household_writer(household_id));

create policy recipes_update on public.recipes
  for update to authenticated
  using (public.is_household_writer(household_id))
  with check (public.is_household_writer(household_id));

create policy recipes_no_delete on public.recipes
  for delete to authenticated
  using (false);

-- 3.10 recipe_ingredients — Lesen: Mitglieder des Rezepts; Schreiben: Owner/Editor.
create policy recipe_ingredients_select on public.recipe_ingredients
  for select to authenticated
  using (deleted_at is null and public.is_recipe_member(recipe_id));

create policy recipe_ingredients_insert on public.recipe_ingredients
  for insert to authenticated
  with check (public.is_recipe_writer(recipe_id));

create policy recipe_ingredients_update on public.recipe_ingredients
  for update to authenticated
  using (public.is_recipe_writer(recipe_id))
  with check (public.is_recipe_writer(recipe_id));

create policy recipe_ingredients_no_delete on public.recipe_ingredients
  for delete to authenticated
  using (false);

-- -----------------------------------------------------------------------------
-- 4. Tabellen-Grants (RLS filtert Zeilen; Grants erlauben den Zugriff)
--    In Supabase existieren anon/authenticated bereits.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on all tables in schema public to anon, authenticated;
grant insert, update on all tables in schema public to authenticated;
