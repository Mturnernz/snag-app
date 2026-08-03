-- Lock profile self-service to the one column it was ever meant to cover.
--
-- `users can update their own profile` was the only non-SELECT policy in the
-- entire schema — every other write in this app goes through a SECURITY
-- DEFINER RPC. It read `USING (id = auth.uid())` with no WITH CHECK and no
-- column restriction, and Supabase grants `authenticated` UPDATE on every
-- column by default. So the policy said "you may edit your own row" and
-- Postgres heard "every column of it", including `role`, `org_id` and
-- `removed_at`:
--
--   PATCH /rest/v1/profiles?id=eq.<self>  {"role":"officer_admin"}   -> 1 row
--
-- Confirmed against Snagv1 before this migration (in a transaction that was
-- rolled back): a worker could set their own role to officer_admin.
--
-- What kept that from being a full privilege escalation is that authorisation
-- does not read this column. `current_role()` and `current_org_id()` resolve
-- through `user_active_org` + `org_memberships`, which carry SELECT policies
-- only, so RLS never trusted `profiles.role`. That is load-bearing and easy to
-- lose by accident: the version of `current_role()` still sitting in
-- 20260707140000_member_soft_remove.sql *does* select from profiles, so anyone
-- reading the migration history rather than the live catalog would reasonably
-- conclude this column is the source of truth and write the next check against
-- it.
--
-- What it did reach, before this:
--
--   * the four edge functions, which gated on `profiles.role` and derived
--     storage paths and RPC arguments from `profiles.org_id` — a writable
--     org_id put a generated PDF in another org's storage folder, since those
--     uploads go through the service-role client. Fixed alongside this.
--   * the mobile client, which unlocks admin screens from it (server-side RPCs
--     still refused the writes, so this was a UI spoof rather than a breach).
--   * `name` and `email` — what every comment, witness statement and audit
--     entry is attributed to. Self-serve impersonation in a statutory record.
--
-- The clients only ever write `name` (updateProfile in apps/mobile/src/lib/
-- supabase.ts, and ProfileScreen's inline rename). `has_seen_onboarding` goes
-- through mark_onboarding_seen(), and every other column is maintained by
-- SECURITY DEFINER RPCs owned by postgres, which run as the owner and are
-- unaffected by the grants below.

revoke insert, update, delete on public.profiles from authenticated, anon;

grant update (name) on public.profiles to authenticated;

-- WITH CHECK as well as USING. Omitting it makes Postgres reuse USING for the
-- check, which only ever constrained `id` — the row you may edit, never the
-- values you may put in it. Stated explicitly so the next reader does not have
-- to know that rule to see what this policy allows.
drop policy "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
