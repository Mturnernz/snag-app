-- Collapse the two-step niggle resolve->confirm workflow into a single
-- 'resolved' terminal status. 'sorted' is retired entirely: existing rows
-- are migrated to 'resolved', the enum value is dropped, confirm_snag() is
-- removed, and update_snag_status()/notify_after_snag_update() now gate on
-- and dispatch 'resolved' instead of 'sorted'.

-- 1. Migrate existing data while the old enum value is still valid.
update public.snags set status = 'resolved' where status = 'sorted';

-- 2. Drop objects that depend on the snag_status type/column so it can be
--    altered (view depends on the column; this function takes the enum as
--    a parameter type).
drop view public.snags_with_details;
drop function public.update_snag_status(uuid, public.snag_status, text);
drop function public.confirm_snag(uuid);

-- 3. Recreate the enum without 'sorted' (Postgres can't drop an enum value
--    in place).
alter type public.snag_status rename to snag_status_old;
create type public.snag_status as enum ('flagged', 'in_progress', 'resolved', 'rca_pending');

alter table public.snags alter column status drop default;
alter table public.snags
  alter column status type public.snag_status
  using status::text::public.snag_status;
alter table public.snags alter column status set default 'flagged'::public.snag_status;

drop type public.snag_status_old;

-- 4. Recreate update_snag_status: serious-lane snags now reach 'resolved'
--    directly once the investigation is complete (same gating checks as
--    the old 'sorted' target, just renamed).
create function public.update_snag_status(p_snag_id uuid, p_status public.snag_status, p_note text default null)
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
    raise exception 'Niggles use resolve_snag instead';
  end if;
  if p_status = 'rca_pending' then
    raise exception 'rca_pending is set automatically when an RCA is assigned';
  end if;
  if v_snag.status = 'rca_pending' then
    raise exception 'This snag has an RCA in progress — accept or reject it first';
  end if;
  if not public.can_edit_site(v_snag.site_id) and auth.uid() <> v_snag.owner_id then
    raise exception 'Only the owner, a supervisor of this site, or an admin can change this snag''s status';
  end if;

  if p_status = 'resolved' then
    select count(*) into v_checklist_count from public.checklist_completions where snag_id = p_snag_id;
    select count(*) into v_statement_count from public.witness_statements where snag_id = p_snag_id;
    select count(*) into v_evidence_count from public.evidence_items where snag_id = p_snag_id;
    select count(*) into v_open_actions from public.corrective_actions where snag_id = p_snag_id and status = 'open';
    select exists(select 1 from public.investigations where snag_id = p_snag_id) into v_has_root_cause;

    if v_checklist_count < 5 then
      raise exception 'Finish the first-response checklist before marking this resolved';
    end if;
    if v_statement_count = 0 then
      raise exception 'Add at least one witness statement before marking this resolved';
    end if;
    if v_evidence_count = 0 then
      raise exception 'Add at least one piece of evidence before marking this resolved';
    end if;
    if not v_has_root_cause then
      raise exception 'Record a root cause before marking this resolved';
    end if;
    if v_open_actions > 0 then
      raise exception 'Close every corrective action before marking this resolved';
    end if;
  end if;

  update public.snags
    set status = p_status, resolution_note = coalesce(p_note, resolution_note)
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_' || p_status, auth.uid());
end;
$$;

grant execute on function public.update_snag_status(uuid, public.snag_status, text) to authenticated;

-- 5. Recreate snags_with_details identically (status column now the new type).
create view public.snags_with_details as
 select s.id,
    s.reference,
    s.org_id,
    s.site_id,
    s.reporter_id,
    s.kind,
    s.lane,
    s.severity,
    s.description,
    s.photo_path,
    s.occurred_at,
    s.latitude,
    s.longitude,
    s.status,
    s.created_at,
    s.owner_id,
    s.assigned_at,
    s.resolution_note,
    s.retained_until,
    s.is_notifiable,
    s.resolved_by,
    s.resolved_at,
    s.confirmed_by,
    s.confirmed_at,
    s.escalated_by,
    s.escalated_at,
    s.approver_id,
    reporter.name as reporter_name,
    reporter.email as reporter_email,
    owner.name as owner_name,
    site.name as site_name,
    coalesce(cc.completed_count, 0::bigint) as checklist_completed_count,
    coalesce(ev.evidence_count, 0::bigint) as evidence_count,
    coalesce(ca.open_count, 0::bigint) as open_corrective_action_count,
    coalesce(cm.comment_count, 0::bigint) as comment_count,
    coalesce(v.vote_score, 0::bigint) as vote_score,
    coalesce(v.upvote_count, 0::bigint) as upvote_count,
    coalesce(v.downvote_count, 0::bigint) as downvote_count
   from (((((((( public.snags s
     left join public.profiles reporter on reporter.id = s.reporter_id)
     left join public.profiles owner on owner.id = s.owner_id)
     left join public.sites site on site.id = s.site_id)
     left join ( select checklist_completions.snag_id,
            count(*) as completed_count
           from public.checklist_completions
          group by checklist_completions.snag_id) cc on cc.snag_id = s.id)
     left join ( select evidence_items.snag_id,
            count(*) as evidence_count
           from public.evidence_items
          group by evidence_items.snag_id) ev on ev.snag_id = s.id)
     left join ( select corrective_actions.snag_id,
            count(*) as open_count
           from public.corrective_actions
          where corrective_actions.status = 'open'::public.corrective_action_status
          group by corrective_actions.snag_id) ca on ca.snag_id = s.id)
     left join ( select comments.snag_id,
            count(*) as comment_count
           from public.comments
          group by comments.snag_id) cm on cm.snag_id = s.id)
     left join ( select votes.snag_id,
            sum(votes.value) as vote_score,
            count(*) filter (where votes.value = 1) as upvote_count,
            count(*) filter (where votes.value = '-1'::integer) as downvote_count
           from public.votes
          group by votes.snag_id) v on v.snag_id = s.id);

grant select on public.snags_with_details to anon, authenticated, service_role;

-- 6. The RCA lifecycle also reads/writes 'sorted' directly on snags
--    (assign_rca requires a 'sorted' snag before starting an RCA;
--    accept_rca/cancel_rca return the snag to 'sorted' when the RCA closes)
--    — all three now target 'resolved' instead.
create or replace function public.assign_rca(p_snag_id uuid, p_assignee_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
  v_id uuid;
begin
  if v_snag.status <> 'resolved' then
    raise exception 'An RCA can only be assigned on a resolved snag';
  end if;
  if not exists (select 1 from public.profiles where id = p_assignee_id and org_id = v_snag.org_id) then
    raise exception 'That person does not belong to your organisation';
  end if;

  insert into public.snag_rca (snag_id, assigned_to, assigned_by)
    values (p_snag_id, p_assignee_id, auth.uid())
    returning id into v_id;

  update public.snags set status = 'rca_pending' where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'rca_assigned', auth.uid());

  perform public.dispatch_rca_notification(v_id, 'rca_assigned');

  return v_id;
end;
$$;

create or replace function public.accept_rca(p_rca_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rca public.snag_rca;
  v_snag public.snags;
begin
  select * into v_rca from public.snag_rca where id = p_rca_id;
  if v_rca is null then
    raise exception 'RCA not found';
  end if;
  v_snag := public.require_serious_snag(v_rca.snag_id);
  if v_rca.status <> 'submitted' then
    raise exception 'Only a submitted RCA can be accepted';
  end if;

  update public.snag_rca
    set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
    where id = p_rca_id;

  update public.snags set status = 'resolved' where id = v_snag.id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_rca', p_rca_id, 'accepted', auth.uid());
end;
$$;

create or replace function public.cancel_rca(p_rca_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rca public.snag_rca;
  v_snag public.snags;
begin
  select * into v_rca from public.snag_rca where id = p_rca_id;
  if v_rca is null then
    raise exception 'RCA not found';
  end if;
  select * into v_snag from public.snags where id = v_rca.snag_id and org_id = public.current_org_id();
  if v_snag is null then
    raise exception 'RCA not found';
  end if;
  if not public.can_edit_site(v_snag.site_id) then
    raise exception 'Only a supervisor of this site, or an admin, can cancel an RCA';
  end if;
  if v_rca.status in ('accepted', 'cancelled') then
    raise exception 'This RCA is already closed';
  end if;

  update public.snag_rca set status = 'cancelled' where id = p_rca_id;

  update public.snags set status = 'resolved'
    where id = v_snag.id and status = 'rca_pending';

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_rca', p_rca_id, 'cancelled', auth.uid());
end;
$$;

-- 7. The 'resolved' transition is now the terminal notification event for
--    both lanes (previously 'snag_sorted', only fired for the old 'sorted'
--    transition).
create or replace function public.notify_after_snag_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null and new.owner_id is distinct from old.owner_id then
    perform public.dispatch_snag_notification(new.id, 'niggle_assigned');
  end if;
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    perform public.dispatch_snag_notification(new.id, 'snag_resolved');
  end if;
  return new;
end;
$$;
