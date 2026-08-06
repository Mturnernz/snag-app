-- Renaming a site, and giving it the location create_site has always accepted.
--
-- `create_site(p_name, p_location)` has taken a location since M1 and no client
-- has ever passed one, so every site in every org has `location is null`. There
-- was also no way to change a name once set: a typo, a depot that gets renamed,
-- or a site created from the work-group sheet's one-field "+ New site" box was
-- permanent. Both gaps only became conspicuous once a site got a detail screen
-- with nothing editable on it.
--
-- Admin-only, matching create_site. A site's *people* are managed by
-- add_site_member / assign_site_supervisor / set_site_default_owner, which draw
-- their own lines; this is the site's own identity, which is the same decision
-- as creating it.

create or replace function public.update_site(
  p_site_id uuid,
  p_name text,
  p_location text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can rename a site';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A site needs a name';
  end if;

  -- org_id in the predicate rather than trusting RLS: this is security definer,
  -- so without it an admin could rename another organisation's site by id.
  update public.sites
     set name = btrim(p_name),
         location = nullif(btrim(coalesce(p_location, '')), '')
   where id = p_site_id
     and org_id = v_org_id;

  if not found then
    raise exception 'Site not found';
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site', p_site_id, 'updated', auth.uid());
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, which is how a
-- freshly-created RPC lands on /rest/v1/rpc/ for `anon` without anyone asking
-- for it — see 20260805100000_relock_internal_functions.sql for the sweep that
-- had to clean up ten of these. Revoke first, then grant the one role that
-- should have it. The admin check inside would refuse an anonymous caller
-- anyway; that is not a reason to publish the endpoint.
revoke execute on function public.update_site(uuid, text, text) from public, anon;
grant execute on function public.update_site(uuid, text, text) to authenticated;
