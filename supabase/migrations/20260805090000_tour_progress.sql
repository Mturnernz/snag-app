-- The guided walkthrough's resume point.
--
-- `has_seen_onboarding` (20260713120000) answered one question — has this
-- person been through onboarding — which was all the welcome screen and the
-- carousel needed, because neither could be half-finished. The walkthrough
-- can: it is ~14 steps for Crew and ~21 for a Manager, it is explicitly
-- pausable, and somebody who stops at step 6 on the way into a meeting should
-- come back to step 6.
--
-- Server-side rather than AsyncStorage because a paused walkthrough should
-- survive a new phone and the web build, both of which are how people actually
-- arrive here. The app keeps a local mirror for the offline case; this is the
-- truth.

alter table public.profiles
  add column tour_step       text,
  add column tour_status     text not null default 'not_started'
    check (tour_status in ('not_started', 'running', 'paused', 'done')),
  add column tour_updated_at timestamptz;

-- Existing members have already been using the app, so starting them on a
-- first-run walkthrough would be an interruption rather than an introduction.
-- Anyone who got the old carousel is treated as done; they can still replay it
-- from Profile.
update public.profiles set tour_status = 'done' where has_seen_onboarding;

-- 20260803120000 revoked update on profiles from authenticated except (name),
-- so this needs its own definer, the same shape as mark_onboarding_seen.
create function public.set_tour_progress(p_status text, p_step text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('not_started', 'running', 'paused', 'done') then
    raise exception 'Unknown walkthrough status: %', p_status;
  end if;

  update public.profiles
     set tour_status      = p_status,
         -- A finished or unstarted walkthrough has no resume point; keeping a
         -- stale one would resume somebody mid-way through a replay.
         tour_step        = case when p_status in ('running', 'paused') then p_step else null end,
         tour_updated_at  = now(),
         -- "Has been onboarded" stays one fact, now settled by the walkthrough
         -- finishing rather than by the carousel being dismissed.
         has_seen_onboarding = has_seen_onboarding or p_status = 'done'
   where id = auth.uid();
end;
$$;

-- New functions are born EXECUTE-to-PUBLIC, and the ALTER DEFAULT PRIVILEGES
-- guard from 20260712090000 is recorded per creating role — so it only covers
-- functions created by the role that ran it, which is exactly the drift
-- 20260803120200 was written to resweep. Revoke before granting, or this
-- arrives anon-callable at /rest/v1/rpc/set_tour_progress. It is not
-- exploitable (auth.uid() is null for anon, so the update matches no row) but
-- that is luck, not design, and it is the pattern that resweep found twice.
revoke execute on function public.set_tour_progress(text, text) from public, anon;
grant execute on function public.set_tour_progress(text, text) to authenticated;
