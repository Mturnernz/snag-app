-- Re-run the anon/PUBLIC execute revoke, and catch what has drifted since.
--
-- 20260712090000_security_hardening_pass.sql swept the schema revoking EXECUTE
-- from `public, anon` and then set ALTER DEFAULT PRIVILEGES so that new
-- functions would not be born anon-callable. That guard is recorded *per
-- creating role*, so it only ever covered functions created by the role that
-- ran it; anything applied since by another role slipped straight past it.
--
-- Two had, both writes, both reachable at /rest/v1/rpc/<name>:
--
--   add_serious_incident_owner(uuid)      (20260730000000)
--   remove_serious_incident_owner(uuid)   (20260730000000)
--
-- Neither is exploitable today, and the reason is worth writing down because
-- it is luck rather than design: both read `current_org_id()` into a variable
-- and raise when it is null, which it always is for anon. The role check
-- underneath would not have stopped anyone —
--
--   if public.current_role() not in ('supervisor', 'officer_admin')
--
-- is NULL for a caller with no membership, NULL is not true, and so the
-- `raise` never fires. A function that checks only the role, in the order most
-- of this schema writes it, is anon-callable the moment it drifts.
--
-- The three genuinely anon-facing functions keep their grant. Each is a
-- signed-out on-ramp — an invite link, a company code typed at sign-up, a
-- scanned site QR — and each returns only what the holder of that token
-- already has.

do $$
declare
  f record;
  anon_ok constant text[] := array[
    'get_invite_preview',
    'get_org_by_join_code',
    'get_site_by_public_token'
  ];
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and not (p.proname = any (anon_ok))
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- Re-assert the default for this role too. It is not a substitute for the
-- sweep above — it binds to whichever role runs this file, so a migration
-- applied as a different role can still create an anon-callable function.
-- Treat the sweep as the thing that holds and re-run it after adding RPCs.
alter default privileges in schema public revoke execute on functions from public;
