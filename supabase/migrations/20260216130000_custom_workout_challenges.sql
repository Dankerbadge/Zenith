-- Custom workout challenges (friends + teams)
-- Deterministic rules + participant state + evaluation audit events.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'challenge_visibility') THEN
    CREATE TYPE public.challenge_visibility AS ENUM ('PRIVATE', 'TEAM', 'PUBLIC');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'challenge_mode') THEN
    CREATE TYPE public.challenge_mode AS ENUM ('SINGLE_SESSION', 'CUMULATIVE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'challenge_score_type') THEN
    CREATE TYPE public.challenge_score_type AS ENUM (
      'FASTEST_TIME_FOR_DISTANCE',
      'LONGEST_DISTANCE',
      'MOST_DISTANCE_CUMULATIVE',
      'MOST_TIME_CUMULATIVE',
      'BEST_AVG_PACE_FOR_DISTANCE',
      'COMPLETION_ONLY',
      'SPLITS_COMPLIANCE'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'challenge_participant_status') THEN
    CREATE TYPE public.challenge_participant_status AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'LEFT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'challenge_completion_state') THEN
    CREATE TYPE public.challenge_completion_state AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.workout_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NULL,
  activity_type TEXT NOT NULL,
  mode public.challenge_mode NOT NULL,
  score_type public.challenge_score_type NOT NULL,
  rules JSONB NOT NULL,
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL,
  visibility public.challenge_visibility NOT NULL DEFAULT 'PRIVATE',
  team_id UUID NULL REFERENCES public.teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workout_challenges_time_order CHECK (end_ts > start_ts)
);
CREATE TABLE IF NOT EXISTS public.workout_challenge_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id UUID NOT NULL REFERENCES public.workout_challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'PARTICIPANT',
  status public.challenge_participant_status NOT NULL DEFAULT 'INVITED',
  joined_at TIMESTAMPTZ NULL,
  best_score NUMERIC NULL,
  best_workout_id UUID NULL,
  completion_state public.challenge_completion_state NOT NULL DEFAULT 'NOT_STARTED',
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(challenge_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.workout_challenge_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id UUID NOT NULL REFERENCES public.workout_challenges(id) ON DELETE CASCADE,
  inviter_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(challenge_id, invitee_user_id)
);
CREATE TABLE IF NOT EXISTS public.workout_challenge_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id UUID NOT NULL REFERENCES public.workout_challenges(id) ON DELETE CASCADE,
  user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workout_challenges_creator ON public.workout_challenges(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_workout_challenges_window ON public.workout_challenges(start_ts, end_ts);
CREATE INDEX IF NOT EXISTS idx_workout_challenges_team ON public.workout_challenges(team_id);
CREATE INDEX IF NOT EXISTS idx_workout_challenge_participants_user ON public.workout_challenge_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_challenge_participants_challenge ON public.workout_challenge_participants(challenge_id);
CREATE INDEX IF NOT EXISTS idx_workout_challenge_events_challenge ON public.workout_challenge_events(challenge_id, created_at DESC);
ALTER TABLE public.workout_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_challenge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_challenge_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_challenge_events ENABLE ROW LEVEL SECURITY;
-- Challenges readable by creator/participants/team members.
DROP POLICY IF EXISTS "workout challenges selectable by scoped users" ON public.workout_challenges;
CREATE POLICY "workout challenges selectable by scoped users"
  ON public.workout_challenges FOR SELECT
  TO authenticated
  USING (
    creator_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workout_challenge_participants p
      WHERE p.challenge_id = workout_challenges.id AND p.user_id = auth.uid()
    )
    OR (
      visibility = 'TEAM'
      AND team_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.team_id = workout_challenges.team_id
          AND tm.user_id = auth.uid()
      )
    )
  );
DROP POLICY IF EXISTS "workout challenges creator insert" ON public.workout_challenges;
CREATE POLICY "workout challenges creator insert"
  ON public.workout_challenges FOR INSERT
  TO authenticated
  WITH CHECK (creator_user_id = auth.uid());
DROP POLICY IF EXISTS "workout challenges creator update" ON public.workout_challenges;
CREATE POLICY "workout challenges creator update"
  ON public.workout_challenges FOR UPDATE
  TO authenticated
  USING (creator_user_id = auth.uid())
  WITH CHECK (creator_user_id = auth.uid());
DROP POLICY IF EXISTS "participants select scoped" ON public.workout_challenge_participants;
CREATE POLICY "participants select scoped"
  ON public.workout_challenge_participants FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workout_challenges c
      WHERE c.id = workout_challenge_participants.challenge_id
        AND c.creator_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.workout_challenges c
      JOIN public.team_members tm ON tm.team_id = c.team_id
      WHERE c.id = workout_challenge_participants.challenge_id
        AND c.visibility = 'TEAM'
        AND tm.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "participants insert by creator" ON public.workout_challenge_participants;
CREATE POLICY "participants insert by creator"
  ON public.workout_challenge_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workout_challenges c
      WHERE c.id = workout_challenge_participants.challenge_id
        AND c.creator_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "participants update self or creator" ON public.workout_challenge_participants;
CREATE POLICY "participants update self or creator"
  ON public.workout_challenge_participants FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workout_challenges c
      WHERE c.id = workout_challenge_participants.challenge_id
        AND c.creator_user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workout_challenges c
      WHERE c.id = workout_challenge_participants.challenge_id
        AND c.creator_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "invites select scoped" ON public.workout_challenge_invites;
CREATE POLICY "invites select scoped"
  ON public.workout_challenge_invites FOR SELECT
  TO authenticated
  USING (
    inviter_user_id = auth.uid()
    OR invitee_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workout_challenges c
      WHERE c.id = workout_challenge_invites.challenge_id
        AND c.creator_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "invites insert creator" ON public.workout_challenge_invites;
CREATE POLICY "invites insert creator"
  ON public.workout_challenge_invites FOR INSERT
  TO authenticated
  WITH CHECK (
    inviter_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workout_challenges c
      WHERE c.id = workout_challenge_invites.challenge_id
        AND c.creator_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "events select scoped" ON public.workout_challenge_events;
CREATE POLICY "events select scoped"
  ON public.workout_challenge_events FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.workout_challenge_participants p
      WHERE p.challenge_id = workout_challenge_events.challenge_id
        AND p.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.workout_challenges c
      WHERE c.id = workout_challenge_events.challenge_id
        AND c.creator_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "events insert scoped" ON public.workout_challenge_events;
CREATE POLICY "events insert scoped"
  ON public.workout_challenge_events FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR user_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.workout_challenges c
      WHERE c.id = workout_challenge_events.challenge_id
        AND c.creator_user_id = auth.uid()
    )
  );
