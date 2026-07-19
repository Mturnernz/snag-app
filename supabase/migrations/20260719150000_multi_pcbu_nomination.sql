-- Multi-PCBU notification nomination (Governance & Contractors, Phase 3).
--
-- HSWA needs only one notification per event even where multiple PCBUs are
-- involved (e.g. a contractor on a customer's site), but all remain
-- responsible for it happening — this records which PCBU took it on.
--
-- site_members has no org context per row (a contractor's membership row
-- doesn't say which of their orgs they're present under), so there's no
-- clean way to auto-derive "which orgs share this site." Instead this
-- supports two ways to record the notifying PCBU: pick one of the current
-- user's own other organisations (via existing org_memberships — a
-- realistic case for someone who works across two Snag orgs), or a
-- free-text name for a PCBU that isn't itself a Snag customer. Exactly one
-- of the two is stored at a time.

alter table public.snags
  add column notifying_org_id uuid references public.organisations(id),
  add column notifying_pcbu_note text;

create function public.nominate_notifying_pcbu(p_snag_id uuid, p_org_id uuid default null, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if not exists (select 1 from public.snags where id = p_snag_id and org_id = v_org_id) then
    raise exception 'Snag not found';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can nominate the notifying PCBU';
  end if;
  if p_org_id is null and (p_note is null or btrim(p_note) = '') then
    raise exception 'Provide either an organisation or a name for the notifying PCBU';
  end if;

  update public.snags
    set notifying_org_id = p_org_id,
        notifying_pcbu_note = case when p_org_id is null then btrim(p_note) else null end
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'notifying_pcbu_nominated', auth.uid());
end;
$$;

grant execute on function public.nominate_notifying_pcbu(uuid, uuid, text) to authenticated;
revoke execute on function public.nominate_notifying_pcbu(uuid, uuid, text) from public, anon;

-- Surface the new columns (plus the nominated org's name) on the app's
-- central read view. Identical to the prior definition
-- (20260719120000_notifiable_event_tracking.sql) except for the new left
-- join and the three columns appended at the end (CREATE OR REPLACE VIEW
-- requires existing columns to keep their ordinal position).
create or replace view public.snags_with_details as
select
  s.id,
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
  coalesce(v.downvote_count, 0::bigint) as downvote_count,
  s.photo_paths,
  s.is_public_submission,
  s.parent_snag_id,
  s.merged_by,
  s.merged_at,
  coalesce(children.child_count, 0::bigint) as child_count,
  s.work_group_id,
  s.notifiable_marked_by,
  s.notifiable_marked_at,
  s.notifying_org_id,
  s.notifying_pcbu_note,
  notifying_org.name as notifying_org_name
from snags s
  left join profiles reporter on reporter.id = s.reporter_id
  left join profiles owner on owner.id = s.owner_id
  left join sites site on site.id = s.site_id
  left join organisations notifying_org on notifying_org.id = s.notifying_org_id
  left join (
    select checklist_completions.snag_id, count(*) as completed_count
    from checklist_completions group by checklist_completions.snag_id
  ) cc on cc.snag_id = s.id
  left join (
    select evidence_items.snag_id, count(*) as evidence_count
    from evidence_items group by evidence_items.snag_id
  ) ev on ev.snag_id = s.id
  left join (
    select corrective_actions.snag_id, count(*) as open_count
    from corrective_actions
    where not (corrective_actions.status = 'done'::corrective_action_status and corrective_actions.verified_by is not null)
    group by corrective_actions.snag_id
  ) ca on ca.snag_id = s.id
  left join (
    select comments.snag_id, count(*) as comment_count
    from comments group by comments.snag_id
  ) cm on cm.snag_id = s.id
  left join (
    select votes.snag_id, sum(votes.value) as vote_score,
      count(*) filter (where votes.value = 1) as upvote_count,
      count(*) filter (where votes.value = '-1'::integer) as downvote_count
    from votes group by votes.snag_id
  ) v on v.snag_id = s.id
  left join (
    select snags2.parent_snag_id, count(*) as child_count
    from snags snags2 where snags2.parent_snag_id is not null
    group by snags2.parent_snag_id
  ) children on children.parent_snag_id = s.id;

alter view public.snags_with_details set (security_invoker = true);

grant select on public.snags_with_details to anon, authenticated, service_role;
