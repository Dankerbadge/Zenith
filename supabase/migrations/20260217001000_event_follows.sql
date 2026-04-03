-- Event follow bookmarks for RSVP-disabled fallback actions.

CREATE TABLE IF NOT EXISTS public.event_follows (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);
ALTER TABLE public.event_follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own event follows" ON public.event_follows;
CREATE POLICY "Users can view own event follows"
  ON public.event_follows
  FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own event follows" ON public.event_follows;
CREATE POLICY "Users can insert own event follows"
  ON public.event_follows
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own event follows" ON public.event_follows;
CREATE POLICY "Users can delete own event follows"
  ON public.event_follows
  FOR DELETE
  USING (auth.uid() = user_id);
