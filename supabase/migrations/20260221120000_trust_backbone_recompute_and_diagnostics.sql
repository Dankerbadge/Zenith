-- Trust backbone: deterministic daily projections, idempotent recompute, and recompute outbox.

-- Truth tables (create if absent; keep canonical units in columns).
create table if not exists public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  occurred_at timestamptz not null,
  day_key text not null,
  source text not null default 'MANUAL',
  source_id text null,
  idempotency_key text null,
  calories_kcal numeric not null default 0,
  protein_g numeric not null default 0,
  carbs_g numeric not null default 0,
  fat_g numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);
create table if not exists public.water_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  occurred_at timestamptz not null,
  day_key text not null,
  source text not null default 'MANUAL',
  source_id text null,
  idempotency_key text null,
  amount_ml numeric not null default 0,
  mode text not null default 'DELTA',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);
create table if not exists public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  occurred_at timestamptz not null,
  day_key text not null,
  source text not null default 'MANUAL',
  source_id text null,
  idempotency_key text null,
  weight_kg numeric not null check (weight_kg > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);
create table if not exists public.wearable_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  occurred_at timestamptz not null,
  day_key text not null,
  source text not null default 'HEALTHKIT',
  source_id text null,
  idempotency_key text null,
  duration_s integer not null default 0 check (duration_s >= 0),
  active_kcal numeric null check (active_kcal is null or active_kcal >= 0),
  distance_m numeric null check (distance_m is null or distance_m >= 0),
  avg_hr_bpm numeric null,
  max_hr_bpm numeric null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);
create unique index if not exists uq_wearable_sessions_source_id
  on public.wearable_sessions(user_id, source, source_id)
  where source_id is not null;
create table if not exists public.wearable_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_key text not null,
  source text not null default 'HEALTHKIT',
  source_id text null,
  idempotency_key text null,
  steps integer null check (steps is null or steps >= 0),
  active_kcal numeric null check (active_kcal is null or active_kcal >= 0),
  sleep_minutes integer null check (sleep_minutes is null or sleep_minutes >= 0),
  resting_hr_bpm numeric null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);
create unique index if not exists uq_wearable_daily_source_id
  on public.wearable_daily(user_id, source, source_id)
  where source_id is not null;
-- Derived tables with hash/provenance metadata.
create table if not exists public.daily_nutrition_totals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_key text not null,
  calories_in_kcal numeric not null default 0,
  protein_g numeric not null default 0,
  carbs_g numeric not null default 0,
  fat_g numeric not null default 0,
  calc_version text not null,
  input_hash text not null,
  computed_at timestamptz not null default now(),
  warnings jsonb not null default '[]'::jsonb,
  source_breakdown jsonb not null default '{}'::jsonb,
  primary key (user_id, day_key, calc_version)
);
create table if not exists public.daily_hydration_totals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_key text not null,
  water_ml numeric not null default 0,
  calc_version text not null,
  input_hash text not null,
  computed_at timestamptz not null default now(),
  warnings jsonb not null default '[]'::jsonb,
  source_breakdown jsonb not null default '{}'::jsonb,
  primary key (user_id, day_key, calc_version)
);
create table if not exists public.daily_activity_totals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_key text not null,
  active_kcal numeric not null default 0,
  workout_count integer not null default 0,
  duration_s integer not null default 0,
  distance_m numeric not null default 0,
  steps integer not null default 0,
  calc_version text not null,
  input_hash text not null,
  computed_at timestamptz not null default now(),
  warnings jsonb not null default '[]'::jsonb,
  source_breakdown jsonb not null default '{}'::jsonb,
  primary key (user_id, day_key, calc_version)
);
create table if not exists public.daily_training_load (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_key text not null,
  load_score numeric not null default 0,
  provisional boolean not null default true,
  calc_version text not null,
  input_hash text not null,
  computed_at timestamptz not null default now(),
  warnings jsonb not null default '[]'::jsonb,
  source_breakdown jsonb not null default '{}'::jsonb,
  primary key (user_id, day_key, calc_version)
);
create table if not exists public.daily_winning_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_key text not null,
  winning_day boolean not null default false,
  workout_done boolean not null default false,
  hydration_done boolean not null default false,
  protein_done boolean not null default false,
  active_day boolean not null default false,
  calc_version text not null,
  input_hash text not null,
  computed_at timestamptz not null default now(),
  warnings jsonb not null default '[]'::jsonb,
  source_breakdown jsonb not null default '{}'::jsonb,
  primary key (user_id, day_key, calc_version)
);
create table if not exists public.xp_ledger (
  xp_event_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_key text not null,
  reason_code text not null,
  amount integer not null,
  calc_version text not null,
  input_hash text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);
create unique index if not exists uq_xp_ledger_idempotent
  on public.xp_ledger(user_id, day_key, reason_code, calc_version, input_hash)
  where deleted_at is null;
create table if not exists public.recompute_outbox (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_key text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz null,
  idempotency_key text not null
);
create unique index if not exists uq_recompute_outbox_idem
  on public.recompute_outbox(user_id, day_key, idempotency_key);
-- Idempotent recompute for one day.
create or replace function public.recompute_day(p_day_key text, p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
  v_food_kcal numeric := 0;
  v_protein numeric := 0;
  v_carbs numeric := 0;
  v_fat numeric := 0;
  v_water_ml numeric := 0;
  v_active_kcal numeric := 0;
  v_workout_count integer := 0;
  v_duration_s integer := 0;
  v_distance_m numeric := 0;
  v_steps integer := 0;
  v_input_hash text;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select
    coalesce(sum(fe.calories_kcal), 0),
    coalesce(sum(fe.protein_g), 0),
    coalesce(sum(fe.carbs_g), 0),
    coalesce(sum(fe.fat_g), 0)
  into v_food_kcal, v_protein, v_carbs, v_fat
  from public.food_entries fe
  where fe.user_id = v_user and fe.day_key = p_day_key and fe.deleted_at is null;

  select coalesce(sum(case when we.mode = 'DELTA' then we.amount_ml else 0 end), 0)
  into v_water_ml
  from public.water_events we
  where we.user_id = v_user and we.day_key = p_day_key and we.deleted_at is null;

  -- Absolute events override sum when present (last absolute wins deterministically by occurred_at).
  select coalesce(x.amount_ml, v_water_ml)
  into v_water_ml
  from (
    select we.amount_ml
    from public.water_events we
    where we.user_id = v_user and we.day_key = p_day_key and we.deleted_at is null and we.mode = 'ABSOLUTE'
    order by we.occurred_at desc, we.id desc
    limit 1
  ) x;

  select
    coalesce(sum(w.active_kcal), 0),
    count(*)::int,
    coalesce(sum(w.duration_s), 0)::int,
    coalesce(sum(w.distance_m), 0)
  into v_active_kcal, v_workout_count, v_duration_s, v_distance_m
  from public.workouts w
  where w.user_id = v_user and w.day = p_day_key;

  select
    coalesce(sum(ws.active_kcal), 0),
    coalesce(sum(ws.duration_s), 0)::int,
    coalesce(sum(ws.distance_m), 0)
  into strict v_active_kcal, v_duration_s, v_distance_m
  from (
    select
      (v_active_kcal + coalesce(sum(s.active_kcal), 0))::numeric as active_kcal,
      (v_duration_s + coalesce(sum(s.duration_s), 0))::int as duration_s,
      (v_distance_m + coalesce(sum(s.distance_m), 0))::numeric as distance_m
    from public.wearable_sessions s
    where s.user_id = v_user and s.day_key = p_day_key and s.deleted_at is null
  ) ws;

  select coalesce(sum(wd.steps), 0)::int
  into v_steps
  from public.wearable_daily wd
  where wd.user_id = v_user and wd.day_key = p_day_key and wd.deleted_at is null;

  v_input_hash := md5(
    concat_ws(
      '|',
      p_day_key,
      v_food_kcal::text,
      v_protein::text,
      v_carbs::text,
      v_fat::text,
      v_water_ml::text,
      v_active_kcal::text,
      v_workout_count::text,
      v_duration_s::text,
      v_distance_m::text,
      v_steps::text
    )
  );

  insert into public.daily_nutrition_totals (
    user_id, day_key, calories_in_kcal, protein_g, carbs_g, fat_g, calc_version, input_hash, computed_at, warnings, source_breakdown
  ) values (
    v_user, p_day_key, v_food_kcal, v_protein, v_carbs, v_fat, 'daily_nutrition_v1', v_input_hash, now(), '[]'::jsonb, '{}'::jsonb
  )
  on conflict (user_id, day_key, calc_version)
  do update set
    calories_in_kcal = excluded.calories_in_kcal,
    protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g,
    input_hash = excluded.input_hash,
    computed_at = excluded.computed_at,
    warnings = excluded.warnings,
    source_breakdown = excluded.source_breakdown
  where public.daily_nutrition_totals.input_hash is distinct from excluded.input_hash
     or public.daily_nutrition_totals.computed_at < excluded.computed_at;

  insert into public.daily_hydration_totals (
    user_id, day_key, water_ml, calc_version, input_hash, computed_at, warnings, source_breakdown
  ) values (
    v_user, p_day_key, v_water_ml, 'daily_hydration_v1', v_input_hash, now(), '[]'::jsonb, '{}'::jsonb
  )
  on conflict (user_id, day_key, calc_version)
  do update set
    water_ml = excluded.water_ml,
    input_hash = excluded.input_hash,
    computed_at = excluded.computed_at,
    warnings = excluded.warnings,
    source_breakdown = excluded.source_breakdown
  where public.daily_hydration_totals.input_hash is distinct from excluded.input_hash
     or public.daily_hydration_totals.computed_at < excluded.computed_at;

  insert into public.daily_activity_totals (
    user_id, day_key, active_kcal, workout_count, duration_s, distance_m, steps, calc_version, input_hash, computed_at, warnings, source_breakdown
  ) values (
    v_user, p_day_key, v_active_kcal, v_workout_count, v_duration_s, v_distance_m, v_steps, 'daily_activity_v1', v_input_hash, now(), '[]'::jsonb, '{}'::jsonb
  )
  on conflict (user_id, day_key, calc_version)
  do update set
    active_kcal = excluded.active_kcal,
    workout_count = excluded.workout_count,
    duration_s = excluded.duration_s,
    distance_m = excluded.distance_m,
    steps = excluded.steps,
    input_hash = excluded.input_hash,
    computed_at = excluded.computed_at,
    warnings = excluded.warnings,
    source_breakdown = excluded.source_breakdown
  where public.daily_activity_totals.input_hash is distinct from excluded.input_hash
     or public.daily_activity_totals.computed_at < excluded.computed_at;

  insert into public.daily_training_load (
    user_id, day_key, load_score, provisional, calc_version, input_hash, computed_at, warnings, source_breakdown
  ) values (
    v_user,
    p_day_key,
    round(((v_duration_s::numeric / 60.0) * 0.6 + v_active_kcal * 0.25)::numeric, 2),
    true,
    'daily_training_v1',
    v_input_hash,
    now(),
    '["TRAINING_LOAD_PROVISIONAL_LOCAL"]'::jsonb,
    '{}'::jsonb
  )
  on conflict (user_id, day_key, calc_version)
  do update set
    load_score = excluded.load_score,
    provisional = excluded.provisional,
    input_hash = excluded.input_hash,
    computed_at = excluded.computed_at,
    warnings = excluded.warnings,
    source_breakdown = excluded.source_breakdown
  where public.daily_training_load.input_hash is distinct from excluded.input_hash
     or public.daily_training_load.computed_at < excluded.computed_at;

  -- Winning state baseline (server authoritative booleans; app can enrich).
  insert into public.daily_winning_state (
    user_id, day_key, winning_day, workout_done, hydration_done, protein_done, active_day, calc_version, input_hash, computed_at, warnings, source_breakdown
  ) values (
    v_user,
    p_day_key,
    (v_workout_count > 0 and v_water_ml > 0 and v_protein > 0),
    (v_workout_count > 0),
    (v_water_ml > 0),
    (v_protein > 0),
    (v_workout_count > 0 or v_food_kcal > 0 or v_water_ml > 0),
    'daily_winning_v1',
    v_input_hash,
    now(),
    '[]'::jsonb,
    '{}'::jsonb
  )
  on conflict (user_id, day_key, calc_version)
  do update set
    winning_day = excluded.winning_day,
    workout_done = excluded.workout_done,
    hydration_done = excluded.hydration_done,
    protein_done = excluded.protein_done,
    active_day = excluded.active_day,
    input_hash = excluded.input_hash,
    computed_at = excluded.computed_at,
    warnings = excluded.warnings,
    source_breakdown = excluded.source_breakdown
  where public.daily_winning_state.input_hash is distinct from excluded.input_hash
     or public.daily_winning_state.computed_at < excluded.computed_at;

  -- XP ledger idempotent award rows for this hash/version.
  insert into public.xp_ledger (xp_event_id, user_id, day_key, reason_code, amount, calc_version, input_hash, created_at, deleted_at)
  values (
    concat('xp_', v_user::text, '_', p_day_key, '_WORKOUT_COMPLETED_', v_input_hash),
    v_user,
    p_day_key,
    'WORKOUT_COMPLETED',
    greatest(v_workout_count * 12, 0),
    'daily_xp_v1',
    v_input_hash,
    now(),
    null
  )
  on conflict (xp_event_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'day_key', p_day_key,
    'input_hash', v_input_hash,
    'computed_at', now()
  );
end;
$$;
create or replace function public.recompute_range(p_start_day text, p_end_day text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date := p_start_day::date;
  v_end date := p_end_day::date;
  v_cursor date;
  v_count integer := 0;
begin
  if v_start is null or v_end is null then
    raise exception 'invalid date range';
  end if;
  if v_end < v_start then
    raise exception 'end before start';
  end if;
  v_cursor := v_start;
  while v_cursor <= v_end loop
    perform public.recompute_day(v_cursor::text);
    v_count := v_count + 1;
    v_cursor := v_cursor + interval '1 day';
  end loop;
  return jsonb_build_object('ok', true, 'days_processed', v_count);
end;
$$;
create or replace function public.process_recompute_outbox(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row record;
  v_processed integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  for v_row in
    select id, day_key
    from public.recompute_outbox
    where user_id = v_user
      and processed_at is null
    order by created_at asc
    limit greatest(1, p_limit)
  loop
    perform public.recompute_day(v_row.day_key);
    update public.recompute_outbox
      set processed_at = now()
      where id = v_row.id;
    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object('ok', true, 'processed', v_processed);
end;
$$;
revoke all on function public.recompute_day(text, uuid) from public;
grant execute on function public.recompute_day(text, uuid) to authenticated;
grant execute on function public.recompute_day(text, uuid) to service_role;
revoke all on function public.recompute_range(text, text) from public;
grant execute on function public.recompute_range(text, text) to authenticated;
revoke all on function public.process_recompute_outbox(integer) from public;
grant execute on function public.process_recompute_outbox(integer) to authenticated;
create or replace function public.enqueue_recompute_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_day_key text;
  v_reason text;
  v_idem text;
begin
  v_user := coalesce(new.user_id, old.user_id);
  v_day_key := coalesce(new.day_key, old.day_key, new.day, old.day);
  v_reason := tg_table_name || ':' || tg_op;
  v_idem := md5(concat_ws('|', tg_table_name, tg_op, coalesce(new.id::text, old.id::text, ''), coalesce(new.updated_at::text, old.updated_at::text, now()::text)));
  if v_user is null or v_day_key is null then
    return coalesce(new, old);
  end if;
  insert into public.recompute_outbox(user_id, day_key, reason, idempotency_key)
  values (v_user, v_day_key, v_reason, v_idem)
  on conflict (user_id, day_key, idempotency_key) do nothing;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_food_entries_recompute_outbox on public.food_entries;
create trigger trg_food_entries_recompute_outbox
after insert or update or delete on public.food_entries
for each row execute function public.enqueue_recompute_outbox();
drop trigger if exists trg_water_events_recompute_outbox on public.water_events;
create trigger trg_water_events_recompute_outbox
after insert or update or delete on public.water_events
for each row execute function public.enqueue_recompute_outbox();
drop trigger if exists trg_weight_logs_recompute_outbox on public.weight_logs;
create trigger trg_weight_logs_recompute_outbox
after insert or update or delete on public.weight_logs
for each row execute function public.enqueue_recompute_outbox();
drop trigger if exists trg_wearable_sessions_recompute_outbox on public.wearable_sessions;
create trigger trg_wearable_sessions_recompute_outbox
after insert or update or delete on public.wearable_sessions
for each row execute function public.enqueue_recompute_outbox();
drop trigger if exists trg_wearable_daily_recompute_outbox on public.wearable_daily;
create trigger trg_wearable_daily_recompute_outbox
after insert or update or delete on public.wearable_daily
for each row execute function public.enqueue_recompute_outbox();
drop trigger if exists trg_workouts_recompute_outbox on public.workouts;
create trigger trg_workouts_recompute_outbox
after insert or update or delete on public.workouts
for each row execute function public.enqueue_recompute_outbox();
