-- ============================================================
-- SNAG — Fix handle_new_user trigger + backfill profiles
-- Root cause: handle_new_user was missing SET search_path = public.
-- Without it, the SECURITY DEFINER function runs in the auth
-- system's search_path (not public), so "profiles" can't be found,
-- and EXCEPTION WHEN OTHERS silently swallows the error. New users
-- signed up without getting a profile row, which caused create_organisation
-- to create orphaned org rows (UPDATE profiles WHERE id=auth.uid() hit 0 rows)
-- and getProfile to return null, keeping the screen stuck on OrgSetupScreen.
-- ============================================================

-- Fix 1: Add SET search_path = public to handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, name)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for user %: % (%)', new.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

-- Fix 2: Backfill profiles for users created while trigger was broken
INSERT INTO profiles (id, email, name)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'name', '')
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- Fix 3: Drop the old 2-arg create_organisation overload (causes PostgREST
-- ambiguity and silently no-ops the UPDATE profiles because calling_user_id=NULL)
DROP FUNCTION IF EXISTS public.create_organisation(org_name text, calling_user_id uuid);
