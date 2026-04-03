-- Close remaining backend/platform gaps: billing, imports, wearables, cloud achievements, schedulers.

-- ============================================================
-- Billing tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.iap_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  product_id TEXT NOT NULL,
  transaction_id TEXT NULL,
  original_transaction_id TEXT NULL,
  app_account_token UUID NULL,
  bundle_id TEXT NULL,
  environment TEXT NULL,
  purchase_token TEXT NULL,
  package_name TEXT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_iap_transactions_user_id ON public.iap_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_iap_transactions_platform_tx ON public.iap_transactions(platform, transaction_id);
CREATE INDEX IF NOT EXISTS idx_iap_transactions_platform_original_tx ON public.iap_transactions(platform, original_transaction_id);
CREATE INDEX IF NOT EXISTS idx_iap_transactions_platform_purchase_token ON public.iap_transactions(platform, purchase_token);
CREATE UNIQUE INDEX IF NOT EXISTS uq_iap_transactions_ios_tx
  ON public.iap_transactions(platform, transaction_id)
  WHERE platform = 'ios' AND transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_iap_transactions_android_purchase
  ON public.iap_transactions(platform, purchase_token)
  WHERE platform = 'android' AND purchase_token IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.iap_entitlements (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_pro BOOLEAN NOT NULL DEFAULT false,
  plan TEXT NULL,
  platform TEXT NULL,
  product_id TEXT NULL,
  current_period_end TIMESTAMPTZ NULL,
  last_verified_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'inactive',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.iap_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  event_type TEXT NOT NULL,
  user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  transaction_id TEXT NULL,
  original_transaction_id TEXT NULL,
  purchase_token TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.iap_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iap_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iap_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "iap_entitlements_select_own" ON public.iap_entitlements;
CREATE POLICY "iap_entitlements_select_own"
  ON public.iap_entitlements FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "iap_entitlements_no_client_write" ON public.iap_entitlements;
CREATE POLICY "iap_entitlements_no_client_write"
  ON public.iap_entitlements FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
DROP POLICY IF EXISTS "iap_transactions_no_client_access" ON public.iap_transactions;
CREATE POLICY "iap_transactions_no_client_access"
  ON public.iap_transactions FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
DROP POLICY IF EXISTS "iap_events_no_client_access" ON public.iap_events;
CREATE POLICY "iap_events_no_client_access"
  ON public.iap_events FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
-- ============================================================
-- Wearables ingest tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wearable_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  start_ts TIMESTAMPTZ NULL,
  end_ts TIMESTAMPTZ NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wearable_samples_user_created ON public.wearable_samples(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.wearable_sync_state (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  last_sync_ts TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.wearable_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wearable_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wearable_samples_select_own" ON public.wearable_samples;
CREATE POLICY "wearable_samples_select_own"
  ON public.wearable_samples FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "wearable_samples_insert_own" ON public.wearable_samples;
CREATE POLICY "wearable_samples_insert_own"
  ON public.wearable_samples FOR INSERT
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "wearable_sync_state_select_own" ON public.wearable_sync_state;
CREATE POLICY "wearable_sync_state_select_own"
  ON public.wearable_sync_state FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "wearable_sync_state_insert_own" ON public.wearable_sync_state;
CREATE POLICY "wearable_sync_state_insert_own"
  ON public.wearable_sync_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "wearable_sync_state_update_own" ON public.wearable_sync_state;
CREATE POLICY "wearable_sync_state_update_own"
  ON public.wearable_sync_state FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- ============================================================
-- FIT/GPX import queue
-- ============================================================

CREATE TABLE IF NOT EXISTS public.file_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('fit', 'gpx')),
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'UPLOADED', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_file_import_jobs_status_created ON public.file_import_jobs(status, created_at);
ALTER TABLE public.file_import_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "file_import_jobs_select_own" ON public.file_import_jobs;
CREATE POLICY "file_import_jobs_select_own"
  ON public.file_import_jobs FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "file_import_jobs_insert_own" ON public.file_import_jobs;
CREATE POLICY "file_import_jobs_insert_own"
  ON public.file_import_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "file_import_jobs_update_own_limited" ON public.file_import_jobs;
CREATE POLICY "file_import_jobs_update_own_limited"
  ON public.file_import_jobs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- ============================================================
-- Cloud achievements
-- ============================================================

CREATE TABLE IF NOT EXISTS public.achievements_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NULL,
  criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
  points INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.achievements_definitions (key, title, description, icon, criteria, points, active)
VALUES
  ('workouts_10', 'Getting Started', 'Complete 10 workouts.', '🏁', '{"kind":"workouts_count","target":10}'::jsonb, 25, true),
  ('workouts_50', 'Momentum', 'Complete 50 workouts.', '🔥', '{"kind":"workouts_count","target":50}'::jsonb, 75, true),
  ('distance_50k', 'Distance Builder', 'Accumulate 50 km total distance.', '📏', '{"kind":"distance_m","target":50000}'::jsonb, 60, true),
  ('runs_25', 'Runner', 'Complete 25 runs.', '🏃', '{"kind":"run_count","target":25}'::jsonb, 80, true),
  ('kcal_10k', 'Workhorse', 'Burn 10,000 active kcal.', '⚡', '{"kind":"active_kcal","target":10000}'::jsonb, 90, true),
  ('challenges_5', 'Competitor', 'Complete 5 challenges.', '🏆', '{"kind":"challenge_completions","target":5}'::jsonb, 100, true)
ON CONFLICT (key) DO UPDATE
SET title = EXCLUDED.title,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    criteria = EXCLUDED.criteria,
    points = EXCLUDED.points,
    active = EXCLUDED.active;
CREATE TABLE IF NOT EXISTS public.user_achievements (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES public.achievements_definitions(id) ON DELETE CASCADE,
  progress_value NUMERIC NOT NULL DEFAULT 0,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  earned_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, achievement_id)
);
ALTER TABLE public.achievements_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "achievements_definitions_select_all_active" ON public.achievements_definitions;
CREATE POLICY "achievements_definitions_select_all_active"
  ON public.achievements_definitions FOR SELECT
  USING (active = true);
DROP POLICY IF EXISTS "achievements_definitions_no_client_write" ON public.achievements_definitions;
CREATE POLICY "achievements_definitions_no_client_write"
  ON public.achievements_definitions FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
DROP POLICY IF EXISTS "user_achievements_select_own" ON public.user_achievements;
CREATE POLICY "user_achievements_select_own"
  ON public.user_achievements FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_achievements_no_client_write" ON public.user_achievements;
CREATE POLICY "user_achievements_no_client_write"
  ON public.user_achievements FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
CREATE TABLE IF NOT EXISTS public.achievements_recompute_queue (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  locked_at TIMESTAMPTZ NULL,
  lock_id UUID NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_achievements_recompute_queue_user_pending
  ON public.achievements_recompute_queue(user_id)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_achievements_recompute_queue_pending
  ON public.achievements_recompute_queue(processed_at, inserted_at);
ALTER TABLE public.achievements_recompute_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "achievements_recompute_queue_no_client_access" ON public.achievements_recompute_queue;
CREATE POLICY "achievements_recompute_queue_no_client_access"
  ON public.achievements_recompute_queue FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
CREATE OR REPLACE FUNCTION public.enqueue_achievements_recompute()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.achievements_recompute_queue(user_id)
  VALUES (NEW.user_id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_enqueue_achievements_on_workout ON public.workouts;
CREATE TRIGGER trg_enqueue_achievements_on_workout
AFTER INSERT ON public.workouts
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_achievements_recompute();
CREATE OR REPLACE FUNCTION public.claim_achievements_recompute_jobs(p_lock_id UUID, p_limit INT DEFAULT 50)
RETURNS SETOF public.achievements_recompute_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH cte AS (
    SELECT id
    FROM public.achievements_recompute_queue
    WHERE processed_at IS NULL
      AND attempts < 10
      AND (lock_id IS NULL OR locked_at < NOW() - interval '2 minutes')
    ORDER BY inserted_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.achievements_recompute_queue q
  SET lock_id = p_lock_id, locked_at = NOW()
  WHERE q.id IN (SELECT id FROM cte)
  RETURNING q.*;
END;
$$;
CREATE OR REPLACE FUNCTION public.fail_achievements_recompute_job(p_id BIGINT, p_lock_id UUID, p_error TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.achievements_recompute_queue
  SET attempts = attempts + 1,
      last_error = LEFT(COALESCE(p_error, 'unknown_error'), 500),
      lock_id = NULL,
      locked_at = NULL
  WHERE id = p_id
    AND lock_id = p_lock_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_achievements_recompute_jobs(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_achievements_recompute_job(BIGINT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_achievements_recompute_jobs(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_achievements_recompute_job(BIGINT, UUID, TEXT) TO service_role;
-- ============================================================
-- Worker run logs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.worker_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source TEXT NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  claimed INT NOT NULL DEFAULT 0,
  remaining_approx INT NOT NULL DEFAULT 0,
  oldest_unprocessed TIMESTAMPTZ NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_worker_runs_source_ran ON public.worker_runs(source, ran_at DESC);
ALTER TABLE public.worker_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "worker_runs_no_client_access" ON public.worker_runs;
CREATE POLICY "worker_runs_no_client_access"
  ON public.worker_runs FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
-- ============================================================
-- Scheduler invocation wrappers
-- ============================================================

CREATE OR REPLACE FUNCTION public.invoke_imports_process_queue()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_key TEXT;
  v_request_id BIGINT;
BEGIN
  v_service_key := current_setting('app.settings.service_role_key', true);
  IF v_service_key IS NULL OR length(v_service_key) = 0 THEN
    RAISE EXCEPTION 'service_role_key_missing';
  END IF;

  SELECT net.http_post(
    url := 'https://erdllcmwzqqbevfdknbh.supabase.co/functions/v1/imports-process-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key,
      'apikey', v_service_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 45000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.invoke_achievements_process_queue()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_key TEXT;
  v_request_id BIGINT;
BEGIN
  v_service_key := current_setting('app.settings.service_role_key', true);
  IF v_service_key IS NULL OR length(v_service_key) = 0 THEN
    RAISE EXCEPTION 'service_role_key_missing';
  END IF;

  SELECT net.http_post(
    url := 'https://erdllcmwzqqbevfdknbh.supabase.co/functions/v1/achievements-process-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key,
      'apikey', v_service_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 45000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.invoke_billing_reconcile()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_key TEXT;
  v_request_id BIGINT;
BEGIN
  v_service_key := current_setting('app.settings.service_role_key', true);
  IF v_service_key IS NULL OR length(v_service_key) = 0 THEN
    RAISE EXCEPTION 'service_role_key_missing';
  END IF;

  SELECT net.http_post(
    url := 'https://erdllcmwzqqbevfdknbh.supabase.co/functions/v1/billing-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key,
      'apikey', v_service_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 45000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_imports_process_queue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_achievements_process_queue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_billing_reconcile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_imports_process_queue() TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_achievements_process_queue() TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_billing_reconcile() TO service_role;
DO $$
BEGIN
  BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN CREATE EXTENSION IF NOT EXISTS pg_net; EXCEPTION WHEN OTHERS THEN NULL; END;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    BEGIN
      PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'imports_process_queue_every_minute';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'achievements_process_queue_every_minute';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'billing_reconcile_every_6h';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    PERFORM cron.schedule('imports_process_queue_every_minute', '* * * * *', 'SELECT public.invoke_imports_process_queue();');
    PERFORM cron.schedule('achievements_process_queue_every_minute', '* * * * *', 'SELECT public.invoke_achievements_process_queue();');
    PERFORM cron.schedule('billing_reconcile_every_6h', '0 */6 * * *', 'SELECT public.invoke_billing_reconcile();');
  END IF;
END $$;
