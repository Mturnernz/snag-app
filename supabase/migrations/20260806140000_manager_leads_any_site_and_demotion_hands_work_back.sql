-- A Manager outranks a Site Lead, so the app should let one be named as the
-- Site Lead — and a demotion out of a directing role should take the rows that
-- grant it, and hand the work back to whoever made the call.
--
-- Three separate things were wrong, and they compound.
--
-- ── 1. assign_site_supervisor refused an officer_admin ──────────────────────
--
-- Its eligibility test was `role = 'supervisor'`, an exact match, so naming a
-- Manager as a site's lead raised "That person is not a supervisor in your
-- organisation". assign_work_group_supervisor carried the identical test.
--
-- The schema does not agree with that rule and never has:
-- create_organisation_and_owner writes site_members, site_supervisors and
-- site_default_owners for the org's creator — an officer_admin — in one breath.
-- At the time of writing, six of the eight sites in Snagv1 have an
-- officer_admin sitting in site_supervisors, every one of them put there by
-- that function. The RPC was refusing to create a state the rest of the schema
-- creates by default.
--
-- Nothing was gained by refusing. can_edit_site short-circuits on
-- officer_admin, as do get_site_assignees and assign_snag_owner, so the row
-- confers no privilege a Manager did not already hold org-wide. What it
-- carries is the *claim*: this named person leads this site. Which is what
-- SiteDetail's "No Site Lead — nobody here can triage a serious report or run
-- its investigation" banner and the admin dashboard's "Sites with no site
-- lead" tile are actually asking about. In a one-Manager org both were
-- unclearable — and worse, they were false, because the Manager reading them
-- could do every one of the things they said nobody could. A warning with no
-- way to clear it teaches people to ignore the tile.
--
-- The toggle also made it a one-way door: remove_site_supervisor has no role
-- test, so a Manager could turn their own Site Lead row off and then not turn
-- it back on. Snagv1's "Snag" org is sitting in exactly that state — Main site
-- at 0 members, 0 Site Leads, audit_log showing supervisor_removed with no
-- matching assign after it.
--
-- Both checks additionally read profiles.role, which is a *mirror of the
-- user's active org* (see the comment above getOrgMembers in
-- apps/mobile/src/lib/supabase.ts). For a multi-org member whose active org is
-- some other org, that test was answering the question about the wrong
-- organisation. Both now read org_memberships for the org being edited.
--
-- ── 2. update_member_role left the directing rows behind ────────────────────
--
-- It updated org_memberships and profiles and stopped. site_supervisors,
-- work_group_supervisors and serious_incident_owners were untouched, so
-- demoting a Site Lead to Crew left every row that grants site command in
-- place — and can_edit_site consults site_supervisors without looking at the
-- person's role at all. Demotion took the title and left the access. (No org
-- in Snagv1 is in that state today; this is the door, not the fire.)
--
-- serious_incident_owners is the sharpest edge of the three, because being
-- left there is worse than useless: apply_default_owner would go on assigning
-- the demoted person every incident that arrives without an owner, and
-- require_investigation_access would then refuse them the investigation. An
-- owner the RPCs reject. They are transferred rather than simply deleted —
-- remove_serious_incident_owner refuses to remove the last one for good
-- reason, so the actor is added first and the invariant never dips.
--
-- site_members is deliberately *kept*. Membership is the weaker claim and says
-- only "this person is at this site", which a demotion does not change —
-- the same distinction remove_site_supervisor has drawn since 20260623183200.
--
-- ── 3. Nobody inherited the work ────────────────────────────────────────────
--
-- A demoted Site Lead kept every snag assigned to them, including serious ones
-- they can no longer direct, and the site default-owner rows that would keep
-- sending them more. Open snags now move to the actor, and so do their
-- site_default_owners rows — deleting those instead would just move the
-- problem to the dashboard's "sites with no default owner" tile.
--
-- Resolved snags keep their owner. Who closed a snag is a record of what
-- happened, not an assignment anyone still has to act on, and rewriting it to
-- name someone who was not there falsifies the file.
--
-- The lead_investigator_id of an investigation in flight is also left alone,
-- on purpose: require_investigation_access admits the assigned investigator
-- whatever their role, precisely so the person doing the work can finish it.
-- Doing survives a demotion; directing does not.

-- ── Eligibility: a Manager may hold a lead row ───────────────────────────────

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
    select 1 from public.org_memberships
    where user_id = p_user_id and org_id = v_org_id and removed_at is null
      and role in ('supervisor', 'officer_admin')
  ) then
    raise exception 'Only a Site Lead or a Manager can lead a site';
  end if;

  insert into public.site_supervisors (site_id, user_id) values (p_site_id, p_user_id)
    on conflict (site_id, user_id) do nothing;

  -- Supervising a site means belonging to it (20260801120000). Not audited
  -- separately: it is part of being made the site's lead, not a second
  -- decision an admin made.
  insert into public.site_members (site_id, user_id) values (p_site_id, p_user_id)
    on conflict do nothing;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site', p_site_id, 'supervisor_assigned', auth.uid());
end;
$$;

create or replace function public.assign_work_group_supervisor(p_work_group_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin'
     and not (public.current_role() = 'supervisor' and p_user_id = auth.uid()) then
    raise exception 'Only an admin can assign a work group supervisor, or a supervisor can self-assign';
  end if;
  if not exists (select 1 from public.work_groups where id = p_work_group_id and org_id = v_org_id and deleted_at is null) then
    raise exception 'That work group does not belong to your organisation';
  end if;
  if not exists (
    select 1 from public.org_memberships
    where user_id = p_user_id and org_id = v_org_id and removed_at is null
      and role in ('supervisor', 'officer_admin')
  ) then
    raise exception 'Only a Site Lead or a Manager can lead a work group';
  end if;

  insert into public.work_group_supervisors (work_group_id, user_id) values (p_work_group_id, p_user_id)
    on conflict (work_group_id, user_id) do nothing;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'work_group', p_work_group_id, 'supervisor_assigned', auth.uid());
end;
$$;

-- ── Demotion: take the access, take the work ─────────────────────────────────

-- Returns the number of open snags handed to the caller, so the client can say
-- so rather than leaving someone to discover it in their own list. The return
-- type changes, hence drop-and-create; the grant has to be restated with it.
drop function if exists public.update_member_role(uuid, public.user_role);

create function public.update_member_role(p_member_id uuid, p_role public.user_role)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_old public.user_role;
  v_reassigned integer := 0;
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'only officer_admin can change member roles';
  end if;
  if p_member_id = auth.uid() then
    raise exception 'cannot change your own role';
  end if;

  select role into v_old from public.org_memberships
    where user_id = p_member_id and org_id = v_org_id and removed_at is null;
  if v_old is null then
    raise exception 'member not found in your organisation';
  end if;

  update public.org_memberships set role = p_role
    where user_id = p_member_id and org_id = v_org_id;

  -- sync the mirror only if this org is the member's active org
  update public.profiles set role = p_role
    where id = p_member_id and org_id = v_org_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'member', p_member_id, 'role_changed_to_' || p_role::text, auth.uid());

  -- Everything below is about losing the ability to direct. A promotion, or a
  -- move between the two directing roles, leaves all of it alone: an
  -- officer_admin dropping to supervisor keeps their site_supervisors rows
  -- because those are exactly what still grants them their sites.
  if not (v_old in ('supervisor', 'officer_admin') and p_role = 'worker') then
    return 0;
  end if;

  -- The rows that grant site command. site_members stays: being at a site is
  -- not a claim to run it.
  delete from public.site_supervisors ss
    using public.sites s
    where ss.user_id = p_member_id and s.id = ss.site_id and s.org_id = v_org_id;

  delete from public.work_group_supervisors ws
    using public.work_groups wg
    where ws.user_id = p_member_id and wg.id = ws.work_group_id and wg.org_id = v_org_id;

  -- Transferred, not dropped — there has to be at least one at all times, so
  -- the actor goes in before the demoted member comes out.
  if exists (
    select 1 from public.serious_incident_owners
    where org_id = v_org_id and profile_id = p_member_id
  ) then
    insert into public.serious_incident_owners (org_id, profile_id, added_by)
      values (v_org_id, auth.uid(), auth.uid())
      on conflict (org_id, profile_id) do nothing;

    delete from public.serious_incident_owners
      where org_id = v_org_id and profile_id = p_member_id;

    insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
      values (v_org_id, 'organisation', v_org_id, 'serious_incident_owner_removed', auth.uid());
  end if;

  -- Standing recipient of everything filed at a site. Moved rather than
  -- deleted: a site with no default owner is its own gap, and the admin
  -- dashboard has a tile counting them.
  update public.site_default_owners d
    set owner_id = auth.uid(), updated_at = now()
    from public.sites s
    where d.site_id = s.id and s.org_id = v_org_id and d.owner_id = p_member_id;

  -- Open work. Resolved snags keep their owner — that is a record, not a job.
  update public.snags
    set owner_id = auth.uid()
    where org_id = v_org_id and owner_id = p_member_id and status <> 'resolved';
  get diagnostics v_reassigned = row_count;

  if v_reassigned > 0 then
    insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
      values (v_org_id, 'member', p_member_id, 'snags_reassigned_on_demotion', auth.uid());
  end if;

  return v_reassigned;
end;
$$;

-- The revoke is not decoration. A freshly *created* function takes Supabase's
-- default privileges — EXECUTE to PUBLIC, and to anon — where a replaced one
-- keeps the ACL it already had. So dropping and recreating this quietly put a
-- role-change RPC on /rest/v1/rpc/ for signed-out callers, which is the same
-- accident 20260803120200 had with run_retention_minimisation. Verified after
-- applying: postgres | authenticated | service_role, matching remove_org_member.
revoke execute on function public.update_member_role(uuid, public.user_role) from public, anon;
grant execute on function public.update_member_role(uuid, public.user_role) to authenticated;

-- ── Don't email someone about a snag they assigned to themselves ─────────────
--
-- The demotion above can move a dozen snags in one statement, and the new
-- owner is by construction the person who just pressed the button — so the
-- trigger as written would mail them a dozen times to tell them what they had
-- just done. 20260803193000 already declined to notify on the same grounds
-- ("nobody needs assigning to finished work"); this is the same argument about
-- the same person on both ends of the assignment, and it applies equally to a
-- supervisor picking their own name in assign_snag_owner.
create or replace function public.notify_after_snag_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null
     and new.owner_id is distinct from old.owner_id
     and new.status <> 'resolved'
     and new.owner_id is distinct from auth.uid() then
    perform public.dispatch_snag_notification(new.id, 'niggle_assigned');
  end if;
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    perform public.dispatch_snag_notification(new.id, 'snag_resolved');
  end if;
  return new;
end;
$$;

-- notify_after_snag_update is a trigger function and callable by nobody; the
-- sweep in 20260805100000 covers it by return type, but create-or-replace does
-- not re-grant, so there is nothing to revoke here.
