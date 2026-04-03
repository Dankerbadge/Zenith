-- Queue pipeline for deterministic challenge recompute.

CREATE TABLE IF NOT EXISTS public.challenge_recompute_queue (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  workout_id UUID NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  locked_at TIMESTAMPTZ NULL,
  lock_id UUID NULL,
  UNIQUE(user_id, workout_id)
);
CREATE INDEX IF NOT EXISTS idx_challenge_recompute_queue_status ON public.challenge_recompute_queue(processed_at, inserted_at);
CREATE INDEX IF NOT EXISTS idx_challenge_recompute_queue_user ON public.challenge_recompute_queue(user_id);
-- Expand workouts for challenge verification.
ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS duration_s NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS was_user_entered BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS route_points JSONB NULL;
-- Ensure route point store exists for interpolation-based split checks.
CREATE TABLE IF NOT EXISTS public.workout_route_points (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workout_id UUID NOT NULL REFERENCES public.workouts(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  lat DOUBLE PRECISION NULL,
  lon DOUBLE PRECISION NULL,
  ts TIMESTAMPTZ NOT NULL,
  dist_m DOUBLE PRECISION NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workout_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_workout_route_points_workout_seq ON public.workout_route_points(workout_id, seq);
CREATE OR REPLACE FUNCTION public.enqueue_challenge_recompute()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.challenge_recompute_queue (user_id, workout_id)
  VALUES (NEW.user_id, NEW.id)
  ON CONFLICT (user_id, workout_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enqueue_challenge_recompute_on_workout_insert ON public.workouts;
CREATE TRIGGER trg_enqueue_challenge_recompute_on_workout_insert
AFTER INSERT ON public.workouts
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_challenge_recompute();
-- Optional route-ready nudge; unique queue key keeps idempotent.
CREATE OR REPLACE FUNCTION public.enqueue_challenge_recompute_from_route_point()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT user_id INTO v_user_id FROM public.workouts WHERE id = NEW.workout_id;
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.challenge_recompute_queue (user_id, workout_id)
    VALUES (v_user_id, NEW.workout_id)
    ON CONFLICT (user_id, workout_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enqueue_challenge_recompute_on_route_point_insert ON public.workout_route_points;
CREATE TRIGGER trg_enqueue_challenge_recompute_on_route_point_insert
AFTER INSERT ON public.workout_route_points
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_challenge_recompute_from_route_point();
-- Queue should be service-role only from clients.
ALTER TABLE public.challenge_recompute_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "challenge queue deny all select" ON public.challenge_recompute_queue;
CREATE POLICY "challenge queue deny all select"
  ON public.challenge_recompute_queue FOR SELECT
  TO authenticated
  USING (false);
DROP POLICY IF EXISTS "challenge queue deny all modify" ON public.challenge_recompute_queue;
CREATE POLICY "challenge queue deny all modify"
  ON public.challenge_recompute_queue FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
-- Service-role worker helpers
CREATE OR REPLACE FUNCTION public.claim_challenge_recompute_jobs(p_lock_id UUID, p_limit INT DEFAULT 50)
RETURNS SETOF public.challenge_recompute_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.challenge_recompute_queue q
    WHERE q.processed_at IS NULL
      AND q.attempts < 10
      AND q.lock_id IS NULL
    ORDER BY q.inserted_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.challenge_recompute_queue q
  SET lock_id = p_lock_id, locked_at = NOW()
  FROM picked
  WHERE q.id = picked.id
  RETURNING q.*;
END;
$$;
CREATE OR REPLACE FUNCTION public.fail_challenge_recompute_job(p_id BIGINT, p_lock_id UUID, p_error TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.challenge_recompute_queue
  SET
    attempts = attempts + 1,
    last_error = LEFT(COALESCE(p_error, 'unknown_error'), 500),
    locked_at = NULL,
    lock_id = NULL
  WHERE id = p_id
    AND lock_id = p_lock_id;
END;
$$;
