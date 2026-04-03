-- Strength PR projection table (rebuildable derived state)

CREATE TABLE IF NOT EXISTS public.exercise_prs (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_id text NOT NULL,
  calc_version text NOT NULL DEFAULT 'strength_v1',
  best_e1rm_kg numeric,
  best_e1rm_workout_id uuid REFERENCES public.workouts(id) ON DELETE SET NULL,
  best_e1rm_set_index integer,
  max_load_kg numeric,
  max_load_workout_id uuid REFERENCES public.workouts(id) ON DELETE SET NULL,
  max_load_set_index integer,
  best_volume_set_kg_reps numeric,
  best_volume_workout_id uuid REFERENCES public.workouts(id) ON DELETE SET NULL,
  best_volume_set_index integer,
  source text NOT NULL DEFAULT 'DERIVED',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, exercise_id, calc_version)
);
ALTER TABLE public.exercise_prs
  ADD CONSTRAINT exercise_prs_non_negative CHECK (
    (best_e1rm_kg IS NULL OR best_e1rm_kg >= 0) AND
    (max_load_kg IS NULL OR max_load_kg >= 0) AND
    (best_volume_set_kg_reps IS NULL OR best_volume_set_kg_reps >= 0)
  );
CREATE INDEX IF NOT EXISTS exercise_prs_user_updated_idx ON public.exercise_prs(user_id, updated_at DESC);
ALTER TABLE public.exercise_prs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "exercise_prs_select_own"
    ON public.exercise_prs FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "exercise_prs_manage_own"
    ON public.exercise_prs FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
