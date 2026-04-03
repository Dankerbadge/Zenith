-- Ensure first-time users can create their own profile row.
-- The app performs `profiles.upsert({ id: auth.uid(), ... })` during login/signup.
-- With RLS enabled, an INSERT policy is required for the initial row creation.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY "Users can insert own profile"
    ON public.profiles
    FOR INSERT
    WITH CHECK (auth.uid() = id);
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
