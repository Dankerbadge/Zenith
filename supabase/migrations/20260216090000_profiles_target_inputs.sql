-- Add profile fields required for science-based target recommendations.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS height_cm numeric,
  ADD COLUMN IF NOT EXISTS weight_kg numeric,
  ADD COLUMN IF NOT EXISTS sex_at_birth text,
  ADD COLUMN IF NOT EXISTS birthdate date,
  ADD COLUMN IF NOT EXISTS activity_level text,
  ADD COLUMN IF NOT EXISTS onboarding_goals jsonb;
UPDATE public.profiles
SET onboarding_goals = COALESCE(onboarding_goals, '["MAINTAIN"]'::jsonb)
WHERE onboarding_goals IS NULL;
