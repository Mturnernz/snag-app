-- Supervising a site means belonging to it.
--
-- assign_site_supervisor wrote site_supervisors and nothing else, so a
-- supervisor could run a site they were not a member of. Every other path
-- already held the invariant — create_organisation_and_owner makes the creator
-- member, supervisor and default owner in the same breath — which is why this
-- only ever showed up on sites an admin assigned by hand.
--
-- It surfaced through reporting. The report screen's site list is built from
-- site memberships, so a supervisor assigned this way was offered every site in
-- the org (the no-memberships fallback) or, once they belonged to one site,
-- only that one — never the site they actually supervise.
--
-- Membership is the weaker of the two claims and is what the rest of the schema
-- reads for "is this person at this site", so the fix is to add it rather than
-- to teach each reader about site_supervisors as well.

-- ── 1. Backfill ──────────────────────────────────────────────────────────────

insert into public.site_members (site_id, user_id)
select ss.site_id, ss.user_id
from public.site_supervisors ss
where not exists (
  select 1 from public.site_members sm
  where sm.site_id = ss.site_id and sm.user_id = ss.user_id
)
on conflict do nothing;

-- ── 2. Keep it true from here on ─────────────────────────────────────────────

create or replace function public.assign_site_supervisor(p_site_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can assign a site supervisor';
  end if;
  if not exists (select 1 from public.sites where id = p_site_id and org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_user_id and org_id = v_org_id and role = 'supervisor'
  ) then
    raise exception 'That person is not a supervisor in your organisation';
  end if;

  insert into public.site_supervisors (site_id, user_id) values (p_site_id, p_user_id)
    on conflict (site_id, user_id) do nothing;

  -- The new part. Not audited separately: it is part of being made the site's
  -- supervisor, not a second decision an admin made.
  insert into public.site_members (site_id, user_id) values (p_site_id, p_user_id)
    on conflict do nothing;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site', p_site_id, 'supervisor_assigned', auth.uid());
end;
$$;

-- remove_site_supervisor deliberately still leaves membership alone: standing
-- down as a site's supervisor is not the same as leaving the site, and
-- remove_site_member is the RPC for that.
