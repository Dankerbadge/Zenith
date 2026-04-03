-- Region-optimized food search hardening:
-- - canonical food item index
-- - profile-level food region/language
-- - deterministic cache dimensions for region/query/cursor/limit

create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists pgcrypto;
alter table public.profiles
  add column if not exists food_region text,
  add column if not exists food_language text;
update public.profiles
set
  food_region = coalesce(nullif(food_region, ''), 'US'),
  food_language = coalesce(nullif(food_language, ''), 'en')
where food_region is null
   or food_region = ''
   or food_language is null
   or food_language = '';
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_food_region_iso2_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_food_region_iso2_check
      check (food_region ~ '^[A-Z]{2}$');
  end if;
end
$$;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_food_language_basic_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_food_language_basic_check
      check (food_language ~ '^[a-z]{2,8}(-[a-z0-9]{2,8})*$');
  end if;
end
$$;
create table if not exists public.food_items (
  id text primary key,
  region text not null,
  language text not null,
  source text not null,
  name text not null,
  brand text,
  barcode text,
  kcal_100g numeric,
  protein_g_100g numeric,
  carbs_g_100g numeric,
  fat_g_100g numeric,
  serving_summary jsonb not null default '{}'::jsonb,
  name_normalized text not null,
  search_vector tsvector not null default ''::tsvector,
  popularity_region_score numeric not null default 0,
  updated_at timestamptz not null default now()
);
create or replace function public.set_food_items_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('simple', unaccent(coalesce(new.name, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(new.brand, ''))), 'B');
  return new;
end;
$$;
drop trigger if exists food_items_set_search_vector on public.food_items;
create trigger food_items_set_search_vector
before insert or update of name, brand
on public.food_items
for each row
execute function public.set_food_items_search_vector();
update public.food_items
set search_vector =
  setweight(to_tsvector('simple', unaccent(coalesce(name, ''))), 'A') ||
  setweight(to_tsvector('simple', unaccent(coalesce(brand, ''))), 'B')
where search_vector = ''::tsvector;
create index if not exists food_items_region_name_idx
  on public.food_items (region, name_normalized);
create index if not exists food_items_region_popularity_idx
  on public.food_items (region, popularity_region_score desc, updated_at desc);
create index if not exists food_items_search_vector_idx
  on public.food_items using gin (search_vector);
create index if not exists food_items_name_trgm_idx
  on public.food_items using gin (name_normalized gin_trgm_ops);
create index if not exists food_items_barcode_idx
  on public.food_items (barcode);
alter table public.food_search_cache
  add column if not exists region text,
  add column if not exists normalized_query text,
  add column if not exists cursor text,
  add column if not exists "limit" integer,
  add column if not exists result_ids text[];
update public.food_search_cache
set
  region = coalesce(nullif(region, ''), country),
  normalized_query = coalesce(nullif(normalized_query, ''), lower(trim(query))),
  cursor = coalesce(cursor, ''),
  "limit" = coalesce("limit", 40)
where region is null
   or normalized_query is null
   or cursor is null
   or "limit" is null;
create index if not exists food_search_cache_region_query_cursor_limit_idx
  on public.food_search_cache (region, language, normalized_query, cursor, "limit");
create table if not exists public.user_food_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  food_item_id text not null references public.food_items(id) on delete cascade,
  region text not null,
  last_used_at timestamptz not null default now(),
  use_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, food_item_id, region)
);
create index if not exists user_food_events_region_use_count_idx
  on public.user_food_events (user_id, region, use_count desc, last_used_at desc);
create or replace function public.search_food(
  p_region text,
  p_language text,
  p_query text,
  p_limit integer default 40,
  p_cursor integer default 0,
  p_include_global boolean default false
)
returns table (
  id text,
  name text,
  brand text,
  barcode text,
  kcal_100g numeric,
  protein_g_100g numeric,
  carbs_g_100g numeric,
  fat_g_100g numeric,
  serving_summary jsonb,
  source text,
  region text,
  language text
)
language sql
stable
as $$
  with q as (
    select lower(trim(unaccent(coalesce(p_query, '')))) as nq
  ),
  filtered as (
    select fi.*
    from public.food_items fi, q
    where (
      (p_include_global and fi.region in (upper(p_region), 'GLOBAL'))
      or (not p_include_global and fi.region = upper(p_region))
    )
      and (fi.language = lower(p_language) or fi.language = 'en')
      and (
        fi.name_normalized = q.nq
        or fi.name_normalized like q.nq || '%'
        or fi.name_normalized like '%' || q.nq || '%'
      )
  )
  select
    filtered.id,
    filtered.name,
    filtered.brand,
    filtered.barcode,
    filtered.kcal_100g,
    filtered.protein_g_100g,
    filtered.carbs_g_100g,
    filtered.fat_g_100g,
    filtered.serving_summary,
    filtered.source,
    filtered.region,
    filtered.language
  from filtered, q
  order by
    case when filtered.name_normalized = q.nq then 0
         when filtered.name_normalized like q.nq || '%' then 1
         else 2 end,
    ts_rank_cd(filtered.search_vector, plainto_tsquery('simple', q.nq)) desc,
    similarity(filtered.name_normalized, q.nq) desc,
    filtered.popularity_region_score desc,
    filtered.updated_at desc,
    filtered.id asc
  offset greatest(0, p_cursor)
  limit greatest(1, least(coalesce(p_limit, 40), 80));
$$;
