-- Canonical unit system enforcement for Zenith.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS unit_system text,
  ADD COLUMN IF NOT EXISTS water_target_ml numeric;
UPDATE public.profiles
SET unit_system = COALESCE(
  NULLIF(unit_system, ''),
  'imperial'
)
WHERE unit_system IS NULL OR unit_system NOT IN ('imperial', 'metric');
UPDATE public.profiles
SET water_target_ml = COALESCE(
  water_target_ml
)
WHERE water_target_ml IS NULL;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_unit_system_check CHECK (unit_system IN ('imperial', 'metric'));
ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS duration_s numeric,
  ADD COLUMN IF NOT EXISTS distance_m numeric,
  ADD COLUMN IF NOT EXISTS active_kcal numeric;
UPDATE public.workouts
SET duration_s = GREATEST(
  0,
  COALESCE(
    duration_s,
    EXTRACT(EPOCH FROM (end_ts - start_ts))
  )
)
WHERE duration_s IS NULL;
ALTER TABLE public.workouts
  ADD CONSTRAINT workouts_duration_s_non_negative CHECK (duration_s IS NULL OR duration_s >= 0),
  ADD CONSTRAINT workouts_distance_m_non_negative CHECK (distance_m IS NULL OR distance_m >= 0),
  ADD CONSTRAINT workouts_active_kcal_non_negative CHECK (active_kcal IS NULL OR active_kcal >= 0),
  ADD CONSTRAINT workouts_distance_m_reasonable CHECK (distance_m IS NULL OR distance_m <= 1000000),
  ADD CONSTRAINT workouts_active_kcal_reasonable CHECK (active_kcal IS NULL OR active_kcal <= 50000);
CREATE TABLE IF NOT EXISTS public.hydration_daily (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day date NOT NULL,
  water_ml numeric NOT NULL DEFAULT 0,
  target_ml numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS public.weight_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day date NOT NULL,
  weight_kg numeric NOT NULL,
  note text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hydration_daily
  ADD CONSTRAINT hydration_daily_water_ml_non_negative CHECK (water_ml >= 0),
  ADD CONSTRAINT hydration_daily_water_ml_reasonable CHECK (water_ml <= 20000),
  ADD CONSTRAINT hydration_daily_target_ml_reasonable CHECK (target_ml IS NULL OR (target_ml >= 0 AND target_ml <= 20000));
ALTER TABLE public.weight_logs
  ADD CONSTRAINT weight_logs_weight_kg_reasonable CHECK (weight_kg > 0 AND weight_kg <= 500);
ALTER TABLE public.hydration_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weight_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "hydration_daily_select_own"
    ON public.hydration_daily FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "hydration_daily_manage_own"
    ON public.hydration_daily FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "weight_logs_select_own"
    ON public.weight_logs FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "weight_logs_manage_own"
    ON public.weight_logs FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
