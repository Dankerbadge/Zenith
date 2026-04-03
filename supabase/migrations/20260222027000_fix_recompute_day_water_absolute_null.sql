-- Harden recompute_day() against workouts schema variants:
-- - day_key (trust schema)
-- - day (legacy canonicalization schema)
-- - start_ts (premium bundle schema)

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
  v_has_workout_day_key boolean := false;
  v_has_workout_day boolean := false;
  v_has_workout_start_ts boolean := false;
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

  select coalesce((
    select we.amount_ml
    from public.water_events we
    where we.user_id = v_user and we.day_key = p_day_key and we.deleted_at is null and we.mode = 'ABSOLUTE'
    order by we.occurred_at desc, we.id desc
    limit 1
  ), v_water_ml)
  into v_water_ml;

  select exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'workouts' and c.column_name = 'day_key'
  ) into v_has_workout_day_key;
  select exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'workouts' and c.column_name = 'day'
  ) into v_has_workout_day;
  select exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'workouts' and c.column_name = 'start_ts'
  ) into v_has_workout_start_ts;

  if v_has_workout_day_key then
    select
      coalesce(sum(w.active_kcal), 0),
      count(*)::int,
      coalesce(sum(w.duration_s), 0)::int,
      coalesce(sum(w.distance_m), 0)
    into v_active_kcal, v_workout_count, v_duration_s, v_distance_m
    from public.workouts w
    where w.user_id = v_user and w.day_key = p_day_key;
  elsif v_has_workout_day then
    select
      coalesce(sum(w.active_kcal), 0),
      count(*)::int,
      coalesce(sum(w.duration_s), 0)::int,
      coalesce(sum(w.distance_m), 0)
    into v_active_kcal, v_workout_count, v_duration_s, v_distance_m
    from public.workouts w
    where w.user_id = v_user and w.day::text = p_day_key;
  elsif v_has_workout_start_ts then
    select
      coalesce(sum(w.active_kcal), 0),
      count(*)::int,
      coalesce(sum(w.duration_s), 0)::int,
      coalesce(sum(w.distance_m), 0)
    into v_active_kcal, v_workout_count, v_duration_s, v_distance_m
    from public.workouts w
    where w.user_id = v_user and (w.start_ts at time zone 'UTC')::date::text = p_day_key;
  end if;

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
