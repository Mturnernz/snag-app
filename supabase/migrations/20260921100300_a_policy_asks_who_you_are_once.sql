-- `auth.uid()` twice per row, on the table every screen joins to.
--
-- Postgres treats `auth.uid()` in a policy as volatile-ish per row unless it is
-- wrapped in a scalar subquery, so this policy re-resolved the caller's id for
-- **every profile row considered**, twice. Supabase's own linter flags it
-- (`auth_rls_initplan`), and `home.profiles` is the one table nearly every read
-- reaches: `snags_with_details` joins it three times — reporter, assignee and
-- comment authors — and `things_with_details` twice.
--
-- `(select auth.uid())` makes it an InitPlan: evaluated once for the whole
-- statement, its result reused. The expression the policy tests is otherwise
-- character-for-character what it was, so who can read which profile does not
-- change — checked below and in `viewSecurity.test.ts`' sibling assertion that
-- a non-member still reads nothing.
--
-- It is small at two profiles. It is not small at a household that has had six
-- people through it and a list of forty snags, which is the shape this was
-- always going to be read at.

drop policy if exists "members read household profiles" on home.profiles;

create policy "members read household profiles"
  on home.profiles for select
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from home.household_members mine
      join home.household_members theirs on theirs.household_id = mine.household_id
      where mine.profile_id = (select auth.uid())
        and theirs.profile_id = profiles.id
    )
  );
