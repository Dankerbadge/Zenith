-- Backend operations automation (P0): rate limiting, maintenance jobs, and alerting.

create table if not exists public.food_search_rate_limit_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  window_seconds integer not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, window_seconds, window_start)
);
create index if not exists food_search_rate_limit_state_updated_idx on public.food_search_rate_limit_state (updated_at desc);
alter table public.food_search_rate_limit_state enable row level security;
revoke all on table public.food_search_rate_limit_state from anon;
revoke all on table public.food_search_rate_limit_state from authenticated;
create table if not exists public.backend_ops_alerts (
  id bigserial primary key,
  alert_key text not null,
  severity text not null,
  source text not null,
  message text not null,
  details jsonb,
  triggered_at timestamptz not null default now()
);
create index if not exists backend_ops_alerts_triggered_idx on public.backend_ops_alerts (triggered_at desc);
create index if not exists backend_ops_alerts_key_time_idx on public.backend_ops_alerts (alert_key, triggered_at desc);
alter table public.backend_ops_alerts enable row level security;
revoke all on table public.backend_ops_alerts from anon;
revoke all on table public.backend_ops_alerts from authenticated;
create table if not exists public.backend_ops_heartbeats (
  component text primary key,
  last_seen_at timestamptz not null default now(),
  meta jsonb
);
alter table public.backend_ops_heartbeats enable row level security;
revoke all on table public.backend_ops_heartbeats from anon;
revoke all on table public.backend_ops_heartbeats from authenticated;
create or replace function public.food_search_allow_request(
  p_user_id uuid,
  p_scope text default 'food_search',
  p_window_seconds integer default 60,
  p_limit integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket_start timestamptz;
  next_count integer;
begin
  if p_user_id is null then
    return false;
  end if;

  if p_window_seconds < 1 then
    p_window_seconds := 60;
  end if;

  if p_limit < 1 then
    p_limit := 60;
  end if;

  bucket_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.food_search_rate_limit_state (user_id, scope, window_seconds, window_start, request_count, updated_at)
  values (p_user_id, p_scope, p_window_seconds, bucket_start, 1, now())
  on conflict (user_id, scope, window_seconds, window_start)
  do update set
    request_count = public.food_search_rate_limit_state.request_count + 1,
    updated_at = now()
  returning request_count into next_count;

  return next_count <= p_limit;
end;
$$;
revoke all on function public.food_search_allow_request(uuid, text, integer, integer) from public;
grant execute on function public.food_search_allow_request(uuid, text, integer, integer) to service_role;
create or replace function public.purge_old_food_search_rate_limit_state()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.food_search_rate_limit_state
  where updated_at < now() - interval '2 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.purge_old_food_search_rate_limit_state() from public;
grant execute on function public.purge_old_food_search_rate_limit_state() to service_role;
create or replace function public.record_backend_ops_heartbeat(p_component text, p_meta jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_component), '') = '' then
    return;
  end if;

  insert into public.backend_ops_heartbeats (component, last_seen_at, meta)
  values (trim(p_component), now(), coalesce(p_meta, '{}'::jsonb))
  on conflict (component)
  do update set
    last_seen_at = excluded.last_seen_at,
    meta = excluded.meta;
end;
$$;
revoke all on function public.record_backend_ops_heartbeat(text, jsonb) from public;
grant execute on function public.record_backend_ops_heartbeat(text, jsonb) to service_role;
create or replace function public.insert_backend_ops_alert(
  p_alert_key text,
  p_severity text,
  p_source text,
  p_message text,
  p_details jsonb default '{}'::jsonb,
  p_dedupe_minutes integer default 60
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.backend_ops_alerts
    where alert_key = p_alert_key
      and triggered_at > now() - make_interval(mins => greatest(1, p_dedupe_minutes))
  ) then
    return;
  end if;

  insert into public.backend_ops_alerts (alert_key, severity, source, message, details)
  values (p_alert_key, p_severity, p_source, p_message, coalesce(p_details, '{}'::jsonb));
end;
$$;
revoke all on function public.insert_backend_ops_alert(text, text, text, text, jsonb, integer) from public;
grant execute on function public.insert_backend_ops_alert(text, text, text, text, jsonb, integer) to service_role;
create or replace function public.evaluate_food_search_slo_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  window_rows integer := 0;
  p95_ms numeric := 0;
  empty_rate numeric := 0;
  error_rate numeric := 0;
  backup_stale boolean := false;
  backup_last timestamptz;
begin
  with windowed as (
    select *
    from public.food_search_metrics
    where created_at > now() - interval '15 minutes'
  )
  select
    count(*)::int,
    coalesce(percentile_disc(0.95) within group (order by duration_ms), 0),
    coalesce(avg(case when result_count = 0 then 1 else 0 end), 0),
    coalesce(avg(case when source like 'error%' then 1 else 0 end), 0)
  into window_rows, p95_ms, empty_rate, error_rate
  from windowed;

  select last_seen_at into backup_last
  from public.backend_ops_heartbeats
  where component = 'logical_backup';

  backup_stale := backup_last is null or backup_last < now() - interval '8 days';

  if window_rows >= 20 and p95_ms > 1800 then
    perform public.insert_backend_ops_alert(
      'food_search_p95_high',
      'high',
      'food_search',
      'Food search p95 latency exceeded 1800ms in last 15m',
      jsonb_build_object('p95_ms', p95_ms, 'rows', window_rows),
      30
    );
  end if;

  if window_rows >= 20 and empty_rate > 0.35 then
    perform public.insert_backend_ops_alert(
      'food_search_empty_rate_high',
      'medium',
      'food_search',
      'Food search empty-result rate exceeded 35% in last 15m',
      jsonb_build_object('empty_rate', empty_rate, 'rows', window_rows),
      30
    );
  end if;

  if window_rows >= 20 and error_rate > 0.08 then
    perform public.insert_backend_ops_alert(
      'food_search_error_rate_high',
      'high',
      'food_search',
      'Food search error rate exceeded 8% in last 15m',
      jsonb_build_object('error_rate', error_rate, 'rows', window_rows),
      15
    );
  end if;

  if backup_stale then
    perform public.insert_backend_ops_alert(
      'backup_heartbeat_stale',
      'high',
      'backup',
      'No logical backup heartbeat in last 8 days',
      jsonb_build_object('last_seen_at', backup_last),
      720
    );
  end if;

  return jsonb_build_object(
    'rows', window_rows,
    'p95_ms', p95_ms,
    'empty_rate', empty_rate,
    'error_rate', error_rate,
    'backup_last_seen', backup_last,
    'backup_stale', backup_stale
  );
end;
$$;
revoke all on function public.evaluate_food_search_slo_alerts() from public;
grant execute on function public.evaluate_food_search_slo_alerts() to service_role;
create or replace function public.food_search_maintenance_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a integer := 0;
  b integer := 0;
  c integer := 0;
  alerts jsonb := '{}'::jsonb;
begin
  a := public.purge_expired_food_search_cache();
  b := public.purge_expired_food_search_prefix_cache();
  c := public.purge_old_food_search_rate_limit_state();
  alerts := public.evaluate_food_search_slo_alerts();

  perform public.record_backend_ops_heartbeat(
    'food_search_maintenance',
    jsonb_build_object('purged_cache', a, 'purged_prefix', b, 'purged_rate_limit', c)
  );

  return jsonb_build_object(
    'purged_cache', a,
    'purged_prefix', b,
    'purged_rate_limit', c,
    'alerts', alerts
  );
end;
$$;
revoke all on function public.food_search_maintenance_tick() from public;
grant execute on function public.food_search_maintenance_tick() to service_role;
-- Best-effort cron schedules (if pg_cron is available in this project).
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    null;
  end;

  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule(jobid) from cron.job where jobname = 'food_search_maintenance_15m';
    exception when others then
      null;
    end;
    perform cron.schedule('food_search_maintenance_15m', '*/15 * * * *', 'select public.food_search_maintenance_tick();');

    begin
      perform cron.unschedule(jobid) from cron.job where jobname = 'food_search_alerts_5m';
    exception when others then
      null;
    end;
    perform cron.schedule('food_search_alerts_5m', '*/5 * * * *', 'select public.evaluate_food_search_slo_alerts();');
  end if;
end $$;
