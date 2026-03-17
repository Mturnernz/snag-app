-- ============================================================
-- SNAG — Admin Role Management Migration
-- Run in Supabase SQL Editor → New Query
-- ============================================================

-- Allow admins to update profiles of other members in their org.
-- The existing "Users can update their own profile" policy (id = auth.uid())
-- already allows self-updates; this adds a second permissive policy for admins.
DROP POLICY IF EXISTS "Admins can manage member roles" ON profiles;
CREATE POLICY "Admins can manage member roles"
  ON profiles FOR UPDATE
  USING (
    organisation_id = (SELECT organisation_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );
