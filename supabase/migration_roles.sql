-- ============================================================
-- SNAG — Roles & Voting Migration
-- Run this in Supabase SQL Editor → New Query
-- ============================================================

-- 1. Add role column to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'worker'
  CHECK (role IN ('worker', 'manager', 'admin'));

-- 2. Fix the signup trigger to not fail auth if profile insert errors
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
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
  RETURN NEW; -- never fail auth even if profile insert fails
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Fix profile policies
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Profiles are viewable by org members" ON profiles;
CREATE POLICY "Profiles are viewable by org members"
  ON profiles FOR SELECT
  USING (
    id = auth.uid()
    OR organisation_id = (SELECT organisation_id FROM profiles WHERE id = auth.uid())
  );

-- 4. Update issues RLS
DROP POLICY IF EXISTS "Reporters and admins can update issues" ON issues;
CREATE POLICY "Managers and admins can update issues"
  ON issues FOR UPDATE
  USING (
    organisation_id = (SELECT organisation_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('manager', 'admin')
  );

DROP POLICY IF EXISTS "Admins can delete issues" ON issues;
CREATE POLICY "Admins can delete issues"
  ON issues FOR DELETE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
    AND organisation_id = (SELECT organisation_id FROM profiles WHERE id = auth.uid())
  );

-- 5. Comments — all org members can comment on any issue
DROP POLICY IF EXISTS "Org members can add comments" ON comments;
CREATE POLICY "Org members can add comments"
  ON comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND issue_id IN (
      SELECT id FROM issues
      WHERE organisation_id = (SELECT organisation_id FROM profiles WHERE id = auth.uid())
    )
  );

-- 6. Votes table — one vote per user per issue, value: 1 (up) or -1 (down)
CREATE TABLE IF NOT EXISTS votes (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id    uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  value       smallint NOT NULL CHECK (value IN (1, -1)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issue_id, user_id)
);

ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view votes"
  ON votes FOR SELECT
  USING (
    issue_id IN (
      SELECT id FROM issues
      WHERE organisation_id = (SELECT organisation_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Org members can vote"
  ON votes FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND issue_id IN (
      SELECT id FROM issues
      WHERE organisation_id = (SELECT organisation_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can update their own vote"
  ON votes FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can remove their own vote"
  ON votes FOR DELETE
  USING (user_id = auth.uid());

-- 7. Update issues_with_details view to include vote totals
CREATE OR REPLACE VIEW issues_with_details AS
SELECT
  i.*,
  p.name        AS reporter_name,
  p.avatar_url  AS reporter_avatar,
  a.name        AS assignee_name,
  a.avatar_url  AS assignee_avatar,
  COUNT(DISTINCT c.id)::int                         AS comment_count,
  COALESCE(SUM(v.value), 0)::int                    AS vote_score,
  COUNT(DISTINCT CASE WHEN v.value = 1  THEN v.id END)::int  AS upvote_count,
  COUNT(DISTINCT CASE WHEN v.value = -1 THEN v.id END)::int  AS downvote_count
FROM issues i
LEFT JOIN profiles p  ON p.id = i.reporter_id
LEFT JOIN profiles a  ON a.id = i.assignee_id
LEFT JOIN comments c  ON c.issue_id = i.id
LEFT JOIN votes    v  ON v.issue_id = i.id
GROUP BY i.id, p.name, p.avatar_url, a.name, a.avatar_url;
