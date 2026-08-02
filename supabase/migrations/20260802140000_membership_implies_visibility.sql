-- Belonging to a site means being able to see it.
--
-- can_view_site asked three different questions depending on role: an
-- officer_admin got any site in the org, a worker got the sites they are a
-- member of — and a supervisor got only the sites they are recorded against in
-- site_supervisors, with membership never consulted at all.
--
-- So a supervisor who belongs to a site they do not personally supervise saw
-- *less there than a worker standing next to them*. Promotion took read access
-- away. Nobody designed that; it falls out of the supervisor branch asking the
-- stronger question and then not falling back to the weaker one.
--
-- 20260801120000_supervising_implies_membership.sql already wrote the principle
-- down — "membership is the weaker of the two claims and is what the rest of
-- the schema reads for 'is this person at this site', so the fix is to add it
-- rather than to teach each reader about site_supervisors as well". can_view_site
-- is the one reader that never got the message.
--
-- How it presented, which is worse than a missing list: in an org whose one open
-- injury was reported by somebody else, the reporting supervisor's snag list
-- showed only snags they had filed themselves, and the "Needs attention" strip —
-- which exists precisely so an open injury cannot scroll away — queried for open
-- injuries, was handed zero rows by RLS, and rendered nothing. There is no error
-- state for a policy that filters a row out. The screen looks calm and is wrong.
--
-- Scope of the change:
--   * Read only. can_edit_site is a separate function and is untouched, so
--     triage, assignment and every investigation write still require a real
--     site_supervisors row. A supervisor gains sight of their site, not command
--     of it.
--   * One policy consumes can_view_site — "members can view snags at sites they
--     can see" on public.snags — and that policy still ANDs org_id =
--     current_org_id() and the is_org_active check, so nothing here crosses an
--     org boundary or revives an inactive one.
--   * Strictly a widening. site_supervisors is still checked alongside
--     site_members rather than replaced by it: the backfill above made every
--     supervisor a member, but a row inserted by some other path since then
--     must not silently lose access to prove a point about invariants.

create or replace function public.can_view_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select case
    when public.current_role() = 'officer_admin' then exists (
      select 1 from public.sites where id = p_site_id and org_id = public.current_org_id()
    )
    else exists (
      select 1 from public.site_members where site_id = p_site_id and user_id = auth.uid()
    ) or exists (
      select 1 from public.site_supervisors where site_id = p_site_id and user_id = auth.uid()
    )
  end;
$function$;
