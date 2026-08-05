-- Re-lock the internal functions that 20260803120200 handed back to
-- `authenticated`.
--
-- That migration swept the schema revoking EXECUTE from `public, anon` and then
-- granting it to `authenticated` for everything not on a three-name allow-list
-- of genuinely anon-facing on-ramps. The sweep was right about anon. It was
-- wrong about `authenticated`, because "not anon-facing" and "safe for any
-- signed-in user to call" are different questions, and it only asked the first.
--
-- So it silently undid 20260621051648_m3_lock_down_internal_functions.sql,
-- which had revoked exactly these six weeks earlier, and caught four more
-- functions written since. Ten in total were reachable at
-- /rest/v1/rpc/<name> by anyone with an account:
--
--   apply_default_owner, notify_after_snag_insert, notify_after_snag_update,
--   enforce_snag_merge_invariants, block_snag_delete_within_retention
--       — trigger functions. Callable directly they run with no trigger
--         context, so NEW/OLD are unset and they either error or act on
--         nothing; the point is that none of them is anybody's API.
--
--   dispatch_snag_notification, dispatch_rca_notification,
--   dispatch_overdue_actions_digest
--       — make the system send email. A signed-in user could mail an
--         organisation's supervisors an arbitrary snag's details on demand,
--         and repeatedly.
--
--   run_overdue_actions_digest
--       — the same, fanned out across every org in the database at once.
--
--   run_retention_minimisation
--       — the worst of them, and not an email at all: it is the scheduled
--         data-minimisation job. Running it off-schedule is destructive, and
--         no role check stands in front of it because until 20260803120200
--         nothing could reach it.
--
-- None of this needed a privilege-escalation bug. The grant was the bug.

-- Done as a sweep rather than ten named revokes, so a trigger function added
-- later is covered without anyone remembering to come back here. Trigger
-- functions are identified by return type, which is not a naming convention
-- anyone can drift away from.
--
-- Revoking EXECUTE on a trigger function does not stop its trigger firing:
-- EXECUTE is checked when the trigger is *created*, not when it fires. That is
-- not a reading of the docs — 20260621051648 revoked these same five and the
-- app ran on them for the six weeks until the resweep put them back.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
      and (
        pg_get_function_result(p.oid) = 'trigger'
        -- The internal job/dispatch layer. Named explicitly: `dispatch_%` and
        -- `run_%` are the conventions this schema already uses for "called by
        -- a trigger, an RPC or cron — never by a client", and every function
        -- matching them today is internal.
        or p.proname like 'dispatch\_%'
        or p.proname like 'run\_%'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- A note for whoever writes the next sweep, because this has now been undone
-- once already: re-running 20260803120200 verbatim will undo it again. That
-- file's loop grants `authenticated` everything outside its `anon_ok` list,
-- and its list answers "may a signed-out visitor call this?" — a different
-- question from "may a signed-in user call this?". A sweep that grants needs
-- both lists. A sweep that only revokes needs neither, which is why this one
-- only revokes.
