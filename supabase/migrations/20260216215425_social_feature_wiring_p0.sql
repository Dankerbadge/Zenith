-- Social feature wiring P0: activity feed population + team challenge participation/evaluation.

ALTER TABLE public.team_challenges
  ADD COLUMN IF NOT EXISTS rules JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS public.team_challenge_participants (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  challenge_id UUID NOT NULL REFERENCES public.team_challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'JOINED',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  best_score NUMERIC NULL,
  best_workout_id UUID NULL REFERENCES public.workouts(id) ON DELETE SET NULL,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_challenge_participants_challenge ON public.team_challenge_participants(challenge_id);
CREATE INDEX IF NOT EXISTS idx_team_challenge_participants_user ON public.team_challenge_participants(user_id);
ALTER TABLE public.team_challenge_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Team challenge participants viewable by members" ON public.team_challenge_participants;
CREATE POLICY "Team challenge participants viewable by members"
  ON public.team_challenge_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.team_challenges tc
      JOIN public.team_members tm ON tm.team_id = tc.team_id
      WHERE tc.id = challenge_id
        AND tm.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users can join team challenges" ON public.team_challenge_participants;
CREATE POLICY "Users can join team challenges"
  ON public.team_challenge_participants FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.team_challenges tc
      JOIN public.team_members tm ON tm.team_id = tc.team_id
      WHERE tc.id = challenge_id
        AND tm.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Users can update own team challenge status" ON public.team_challenge_participants;
CREATE POLICY "Users can update own team challenge status"
  ON public.team_challenge_participants FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE OR REPLACE FUNCTION public.append_activity_feed(
  p_user_id UUID,
  p_activity_type TEXT,
  p_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.activity_feed (user_id, activity_type, data)
  VALUES (p_user_id, p_activity_type, COALESCE(p_data, '{}'::jsonb));
EXCEPTION
  WHEN OTHERS THEN
    -- Best effort feed write; core action should not fail.
    NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.append_activity_feed(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_activity_feed(UUID, TEXT, JSONB) TO service_role;
CREATE OR REPLACE FUNCTION public.on_post_created_feed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF COALESCE(NEW.is_public, false) THEN
    FOR r IN
      SELECT DISTINCT user_id
      FROM public.follows
      WHERE following_id = NEW.user_id
    LOOP
      PERFORM public.append_activity_feed(
        r.user_id,
        'POST_CREATED',
        jsonb_build_object(
          'postId', NEW.id,
          'actorUserId', NEW.user_id,
          'content', LEFT(COALESCE(NEW.content, ''), 180),
          'postType', NEW.post_type
        )
      );
    END LOOP;
  END IF;
  PERFORM public.append_activity_feed(
    NEW.user_id,
    'POST_CREATED',
    jsonb_build_object('postId', NEW.id, 'actorUserId', NEW.user_id, 'postType', NEW.post_type)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_post_created_feed ON public.posts;
CREATE TRIGGER trg_post_created_feed
AFTER INSERT ON public.posts
FOR EACH ROW
EXECUTE FUNCTION public.on_post_created_feed();
CREATE OR REPLACE FUNCTION public.on_follow_created_feed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.append_activity_feed(
    NEW.follower_id,
    'FOLLOWED_USER',
    jsonb_build_object('targetUserId', NEW.following_id, 'actorUserId', NEW.follower_id)
  );
  PERFORM public.append_activity_feed(
    NEW.following_id,
    'FOLLOWED_USER',
    jsonb_build_object('targetUserId', NEW.following_id, 'actorUserId', NEW.follower_id)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_follow_created_feed ON public.follows;
CREATE TRIGGER trg_follow_created_feed
AFTER INSERT ON public.follows
FOR EACH ROW
EXECUTE FUNCTION public.on_follow_created_feed();
CREATE OR REPLACE FUNCTION public.on_comment_created_feed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_owner UUID;
BEGIN
  SELECT user_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
  IF v_post_owner IS NOT NULL AND v_post_owner <> NEW.user_id THEN
    PERFORM public.append_activity_feed(
      v_post_owner,
      'COMMENT_CREATED',
      jsonb_build_object('postId', NEW.post_id, 'commentId', NEW.id, 'actorUserId', NEW.user_id)
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_comment_created_feed ON public.comments;
CREATE TRIGGER trg_comment_created_feed
AFTER INSERT ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.on_comment_created_feed();
CREATE OR REPLACE FUNCTION public.on_workout_created_feed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT follower_id AS user_id
    FROM public.follows
    WHERE following_id = NEW.user_id
  LOOP
    PERFORM public.append_activity_feed(
      r.user_id,
      'WORKOUT_COMPLETED',
      jsonb_build_object(
        'workoutId', NEW.id,
        'actorUserId', NEW.user_id,
        'activityType', NEW.activity_type,
        'durationS', COALESCE(NEW.duration_s, 0),
        'distanceM', COALESCE(NEW.distance_m, 0)
      )
    );
  END LOOP;
  PERFORM public.append_activity_feed(
    NEW.user_id,
    'WORKOUT_COMPLETED',
    jsonb_build_object('workoutId', NEW.id, 'actorUserId', NEW.user_id, 'activityType', NEW.activity_type)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_workout_created_feed ON public.workouts;
CREATE TRIGGER trg_workout_created_feed
AFTER INSERT ON public.workouts
FOR EACH ROW
EXECUTE FUNCTION public.on_workout_created_feed();
CREATE OR REPLACE FUNCTION public.on_team_challenge_created_feed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tm.user_id
    FROM public.team_members tm
    WHERE tm.team_id = NEW.team_id
  LOOP
    PERFORM public.append_activity_feed(
      r.user_id,
      'CHALLENGE_CREATED',
      jsonb_build_object('challengeId', NEW.id, 'teamId', NEW.team_id, 'actorUserId', NEW.created_by, 'title', NEW.title)
    );
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_team_challenge_created_feed ON public.team_challenges;
CREATE TRIGGER trg_team_challenge_created_feed
AFTER INSERT ON public.team_challenges
FOR EACH ROW
EXECUTE FUNCTION public.on_team_challenge_created_feed();
CREATE OR REPLACE FUNCTION public.evaluate_team_challenges_for_workout(p_workout_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w RECORD;
  c RECORD;
  v_value NUMERIC;
  v_score NUMERIC;
  v_completed BOOLEAN;
  v_updates INT := 0;
  v_completed_count INT := 0;
BEGIN
  SELECT * INTO w FROM public.workouts WHERE id = p_workout_id;
  IF w.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'workout_not_found');
  END IF;

  FOR c IN
    SELECT tc.*
    FROM public.team_challenges tc
    JOIN public.team_members tm ON tm.team_id = tc.team_id AND tm.user_id = w.user_id
    WHERE lower(COALESCE(tc.status, '')) = 'active'
      AND w.start_ts::date >= tc.start_date
      AND w.start_ts::date <= tc.end_date
  LOOP
    IF c.challenge_type = 'distance_mi' THEN
      v_value := COALESCE(w.distance_m, 0) / 1609.344;
      v_score := COALESCE(w.distance_m, 0);
    ELSIF c.challenge_type = 'xp' THEN
      v_value := GREATEST(0, COALESCE(w.duration_s, 0) / 60.0);
      v_score := v_value;
    ELSE
      -- workouts count as default.
      v_value := 1;
      v_score := 1;
    END IF;

    INSERT INTO public.team_challenge_participants (challenge_id, user_id, status, joined_at, best_score, best_workout_id, progress, updated_at)
    VALUES (
      c.id,
      w.user_id,
      'JOINED',
      NOW(),
      v_score,
      w.id,
      jsonb_build_object(
        'currentValue', v_value,
        'lastWorkoutId', w.id,
        'lastWorkoutAt', w.start_ts
      ),
      NOW()
    )
    ON CONFLICT (challenge_id, user_id)
    DO UPDATE
    SET
      best_score = GREATEST(COALESCE(public.team_challenge_participants.best_score, 0), COALESCE(EXCLUDED.best_score, 0)),
      best_workout_id = CASE
        WHEN COALESCE(EXCLUDED.best_score, 0) >= COALESCE(public.team_challenge_participants.best_score, 0)
        THEN EXCLUDED.best_workout_id
        ELSE public.team_challenge_participants.best_workout_id
      END,
      progress = jsonb_build_object(
        'currentValue', COALESCE((public.team_challenge_participants.progress ->> 'currentValue')::numeric, 0) + v_value,
        'lastWorkoutId', w.id,
        'lastWorkoutAt', w.start_ts
      ),
      updated_at = NOW();

    v_updates := v_updates + 1;

    SELECT
      COALESCE((progress ->> 'currentValue')::numeric, 0) >= COALESCE(c.target_value, 0)
    INTO v_completed
    FROM public.team_challenge_participants
    WHERE challenge_id = c.id
      AND user_id = w.user_id;

    IF v_completed THEN
      v_completed_count := v_completed_count + 1;
      PERFORM public.append_activity_feed(
        w.user_id,
        'CHALLENGE_COMPLETED',
        jsonb_build_object('challengeId', c.id, 'teamId', c.team_id, 'actorUserId', w.user_id, 'title', c.title)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'workoutId', p_workout_id,
    'updated', v_updates,
    'completed', v_completed_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.evaluate_team_challenges_for_workout(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_team_challenges_for_workout(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_team_challenges_for_workout(UUID) TO service_role;
