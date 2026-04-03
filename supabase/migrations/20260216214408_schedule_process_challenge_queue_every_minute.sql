-- Schedule process-challenge-queue every minute and capture worker run health.

CREATE TABLE IF NOT EXISTS public.challenge_worker_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'process-challenge-queue',
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  claimed INT NOT NULL DEFAULT 0,
  remaining_approx INT NOT NULL DEFAULT 0,
  oldest_unprocessed TIMESTAMPTZ NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_challenge_worker_runs_ran_at ON public.challenge_worker_runs(ran_at DESC);
ALTER TABLE public.challenge_worker_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "challenge worker runs deny all select" ON public.challenge_worker_runs;
CREATE POLICY "challenge worker runs deny all select"
  ON public.challenge_worker_runs FOR SELECT
  TO authenticated
  USING (false);
DROP POLICY IF EXISTS "challenge worker runs deny all modify" ON public.challenge_worker_runs;
CREATE POLICY "challenge worker runs deny all modify"
  ON public.challenge_worker_runs FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
CREATE OR REPLACE FUNCTION public.invoke_process_challenge_queue()
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
    url := 'https://erdllcmwzqqbevfdknbh.supabase.co/functions/v1/process-challenge-queue',
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
REVOKE ALL ON FUNCTION public.invoke_process_challenge_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_process_challenge_queue() TO service_role;
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    BEGIN
      PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'process_challenge_queue_every_minute';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'process_challenge_queue_every_minute',
      '* * * * *',
      'SELECT public.invoke_process_challenge_queue();'
    );
  END IF;
END $$;
