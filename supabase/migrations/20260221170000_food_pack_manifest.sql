-- Region pack manifest for on-device foodpack distribution.

create table if not exists public.food_pack_manifests (
  id bigserial primary key,
  region text not null,
  language text not null,
  pack_version text not null,
  sha256 text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  min_app_version text,
  url text not null,
  delta_from_version text,
  delta_url text,
  status text not null default 'ACTIVE',
  metadata jsonb not null default '{}'::jsonb,
  unique (region, language, pack_version)
);
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'food_pack_manifests_region_iso2_check'
      and conrelid = 'public.food_pack_manifests'::regclass
  ) then
    alter table public.food_pack_manifests
      add constraint food_pack_manifests_region_iso2_check
      check (region ~ '^[A-Z]{2}$' or region = 'GLOBAL');
  end if;
end
$$;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'food_pack_manifests_language_check'
      and conrelid = 'public.food_pack_manifests'::regclass
  ) then
    alter table public.food_pack_manifests
      add constraint food_pack_manifests_language_check
      check (language ~ '^[a-z]{2,8}(-[a-z0-9]{2,8})*$');
  end if;
end
$$;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'food_pack_manifests_status_check'
      and conrelid = 'public.food_pack_manifests'::regclass
  ) then
    alter table public.food_pack_manifests
      add constraint food_pack_manifests_status_check
      check (status in ('ACTIVE', 'DEPRECATED', 'DISABLED'));
  end if;
end
$$;
create index if not exists food_pack_manifests_region_lang_status_idx
  on public.food_pack_manifests (region, language, status, created_at desc);
alter table public.food_pack_manifests enable row level security;
revoke all on table public.food_pack_manifests from anon;
revoke all on table public.food_pack_manifests from authenticated;
create or replace function public.get_latest_food_pack_manifest(
  p_region text,
  p_language text
)
returns table (
  region text,
  language text,
  pack_version text,
  sha256 text,
  size_bytes bigint,
  created_at timestamptz,
  min_app_version text,
  url text,
  delta_from_version text,
  delta_url text,
  metadata jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    fpm.region,
    fpm.language,
    fpm.pack_version,
    fpm.sha256,
    fpm.size_bytes,
    fpm.created_at,
    fpm.min_app_version,
    fpm.url,
    fpm.delta_from_version,
    fpm.delta_url,
    fpm.metadata
  from public.food_pack_manifests fpm
  where fpm.status = 'ACTIVE'
    and (fpm.region = upper(coalesce(p_region, 'US')) or fpm.region = 'GLOBAL')
    and (fpm.language = lower(coalesce(p_language, 'en')) or fpm.language = 'en')
  order by
    case when fpm.region = upper(coalesce(p_region, 'US')) then 0 else 1 end,
    case when fpm.language = lower(coalesce(p_language, 'en')) then 0 else 1 end,
    fpm.created_at desc,
    fpm.id desc
  limit 1;
$$;
revoke all on function public.get_latest_food_pack_manifest(text, text) from public;
grant execute on function public.get_latest_food_pack_manifest(text, text) to authenticated;
grant execute on function public.get_latest_food_pack_manifest(text, text) to service_role;
insert into public.food_pack_manifests (
  region,
  language,
  pack_version,
  sha256,
  size_bytes,
  created_at,
  min_app_version,
  url,
  delta_from_version,
  delta_url,
  status,
  metadata
)
values (
  'US',
  'en',
  'seed-us-v1',
  'seed-local',
  10240,
  now(),
  null,
  'https://cdn.zenith.app/foodpacks/us/seed-us-v1.sqlite',
  null,
  null,
  'ACTIVE',
  '{"source":"seed"}'::jsonb
)
on conflict (region, language, pack_version) do nothing;
