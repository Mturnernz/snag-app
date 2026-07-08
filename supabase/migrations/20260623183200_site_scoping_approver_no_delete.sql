-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

-- Site-scoped roles + approver delegation + hard block on snag deletion.
--
-- Until now every role saw/edited snags org-wide, "supervisor" wasn't tied
-- to any particular site, and deletion was only blocked inside the 5-year
-- retention window. This migration:
--   1. Introduces site_supervisors so a supervisor owns specific sites.
--   2. Scopes snag visibility/edit rights to site for workers/supervisors
--      (officer_admin keeps org-wide reach).
--   3. Adds remove_site_member so workers can be taken off a site.
--   4. Adds approver delegation for niggle confirmation.
--   5. Makes the no-delete rule unconditional, not just retention-bound.

-- 1. Site ownership ----------------------------------------------------

create table public.site_supervisors (
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (site_id, user_id)
);

create index on public.site_supervisors (user_id);

alter table public.site_supervisors enable row level security;

create policy "org members can view site supervisors"
  on public.site_supervisors for select
  using (
    exists (
      select 1 from public.sites s
      where s.id = site_supervisors.site_id and s.org_id = public.current_org_id()
    )
  );

create function public.assign_site_supervisor(p_site_id uuid, p_user_id uuid)
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

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site', p_site_id, 'supervisor_assigned', auth.uid());
end;
$$;

grant execute on function public.assign_site_supervisor(uuid, uuid) to authenticated;

create function public.remove_site_supervisor(p_site_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can remove a site supervisor';
  end if;
  if not exists (select 1 from public.sites where id = p_site_id and org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;

  delete from public.site_supervisors where site_id = p_site_id and user_id = p_user_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site', p_site_id, 'supervisor_removed', auth.uid());
end;
$$;

grant execute on function public.remove_site_supervisor(uuid, uuid) to authenticated;

-- Helpers used by RLS and RPCs below.

create function public.my_supervised_site_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select site_id from public.site_supervisors where user_id = auth.uid();
$$;

create function public.my_member_site_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select site_id from public.site_members where user_id = auth.uid();
$$;

-- True if the current user may view snags at this site: admin sees the
-- whole org, a supervisor sees sites they supervise, a worker sees sites
-- they belong to.
create function public.can_view_site(p_site_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case public.current_role()
    when 'officer_admin' then exists (
      select 1 from public.sites where id = p_site_id and org_id = public.current_org_id()
    )
    when 'supervisor' then exists (
      select 1 from public.site_supervisors where site_id = p_site_id and user_id = auth.uid()
    )
    else exists (
      select 1 from public.site_members where site_id = p_site_id and user_id = auth.uid()
    )
  end;
$$;

grant execute on function public.can_view_site(uuid) to authenticated;

-- True if the current user may edit snags at this site: admin always,
-- supervisor only for sites they supervise. Workers never qualify here
-- (their snag-editing rights, e.g. resolving their own niggle, are
-- governed by reporter_id/owner_id checks in the relevant RPCs, not this).
create function public.can_edit_site(p_site_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_role() = 'officer_admin'
    or exists (
      select 1 from public.site_supervisors where site_id = p_site_id and user_id = auth.uid()
    );
$$;

grant execute on function public.can_edit_site(uuid) to authenticated;

-- 2. Site-scoped snag visibility ---------------------------------------

drop policy "org members can view their org's snags" on public.snags;

create policy "members can view snags at sites they can see"
  on public.snags for select
  using (org_id = public.current_org_id() and public.can_view_site(site_id));

-- 3. Remove a worker from a site -----------------------------------------

create function public.remove_site_member(p_site_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if not exists (select 1 from public.sites where id = p_site_id and org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;
  if not public.can_edit_site(p_site_id) then
    raise exception 'Only an admin, or a supervisor of this site, can remove someone from it';
  end if;

  delete from public.site_members where site_id = p_site_id and user_id = p_user_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site', p_site_id, 'member_removed', auth.uid());
end;
$$;

grant execute on function public.remove_site_member(uuid, uuid) to authenticated;

-- Let an admin or site supervisor add an existing org member to another
-- site, closing the gap where invites only ever set one site.
create function public.add_site_member(p_site_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if not exists (select 1 from public.sites where id = p_site_id and org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and org_id = v_org_id) then
    raise exception 'That person does not belong to your organisation';
  end if;
  if not public.can_edit_site(p_site_id) then
    raise exception 'Only an admin, or a supervisor of this site, can add someone to it';
  end if;

  insert into public.site_members (site_id, user_id) values (p_site_id, p_user_id)
    on conflict (site_id, user_id) do nothing;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site', p_site_id, 'member_added', auth.uid());
end;
$$;

grant execute on function public.add_site_member(uuid, uuid) to authenticated;

-- 4. Re-scope the existing edit RPCs to site supervision ----------------
-- (officer_admin keeps org-wide rights everywhere via can_edit_site).

create or replace function public.recategorise_snag(
  p_snag_id uuid,
  p_kind public.snag_kind,
  p_severity public.snag_severity default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
  v_was_serious boolean;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if not public.can_edit_site(v_snag.site_id) then
    raise exception 'Only a supervisor of this site, or an admin, can recategorise this snag';
  end if;
  if p_kind in ('hazard', 'incident') and p_severity is null then
    raise exception 'A hazard or incident needs a severity';
  end if;

  v_was_serious := v_snag.lane = 'serious';

  update public.snags
    set kind = p_kind,
        severity = case when p_kind in ('hazard', 'incident') then p_severity else null end
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'recategorised_to_' || p_kind, auth.uid());

  if not v_was_serious and p_kind in ('hazard', 'incident') then
    perform public.dispatch_snag_notification(p_snag_id, 'serious_created');
  end if;
end;
$$;

create or replace function public.update_snag_status(p_snag_id uuid, p_status public.snag_status, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
  v_checklist_count int;
  v_statement_count int;
  v_evidence_count int;
  v_open_actions int;
  v_has_root_cause boolean;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if v_snag.lane <> 'serious' then
    raise exception 'Niggles use resolve_snag / confirm_snag instead';
  end if;
  if not public.can_edit_site(v_snag.site_id) and auth.uid() <> v_snag.owner_id then
    raise exception 'Only the owner, a supervisor of this site, or an admin can change this snag''s status';
  end if;

  if p_status = 'sorted' then
    select count(*) into v_checklist_count from public.checklist_completions where snag_id = p_snag_id;
    select count(*) into v_statement_count from public.witness_statements where snag_id = p_snag_id;
    select count(*) into v_evidence_count from public.evidence_items where snag_id = p_snag_id;
    select count(*) into v_open_actions from public.corrective_actions where snag_id = p_snag_id and status = 'open';
    select exists(select 1 from public.investigations where snag_id = p_snag_id) into v_has_root_cause;

    if v_checklist_count < 5 then
      raise exception 'Finish the first-response checklist before marking this sorted';
    end if;
    if v_statement_count = 0 then
      raise exception 'Add at least one witness statement before marking this sorted';
    end if;
    if v_evidence_count = 0 then
      raise exception 'Add at least one piece of evidence before marking this sorted';
    end if;
    if not v_has_root_cause then
      raise exception 'Record a root cause before marking this sorted';
    end if;
    if v_open_actions > 0 then
      raise exception 'Close every corrective action before marking this sorted';
    end if;
  end if;

  update public.snags
    set status = p_status, resolution_note = coalesce(p_note, resolution_note)
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_' || p_status, auth.uid());
end;
$$;

create or replace function public.require_serious_snag(p_snag_id uuid)
returns public.snags
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = public.current_org_id();
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if v_snag.lane <> 'serious' then
    raise exception 'Only hazard/incident snags have a guided investigation';
  end if;
  if not public.can_edit_site(v_snag.site_id) then
    raise exception 'Only a supervisor of this site, or an admin, can run the investigation';
  end if;
  return v_snag;
end;
$$;

create or replace function public.complete_corrective_action(p_action_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_action public.corrective_actions;
  v_org_id uuid := public.current_org_id();
  v_site_id uuid;
begin
  select ca.* into v_action
    from public.corrective_actions ca
    join public.snags s on s.id = ca.snag_id
    where ca.id = p_action_id and s.org_id = v_org_id;

  if v_action is null then
    raise exception 'Corrective action not found';
  end if;

  select s.site_id into v_site_id from public.snags s where s.id = v_action.snag_id;

  if not public.can_edit_site(v_site_id) and auth.uid() <> v_action.owner_id then
    raise exception 'Only the owner, a supervisor of this site, or an admin can close this action';
  end if;

  update public.corrective_actions set status = 'done', completed_at = now() where id = p_action_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'corrective_action', p_action_id, 'completed', auth.uid());
end;
$$;

create or replace function public.set_notifiable_flag(p_snag_id uuid, p_value boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if not public.can_edit_site(v_snag.site_id) then
    raise exception 'Only a supervisor of this site, or an admin, can set the notifiable flag';
  end if;

  update public.snags set is_notifiable = p_value where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, case when p_value then 'marked_notifiable' else 'unmarked_notifiable' end, auth.uid());
end;
$$;

-- 5. Approver delegation for niggle confirmation -------------------------

alter table public.snags add column approver_id uuid references public.profiles(id);

create function public.delegate_snag_approver(p_snag_id uuid, p_approver_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if not public.can_edit_site(v_snag.site_id) then
    raise exception 'Only a supervisor of this site, or an admin, can delegate an approver';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_approver_id and org_id = v_org_id and role in ('officer_admin', 'supervisor')
  ) then
    raise exception 'The approver must be a supervisor or admin in your organisation';
  end if;

  update public.snags set approver_id = p_approver_id where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'approver_delegated', auth.uid());
end;
$$;

grant execute on function public.delegate_snag_approver(uuid, uuid) to authenticated;

-- confirm_snag now defers to the delegated approver when one is set;
-- otherwise any supervisor/admin who can edit the snag's site may confirm.
create or replace function public.confirm_snag(p_snag_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if v_snag.lane <> 'niggle' then
    raise exception 'Only niggles use the resolve/confirm flow';
  end if;
  if v_snag.status <> 'resolved' then
    raise exception 'This snag has not been resolved yet';
  end if;

  if v_snag.approver_id is not null then
    if auth.uid() <> v_snag.approver_id then
      raise exception 'Only the delegated approver can confirm this niggle is done';
    end if;
  elsif not public.can_edit_site(v_snag.site_id) then
    raise exception 'Only a supervisor of this site, or an admin, can confirm a niggle is done';
  end if;

  update public.snags
    set status = 'sorted', confirmed_by = auth.uid(), confirmed_at = now()
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_sorted', auth.uid());
end;
$$;

-- 6. Deletion is never allowed, full stop --------------------------------

create or replace function public.block_snag_delete_within_retention()
returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Snags can never be deleted — see CLAUDE.md golden rule #4. Flag the snag for review instead.';
end;
$$;

revoke delete on public.snags from anon, authenticated;
