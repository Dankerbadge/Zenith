begin;

create table if not exists public.food_v2_daily_goal_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  timezone text not null default 'UTC',
  goal_profile_id uuid not null,
  targets jsonb not null default '{}'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists food_v2_daily_goal_snapshots_user_day_goal_idx
  on public.food_v2_daily_goal_snapshots (user_id, snapshot_date, goal_profile_id);

create index if not exists food_v2_daily_goal_snapshots_user_date_idx
  on public.food_v2_daily_goal_snapshots (user_id, snapshot_date desc);

alter table public.food_v2_daily_goal_snapshots enable row level security;

grant select, insert, update, delete on public.food_v2_daily_goal_snapshots to authenticated;
grant all on public.food_v2_daily_goal_snapshots to service_role;

do $$ begin
  create policy "food_v2_daily_goal_snapshots_select_own"
    on public.food_v2_daily_goal_snapshots
    for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_daily_goal_snapshots_insert_own"
    on public.food_v2_daily_goal_snapshots
    for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_daily_goal_snapshots_update_own"
    on public.food_v2_daily_goal_snapshots
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_daily_goal_snapshots_delete_own"
    on public.food_v2_daily_goal_snapshots
    for delete
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

create table if not exists public.food_v2_user_usual_foods (
  usual_food_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  context_key text not null,
  provider_id text not null,
  source_food_id text not null,
  template_id text,
  score numeric(6, 5) not null default 0,
  use_count integer not null default 0,
  last_used_at timestamptz,
  default_serving_id text,
  default_quantity numeric(10, 4) not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists food_v2_user_usual_foods_identity_idx
  on public.food_v2_user_usual_foods (user_id, context_key, provider_id, source_food_id, template_id);

create index if not exists food_v2_user_usual_foods_user_score_idx
  on public.food_v2_user_usual_foods (user_id, score desc, updated_at desc);

alter table public.food_v2_user_usual_foods enable row level security;

grant select, insert, update, delete on public.food_v2_user_usual_foods to authenticated;
grant all on public.food_v2_user_usual_foods to service_role;

do $$ begin
  create policy "food_v2_user_usual_foods_select_own"
    on public.food_v2_user_usual_foods
    for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_user_usual_foods_insert_own"
    on public.food_v2_user_usual_foods
    for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_user_usual_foods_update_own"
    on public.food_v2_user_usual_foods
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "food_v2_user_usual_foods_delete_own"
    on public.food_v2_user_usual_foods
    for delete
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

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
      if to_regclass('public.food_v2_log_entries') is not null then
        function_count_sql := 'select count(*) from public.food_v2_log_entries where logged_at < $1';
        function_delete_sql := 'delete from public.food_v2_log_entries where logged_at < $1';
        execute function_count_sql into v_count using v_cutoff;
        if not p_dry_run and rec.purge_action = 'delete' then
          execute function_delete_sql using v_cutoff;
        end if;
      end if;

      if to_regclass('public.nutrition_daily') is not null then
        declare
          v_legacy_count bigint := 0;
        begin
          function_count_sql := 'select count(*) from public.nutrition_daily where day < ($1 at time zone ''utc'')::date';
          function_delete_sql := 'delete from public.nutrition_daily where day < ($1 at time zone ''utc'')::date';
          execute function_count_sql into v_legacy_count using v_cutoff;
          if not p_dry_run and rec.purge_action = 'delete' then
            execute function_delete_sql using v_cutoff;
          end if;
          v_count := coalesce(v_count, 0) + coalesce(v_legacy_count, 0);
        end;
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

commit;
