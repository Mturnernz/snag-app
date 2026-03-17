-- ============================================================
-- SNAG — Create Organisation RPC Migration
-- Run this in Supabase SQL Editor → New Query
-- ============================================================
-- Fixes: createOrganisation() calls rpc('create_organisation')
-- but the function was missing, causing silent failure.
--
-- v2: Pass calling_user_id explicitly. SET search_path = public
-- can cause auth.uid() to return null inside SECURITY DEFINER,
-- silently skipping the profile UPDATE (org created but user
-- never linked to it).
-- ============================================================

CREATE OR REPLACE FUNCTION create_organisation(org_name text, calling_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
BEGIN
  -- Create the organisation
  INSERT INTO organisations (name)
  VALUES (org_name)
  RETURNING id INTO new_org_id;

  -- Assign the calling user as admin of the new org
  UPDATE profiles
  SET organisation_id = new_org_id,
      role = 'admin'
  WHERE id = calling_user_id;

  RETURN new_org_id;
END;
$$;

-- Revoke public execute, grant only to authenticated users
REVOKE EXECUTE ON FUNCTION create_organisation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_organisation(text, uuid) TO authenticated;
