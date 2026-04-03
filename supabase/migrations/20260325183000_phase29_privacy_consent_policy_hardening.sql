-- Phase 29: Privacy, Consent, and Policy Hardening
-- Privacy-first controls for retention windows, consent gating, public share controls,
-- user-visible data explanations, and auditable privacy-sensitive actions.

create extension if not exists pgcrypto;

create table if not exists public.food_v2_retention_policies (
  category text primary key,
  retention_days int not null check (retention_days >= 0),
  purge_action text not null check (purge_action in ('delete', 'archive')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.food_v2_user_consent (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  notifications boolean not null default false,
  analytics boolean not null default false,
  public_sharing boolean not null default false,
  consent_updated_at timestamptz not null default now(),
  notes text null
);

create table if not exists public.food_v2_public_shares (
  share_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  object_type text not null check (object_type in ('recipe', 'meal_template', 'collection')),
  object_id text not null,
  share_status text not null check (share_status in ('active', 'revoked', 'pending')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  provenance jsonb not null default '{}'::jsonb,
  unique (user_id, object_type, object_id)
);

create index if not exists idx_food_v2_public_shares_user_status
  on public.food_v2_public_shares (user_id, share_status, created_at desc);

create table if not exists public.food_v2_user_data_explanation (
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  description text not null,
  retention_days int not null check (retention_days >= 0),
  last_purged_at timestamptz null,
  notes jsonb null,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

create index if not exists idx_food_v2_user_data_explanation_user_updated
  on public.food_v2_user_data_explanation (user_id, updated_at desc);

create table if not exists public.food_v2_privacy_audit_events (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid null references public.profiles(id) on delete set null,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_food_v2_privacy_audit_events_user_created
  on public.food_v2_privacy_audit_events (user_id, created_at desc);

create index if not exists idx_food_v2_privacy_audit_events_action_created
  on public.food_v2_privacy_audit_events (action_type, created_at desc);

alter table public.food_v2_retention_policies enable row level security;
alter table public.food_v2_user_consent enable row level security;
alter table public.food_v2_public_shares enable row level security;
alter table public.food_v2_user_data_explanation enable row level security;
alter table public.food_v2_privacy_audit_events enable row level security;

do $$ begin
  create policy "food_v2_retention_policies_select_enabled"
    on public.food_v2_retention_policies
    for select
    to authenticated
    using (enabled = true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_user_consent_select_own"
    on public.food_v2_user_consent
    for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_user_consent_insert_own"
    on public.food_v2_user_consent
    for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_user_consent_update_own"
    on public.food_v2_user_consent
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_public_shares_select_own"
    on public.food_v2_public_shares
    for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_public_shares_insert_own"
    on public.food_v2_public_shares
    for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_public_shares_update_own"
    on public.food_v2_public_shares
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_public_shares_delete_own"
    on public.food_v2_public_shares
    for delete
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_user_data_explanation_select_own"
    on public.food_v2_user_data_explanation
    for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_user_data_explanation_insert_own"
    on public.food_v2_user_data_explanation
    for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_user_data_explanation_update_own"
    on public.food_v2_user_data_explanation
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_user_data_explanation_delete_own"
    on public.food_v2_user_data_explanation
    for delete
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_privacy_audit_events_select_own"
    on public.food_v2_privacy_audit_events
    for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_privacy_audit_events_insert_own"
    on public.food_v2_privacy_audit_events
    for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

create or replace function public.food_v2_append_privacy_audit_event(
  p_user_id uuid,
  p_action_type text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  insert into public.food_v2_privacy_audit_events (user_id, action_type, payload)
  values (p_user_id, coalesce(nullif(trim(p_action_type), ''), 'unknown'), coalesce(p_payload, '{}'::jsonb))
  returning event_id into v_event_id;
  return v_event_id;
end;
$$;

revoke all on function public.food_v2_append_privacy_audit_event(uuid, text, jsonb) from public;
grant execute on function public.food_v2_append_privacy_audit_event(uuid, text, jsonb) to authenticated, service_role;

create or replace function public.food_v2_enforce_retention_policies(
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_total bigint := 0;
  v_results jsonb := '{}'::jsonb;
  v_cutoff timestamptz;
  v_count bigint;
  v_table regclass;
  rec record;

  function_count_sql text;
  function_delete_sql text;
begin
  for rec in
    select category, retention_days, purge_action
    from public.food_v2_retention_policies
    where enabled = true
    order by category
  loop
    v_cutoff := v_now - make_interval(days => greatest(rec.retention_days, 0));
    v_count := 0;

    if rec.category = 'logs' then
      v_table := to_regclass('public.food_v2_log_entries');
      if v_table is not null then
        function_count_sql := 'select count(*) from public.food_v2_log_entries where logged_at < $1';
        function_delete_sql := 'delete from public.food_v2_log_entries where logged_at < $1';
        execute function_count_sql into v_count using v_cutoff;
        if not p_dry_run and rec.purge_action = 'delete' then
          execute function_delete_sql using v_cutoff;
        end if;
      elsif to_regclass('public.nutrition_daily') is not null then
        function_count_sql := 'select count(*) from public.nutrition_daily where day < ($1 at time zone ''utc'')::date';
        function_delete_sql := 'delete from public.nutrition_daily where day < ($1 at time zone ''utc'')::date';
        execute function_count_sql into v_count using v_cutoff;
        if not p_dry_run and rec.purge_action = 'delete' then
          execute function_delete_sql using v_cutoff;
        end if;
      end if;
    elsif rec.category = 'recipes' and to_regclass('public.food_v2_recipes') is not null then
      function_count_sql := 'select count(*) from public.food_v2_recipes where updated_at < $1';
      function_delete_sql := 'delete from public.food_v2_recipes where updated_at < $1';
      execute function_count_sql into v_count using v_cutoff;
      if not p_dry_run and rec.purge_action = 'delete' then
        execute function_delete_sql using v_cutoff;
      end if;
    elsif rec.category = 'meal_templates' and to_regclass('public.food_v2_meal_templates') is not null then
      function_count_sql := 'select count(*) from public.food_v2_meal_templates where updated_at < $1';
      function_delete_sql := 'delete from public.food_v2_meal_templates where updated_at < $1';
      execute function_count_sql into v_count using v_cutoff;
      if not p_dry_run and rec.purge_action = 'delete' then
        execute function_delete_sql using v_cutoff;
      end if;
    elsif rec.category = 'goal_snapshots' and to_regclass('public.food_v2_daily_goal_snapshots') is not null then
      function_count_sql := 'select count(*) from public.food_v2_daily_goal_snapshots where snapshot_date < ($1 at time zone ''utc'')::date';
      function_delete_sql := 'delete from public.food_v2_daily_goal_snapshots where snapshot_date < ($1 at time zone ''utc'')::date';
      execute function_count_sql into v_count using v_cutoff;
      if not p_dry_run and rec.purge_action = 'delete' then
        execute function_delete_sql using v_cutoff;
      end if;
    elsif rec.category = 'offline_packs' and to_regclass('public.food_v2_offline_pack_installs') is not null then
      function_count_sql := 'select count(*) from public.food_v2_offline_pack_installs where installed_at < $1';
      function_delete_sql := 'delete from public.food_v2_offline_pack_installs where installed_at < $1';
      execute function_count_sql into v_count using v_cutoff;
      if not p_dry_run and rec.purge_action = 'delete' then
        execute function_delete_sql using v_cutoff;
      end if;
    elsif rec.category = 'user_preferences' then
      if to_regclass('public.food_v2_user_onboarding_events') is not null then
        function_count_sql := 'select count(*) from public.food_v2_user_onboarding_events where created_at < $1';
        function_delete_sql := 'delete from public.food_v2_user_onboarding_events where created_at < $1';
        execute function_count_sql into v_count using v_cutoff;
        if not p_dry_run and rec.purge_action = 'delete' then
          execute function_delete_sql using v_cutoff;
        end if;
      elsif to_regclass('public.user_state_snapshots') is not null then
        function_count_sql := 'select count(*) from public.user_state_snapshots where updated_at < $1';
        function_delete_sql := 'delete from public.user_state_snapshots where updated_at < $1';
        execute function_count_sql into v_count using v_cutoff;
        if not p_dry_run and rec.purge_action = 'delete' then
          execute function_delete_sql using v_cutoff;
        end if;
      end if;
    end if;

    v_total := v_total + coalesce(v_count, 0);
    v_results := v_results || jsonb_build_object(
      rec.category,
      jsonb_build_object(
        'retentionDays', rec.retention_days,
        'action', rec.purge_action,
        'dryRun', p_dry_run,
        'affected', coalesce(v_count, 0),
        'cutoff', v_cutoff
      )
    );

    if not p_dry_run and coalesce(v_count, 0) > 0 then
      update public.food_v2_user_data_explanation
      set last_purged_at = v_now, updated_at = v_now
      where category = rec.category;
    end if;
  end loop;

  perform public.food_v2_append_privacy_audit_event(
    null,
    case when p_dry_run then 'retention_dry_run' else 'retention_enforced' end,
    jsonb_build_object('at', v_now, 'totalAffected', v_total, 'results', v_results)
  );

  return jsonb_build_object(
    'ok', true,
    'dryRun', p_dry_run,
    'totalAffected', v_total,
    'results', v_results,
    'executedAt', v_now
  );
end;
$$;

revoke all on function public.food_v2_enforce_retention_policies(boolean) from public;
grant execute on function public.food_v2_enforce_retention_policies(boolean) to service_role;

insert into public.food_v2_retention_policies (category, retention_days, purge_action, enabled)
values
  ('logs', 3650, 'delete', true),
  ('recipes', 3650, 'archive', true),
  ('meal_templates', 3650, 'archive', true),
  ('goal_snapshots', 730, 'delete', true),
  ('offline_packs', 30, 'delete', true),
  ('user_preferences', 3650, 'archive', true)
on conflict (category) do update
set
  retention_days = excluded.retention_days,
  purge_action = excluded.purge_action,
  enabled = excluded.enabled,
  updated_at = now();
