-- =============================================================================
-- Einkaufszettel — Migration 001: Kern-Datenmodell
-- Quelle: PLAN.md §4.1 (Datenmodell), §4.3 (Einheiten-Taxonomie), §4.5 (Sicherheit)
-- =============================================================================
-- Konventionen:
--   * Alle IDs sind clientseitig erzeugte UUIDv7. Es gibt KEINEN DB-Default fuer
--     id-Spalten; die Anwendung liefert die UUID beim Insert mit.
--   * Jede Tabelle hat created_at, updated_at und deleted_at (Soft-Delete).
--     Physisches DELETE ist per Trigger gesperrt (Ausnahme: profiles, weil
--     auth.users-Loeschung kaskadiert).
--   * updated_at wird per Trigger bei jedem UPDATE gesetzt.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums (PLAN.md §4.1 / §4.3)
-- -----------------------------------------------------------------------------
create type public.household_role as enum ('owner', 'editor', 'viewer');

-- Einheiten-Taxonomie aus PLAN.md §4.3. Werte bewusst exakt uebernommen.
create type public.unit_enum as enum (
  'g', 'kg', 'ml', 'l', 'TL', 'EL', 'Stk', 'Bund',
  'Dose', 'Packung', 'Zehe', 'Prise', 'n. B.'
);

-- -----------------------------------------------------------------------------
-- 2. Hilfsfunktionen
-- -----------------------------------------------------------------------------
-- Setzt updated_at bei jedem UPDATE. Wird von Triggern aller Tabellen genutzt.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Sperrt physisches DELETE. Loeschen erfolgt ausschliesslich ueber deleted_at.
create or replace function public.prevent_physical_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Physisches DELETE ist auf %.% nicht erlaubt. Soft-Delete ueber deleted_at verwenden.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    using errcode = 'check_violation';
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Tabellen (PLAN.md §4.1)
-- -----------------------------------------------------------------------------

-- 3.1 profiles — 1:1 zu auth.users. Die ID ist die Auth-User-ID (deshalb kein
--     UUIDv7-Check: GoTrue vergibt eigene UUIDs).
create table public.profiles (
  id           uuid        primary key references auth.users (id) on delete cascade,
  display_name text        not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on table public.profiles is 'Nutzerprofil, 1:1 zu auth.users.';

-- 3.2 households — Haushalt mit genau einem Owner.
create table public.households (
  id         uuid        primary key check (substring(id::text from 15 for 1) = '7'),
  name       text        not null check (length(trim(name)) > 0),
  owner_id   uuid        not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index households_owner_id_idx on public.households (owner_id);

-- 3.3 household_members — Rollen pro Haushalt. Surrogat-ID, weil ein
--     (household_id, user_id)-Paar nach Soft-Delete erneut eingeladen werden darf.
create table public.household_members (
  id           uuid        primary key check (substring(id::text from 15 for 1) = '7'),
  household_id uuid        not null references public.households (id),
  user_id      uuid        not null references public.profiles (id),
  role         public.household_role not null default 'viewer',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create unique index household_members_unique_active
  on public.household_members (household_id, user_id)
  where deleted_at is null;
create index household_members_user_active_idx
  on public.household_members (user_id)
  where deleted_at is null;
create index household_members_household_active_idx
  on public.household_members (household_id)
  where deleted_at is null;

-- 3.4 categories — global (household_id IS NULL) oder haushaltsspezifisch.
create table public.categories (
  id           uuid        primary key check (substring(id::text from 15 for 1) = '7'),
  household_id uuid        references public.households (id),
  key          text        not null check (length(trim(key)) > 0),
  label        text        not null check (length(trim(label)) > 0),
  sort_order   integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create unique index categories_global_key_unique
  on public.categories (key)
  where household_id is null and deleted_at is null;
create unique index categories_household_key_unique
  on public.categories (household_id, key)
  where household_id is not null and deleted_at is null;
create index categories_household_idx
  on public.categories (household_id)
  where deleted_at is null;

-- 3.5 invites — Token wird ausschliesslich als Hash gespeichert.
create table public.invites (
  id           uuid        primary key check (substring(id::text from 15 for 1) = '7'),
  household_id uuid        not null references public.households (id),
  token_hash   text        not null check (length(token_hash) >= 32),
  role         public.household_role not null default 'viewer',
  expires_at   timestamptz not null default (now() + interval '7 days'),
  max_uses     integer     not null default 1 check (max_uses > 0),
  used_count   integer     not null default 0 check (used_count >= 0 and used_count <= max_uses),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create unique index invites_token_hash_unique
  on public.invites (token_hash)
  where deleted_at is null;
create index invites_household_active_idx
  on public.invites (household_id)
  where deleted_at is null;

-- 3.6 lists — Einkaufslisten eines Haushalts.
create table public.lists (
  id           uuid        primary key check (substring(id::text from 15 for 1) = '7'),
  household_id uuid        not null references public.households (id),
  name         text        not null check (length(trim(name)) > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index lists_household_active_idx
  on public.lists (household_id)
  where deleted_at is null;

-- 3.7 recipes — Rezepte eines Haushalts (im MVP nur migriert, nicht bebaut).
create table public.recipes (
  id            uuid        primary key check (substring(id::text from 15 for 1) = '7'),
  household_id  uuid        not null references public.households (id),
  title         text        not null check (length(trim(title)) > 0),
  base_servings numeric     check (base_servings is null or base_servings > 0),
  tags          text[]      not null default '{}',
  instructions  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index recipes_household_active_idx
  on public.recipes (household_id)
  where deleted_at is null;

-- 3.8 recipe_ingredients — Zutaten eines Rezepts.
create table public.recipe_ingredients (
  id         uuid        primary key check (substring(id::text from 15 for 1) = '7'),
  recipe_id  uuid        not null references public.recipes (id),
  name       text        not null check (length(trim(name)) > 0),
  quantity   numeric     check (quantity is null or quantity > 0),
  unit       public.unit_enum,
  sort_order integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index recipe_ingredients_recipe_active_idx
  on public.recipe_ingredients (recipe_id)
  where deleted_at is null;

-- 3.9 category_rules — regelbasierte Auto-Kategorisierung. Global oder pro Haushalt.
create table public.category_rules (
  id           uuid        primary key check (substring(id::text from 15 for 1) = '7'),
  household_id uuid        references public.households (id),
  keyword      text        not null check (length(trim(keyword)) > 0),
  category_id  uuid        not null references public.categories (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create unique index category_rules_global_keyword_unique
  on public.category_rules (keyword)
  where household_id is null and deleted_at is null;
create unique index category_rules_household_keyword_unique
  on public.category_rules (household_id, keyword)
  where household_id is not null and deleted_at is null;
create index category_rules_category_idx on public.category_rules (category_id);

-- 3.10 list_items — Artikel einer Liste.
create table public.list_items (
  id               uuid        primary key check (substring(id::text from 15 for 1) = '7'),
  list_id          uuid        not null references public.lists (id),
  name             text        not null check (length(trim(name)) > 0),
  name_normalized  text        not null check (length(trim(name_normalized)) > 0),
  quantity         numeric     check (quantity is null or quantity > 0),
  unit             public.unit_enum,
  category_id      uuid        references public.categories (id),
  checked          boolean     not null default false,
  checked_by       uuid        references public.profiles (id),
  source_recipe_id uuid        references public.recipes (id),
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index list_items_list_active_idx
  on public.list_items (list_id)
  where deleted_at is null;
create index list_items_category_idx on public.list_items (category_id);
create index list_items_list_name_norm_active_idx
  on public.list_items (list_id, name_normalized)
  where deleted_at is null;

-- -----------------------------------------------------------------------------
-- 4. updated_at-Trigger fuer alle Tabellen
-- -----------------------------------------------------------------------------
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger households_set_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

create trigger household_members_set_updated_at
  before update on public.household_members
  for each row execute function public.set_updated_at();

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create trigger invites_set_updated_at
  before update on public.invites
  for each row execute function public.set_updated_at();

create trigger lists_set_updated_at
  before update on public.lists
  for each row execute function public.set_updated_at();

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

create trigger recipe_ingredients_set_updated_at
  before update on public.recipe_ingredients
  for each row execute function public.set_updated_at();

create trigger category_rules_set_updated_at
  before update on public.category_rules
  for each row execute function public.set_updated_at();

create trigger list_items_set_updated_at
  before update on public.list_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Physisches DELETE sperren (Soft-Delete erzwungen).
--    profiles ausgenommen: Loeschung eines auth.users muss kaskadieren koennen.
-- -----------------------------------------------------------------------------
create trigger households_prevent_delete
  before delete on public.households
  for each row execute function public.prevent_physical_delete();

create trigger household_members_prevent_delete
  before delete on public.household_members
  for each row execute function public.prevent_physical_delete();

create trigger categories_prevent_delete
  before delete on public.categories
  for each row execute function public.prevent_physical_delete();

create trigger invites_prevent_delete
  before delete on public.invites
  for each row execute function public.prevent_physical_delete();

create trigger lists_prevent_delete
  before delete on public.lists
  for each row execute function public.prevent_physical_delete();

create trigger recipes_prevent_delete
  before delete on public.recipes
  for each row execute function public.prevent_physical_delete();

create trigger recipe_ingredients_prevent_delete
  before delete on public.recipe_ingredients
  for each row execute function public.prevent_physical_delete();

create trigger category_rules_prevent_delete
  before delete on public.category_rules
  for each row execute function public.prevent_physical_delete();

create trigger list_items_prevent_delete
  before delete on public.list_items
  for each row execute function public.prevent_physical_delete();
