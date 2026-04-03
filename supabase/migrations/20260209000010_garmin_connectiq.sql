-- GARMIN CONNECT IQ - DATABASE / EDGE INTEGRATION
-- Generated from docs/supabase_garmin_connectiq.sql for deterministic CLI deployments.

-- ============================================
-- GARMIN LINK TOKENS
-- ============================================
CREATE TABLE IF NOT EXISTS public.garmin_link_tokens (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_garmin_link_tokens_user ON public.garmin_link_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_garmin_link_tokens_token ON public.garmin_link_tokens(token);
ALTER TABLE public.garmin_link_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own link tokens"
  ON public.garmin_link_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- ============================================
-- GARMIN DEVICE LINKS
-- ============================================
CREATE TABLE IF NOT EXISTS public.garmin_device_links (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  garmin_device_id TEXT NOT NULL,
  garmin_user_id TEXT,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE(user_id, garmin_device_id)
);
CREATE INDEX IF NOT EXISTS idx_garmin_device_links_user ON public.garmin_device_links(user_id);
CREATE INDEX IF NOT EXISTS idx_garmin_device_links_device ON public.garmin_device_links(garmin_device_id);
ALTER TABLE public.garmin_device_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own device links"
  ON public.garmin_device_links
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- ============================================
-- GARMIN WORKOUT INGEST (minimal summary record)
-- ============================================
CREATE TABLE IF NOT EXISTS public.garmin_workouts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  garmin_device_id TEXT,
  garmin_activity_id TEXT,
  workout_type TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  duration_sec INTEGER NOT NULL,
  distance_meters DOUBLE PRECISION,
  calories INTEGER,
  avg_hr INTEGER,
  max_hr INTEGER,
  raw JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, garmin_activity_id)
);
CREATE INDEX IF NOT EXISTS idx_garmin_workouts_user ON public.garmin_workouts(user_id);
CREATE INDEX IF NOT EXISTS idx_garmin_workouts_started ON public.garmin_workouts(started_at DESC);
ALTER TABLE public.garmin_workouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own garmin workouts"
  ON public.garmin_workouts
  FOR SELECT
  USING (auth.uid() = user_id);
-- Writes should be done via edge function using user auth, or service role in controlled pathways.
CREATE POLICY "Users can insert own garmin workouts"
  ON public.garmin_workouts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- ============================================
-- GARMIN ENTITLEMENTS (premium sync)
-- ============================================
CREATE TABLE IF NOT EXISTS public.garmin_entitlements (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  premium_sync_enabled BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.garmin_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own entitlements"
  ON public.garmin_entitlements
  FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users can update own entitlements"
  ON public.garmin_entitlements
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
