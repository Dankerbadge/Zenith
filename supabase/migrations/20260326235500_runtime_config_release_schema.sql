-- Runtime compatibility release schema for Phase 30/31 gating.
-- Supports app/pack/sync protocol negotiation in runtime-config edge function.

create extension if not exists pgcrypto;

create table if not exists public.food_v2_release_manifest (
  release_id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('ios', 'android', 'web')),
  release_channel text not null default 'production' check (release_channel in ('production', 'staging', 'internal')),
  min_supported_app_version text not null,
  latest_recommended_app_version text not null,
  min_pack_schema_version integer not null default 1,
  max_pack_schema_version integer not null default 3,
  min_sync_protocol_version integer not null default 1,
  max_sync_protocol_version integer not null default 2,
  capabilities jsonb not null default '{}'::jsonb,
  degraded_mode jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, release_channel)
);

create index if not exists idx_food_v2_release_manifest_platform_channel
  on public.food_v2_release_manifest (platform, release_channel, updated_at desc);

alter table public.food_v2_release_manifest enable row level security;

drop policy if exists "food_v2_release_manifest_read_authenticated" on public.food_v2_release_manifest;
create policy "food_v2_release_manifest_read_authenticated"
  on public.food_v2_release_manifest for select
  to authenticated
  using (enabled = true);

drop policy if exists "food_v2_release_manifest_no_client_write" on public.food_v2_release_manifest;
create policy "food_v2_release_manifest_no_client_write"
  on public.food_v2_release_manifest for all
  to authenticated
  using (false)
  with check (false);

create table if not exists public.food_v2_runtime_compat_events (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  platform text not null,
  app_version text not null,
  requested_pack_schema_version integer null,
  requested_sync_protocol_version integer null,
  negotiated_pack_schema_version integer null,
  negotiated_sync_protocol_version integer null,
  compatibility_status text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_food_v2_runtime_compat_events_created
  on public.food_v2_runtime_compat_events (created_at desc);

alter table public.food_v2_runtime_compat_events enable row level security;

drop policy if exists "food_v2_runtime_compat_events_read_own" on public.food_v2_runtime_compat_events;
create policy "food_v2_runtime_compat_events_read_own"
  on public.food_v2_runtime_compat_events for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "food_v2_runtime_compat_events_no_client_write" on public.food_v2_runtime_compat_events;
create policy "food_v2_runtime_compat_events_no_client_write"
  on public.food_v2_runtime_compat_events for all
  to authenticated
  using (false)
  with check (false);

insert into public.food_v2_release_manifest (
  platform,
  release_channel,
  min_supported_app_version,
  latest_recommended_app_version,
  min_pack_schema_version,
  max_pack_schema_version,
  min_sync_protocol_version,
  max_sync_protocol_version,
  capabilities,
  degraded_mode,
  enabled
)
values
  (
    'ios',
    'production',
    '3.8.0',
    '9.9.9',
    2,
    3,
    1,
    2,
    '{"offlinePacks":true,"restaurantProvider":true,"privacyHardening":true}'::jsonb,
    '{"allowReadOnly":true,"disableWritesWhenOutdated":true}'::jsonb,
    true
  ),
  (
    'android',
    'production',
    '3.8.0',
    '9.9.9',
    2,
    3,
    1,
    2,
    '{"offlinePacks":true,"restaurantProvider":true,"privacyHardening":true}'::jsonb,
    '{"allowReadOnly":true,"disableWritesWhenOutdated":true}'::jsonb,
    true
  ),
  (
    'web',
    'production',
    '3.8.0',
    '9.9.9',
    2,
    3,
    1,
    2,
    '{"offlinePacks":false,"restaurantProvider":true,"privacyHardening":true}'::jsonb,
    '{"allowReadOnly":true,"disableWritesWhenOutdated":true}'::jsonb,
    true
  )
on conflict (platform, release_channel) do update set
  min_supported_app_version = excluded.min_supported_app_version,
  latest_recommended_app_version = excluded.latest_recommended_app_version,
  min_pack_schema_version = excluded.min_pack_schema_version,
  max_pack_schema_version = excluded.max_pack_schema_version,
  min_sync_protocol_version = excluded.min_sync_protocol_version,
  max_sync_protocol_version = excluded.max_sync_protocol_version,
  capabilities = excluded.capabilities,
  degraded_mode = excluded.degraded_mode,
  enabled = excluded.enabled,
  updated_at = now();
