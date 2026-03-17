-- ============================================================
-- SNAG — Org Creation Fix Migration
-- Run AFTER migration_roles.sql (requires the `role` column on profiles)
-- ============================================================

-- 1. create_organisation RPC function
--    SECURITY DEFINER bypasses RLS so it can insert into organisations
--    and update the caller's profile in a single atomic transaction.
CREATE OR REPLACE FUNCTION create_organisation(org_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
BEGIN
  INSERT INTO organisations (name)
  VALUES (org_name)
  RETURNING id INTO new_org_id;

  UPDATE profiles
  SET organisation_id = new_org_id,
      role = 'admin'
  WHERE id = auth.uid();

  RETURN new_org_id;
END;
$$;

-- 2. SELECT policy on organisations so members can read their own org
--    (needed by getProfile's `organisation:organisations(*)` join)
DROP POLICY IF EXISTS "Org members can view their organisation" ON organisations;
CREATE POLICY "Org members can view their organisation"
  ON organisations FOR SELECT
  USING (
    id = (SELECT organisation_id FROM profiles WHERE id = auth.uid())
  );

-- 3. Fix profiles SELECT policy so users can always read their own profile
--    (redundant if migration_roles.sql has already been applied, but safe to re-run)
DROP POLICY IF EXISTS "Profiles are viewable by org members" ON profiles;
CREATE POLICY "Profiles are viewable by org members"
  ON profiles FOR SELECT
  USING (
    id = auth.uid()
    OR organisation_id = (SELECT organisation_id FROM profiles WHERE id = auth.uid())
  );
