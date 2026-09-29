-- The retired product stops speaking, and stops answering.
--
-- `public` is the SnagHQ B2B archive: frozen, not read from, not written to.
-- Two parts of it were still live on 28 September 2026.
--
-- **It was still sending email.** `overdue-actions-digest` (pg_cron, daily at
-- 18:00 UTC) posts to the `notify-snag` edge function whenever a corrective
-- action is overdue. One pilot org has one, so the function had emailed
-- "1 overdue corrective action" to three people every day since the pivot,
-- for a product that no longer exists. The job is unscheduled here.
-- `retention-minimisation` stays scheduled: it blanks resolved niggles more
-- than three years old, which is a promise made to the pilot orgs, it cannot
-- match a row until 2029, and it runs as `postgres`, so nothing below
-- affects it.
--
-- **Every signed-in caller could still run its functions.** 116 SECURITY
-- DEFINER functions in `public` were executable by `authenticated`, and three
-- by `anon` (`get_site_by_public_token` by PUBLIC too). That was harmless
-- while the only signed-in callers were the pilot orgs. Every household
-- account this app creates is also `authenticated`, so any of them could call
-- `create_organisation_and_owner`, `create_public_snag`, `accept_invite` and
-- the rest, and write into the archive. Nothing in the app calls `public`:
-- both clients and every edge function make their client on `home`, and no
-- `home` function, view or policy names a `public` function (checked
-- 28 September 2026).
--
-- So this is a sweep, and a sweep that only revokes needs no allow-list
-- (CLAUDE.md, *Grant by name, never by sweep*).
--
-- **Four functions are granted back, and they have to be.** Storage is one
-- table shared by both products, and the retired product's `storage.objects`
-- policies still reach into `public`. Some call its functions directly:
-- `current_org_id()` in eleven policies, `"current_role"()` in three. One
-- queries `public.snags`, whose own policies call `can_view_site(uuid)` and
-- `is_org_active(uuid)`, and reach `public.comment_mentions`. RLS on a table
-- a policy reads is applied too, as the calling role.
--
-- Every function in that chain is checked for EXECUTE as the *calling* role
-- when the query is planned, not only on the rows a policy applies to.
-- Revoking any one of them therefore raises `42501` on every storage read and
-- upload, including every home photo. That is the `home.is_member` failure
-- `20260911093000` exists for, one schema over.
--
-- **The list was found by rehearsal, not by reading.** This migration was run
-- three times inside a transaction that was rolled back, as a household
-- member reading and writing `home-photos`:
--
--   * granting back `current_org_id` alone failed on `current_role`, which a
--     text search of `pg_policies` misses because the name has to be quoted;
--   * adding `current_role` failed on `can_view_site`, which no storage policy
--     names at all, only the `public.snags` policy one of them reads through.
--
-- The complete set is the closure `pg_depend` records from `storage.objects`
-- through every table its policies read. `supabase/tests/archive_locked.sql`
-- computes it that way and asserts that exactly those functions, and nothing
-- else in `public`, are executable. With all four granted back, a member
-- reads 151 photos and 53 documents, inserts and updates an object, and is
-- refused `public.accept_rca`.
--
-- All four are granted back exactly as they were: to `authenticated` only,
-- never `anon`. All four are SECURITY DEFINER predicates that answer about
-- the caller's own retired org, role or site, which for a household account
-- is null or false.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'overdue-actions-digest') then
    perform cron.unschedule('overdue-actions-digest');
  end if;
end
$$;

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.current_org_id() to authenticated;
grant execute on function public."current_role"() to authenticated;
grant execute on function public.can_view_site(uuid) to authenticated;
grant execute on function public.is_org_active(uuid) to authenticated;

-- Nothing is meant to be created in `public` again, but if anything ever is,
-- it should not arrive already handed to every signed-in caller. This takes
-- back the platform's per-schema grant to anon and authenticated. PUBLIC's
-- EXECUTE comes from the global default, which a per-schema clause cannot
-- revoke, so a new function would still need its own revoke from public.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
