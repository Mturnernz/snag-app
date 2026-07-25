-- PRODUCT_REVIEW.md §3.1 — make outstanding root-cause analysis measurable.
--
-- Background: assign_rca requires status = 'resolved', so an RCA is
-- post-resolution work by design. get_site_breakdown counted work purely by
-- snag status, so a serious snag resolved *without* a completed RCA matched
-- no column at all and was invisible to both dashboards — while its own
-- detail screen showed a permanently pending "Root Cause — Not started" step.
--
-- Two halves to the fix:
--   1. An explicit waiver, so "no 5-Whys needed here" is a recorded decision
--      rather than an absence. Without this the new count reads every serious
--      snag ever closed and gets ignored.
--   2. An rca_outstanding measure that respects the waiver.

-- ─── 1. Waiver columns ──────────────────────────────────────────────────────

alter table public.snags
  add column rca_waived_by uuid references public.profiles(id),
  add column rca_waived_at timestamptz,
  add column rca_waived_reason text;

comment on column public.snags.rca_waived_reason is
  'Why a formal root-cause analysis was judged unnecessary on this serious snag. Set via waive_rca; cleared by unwaive_rca, by assign_rca, and on reopen.';

-- Partial index — the rca_outstanding subquery below filters on
-- "rca_waived_at is null", and only serious snags are ever candidates.
create index snags_rca_outstanding_idx
  on public.snags (org_id, site_id)
  where lane = 'serious' and rca_waived_at is null and parent_snag_id is null;

-- ─── 2. Waive / unwaive ─────────────────────────────────────────────────────

-- Supervisor of the site, or an admin — same gate as the rest of the serious
-- lane (require_serious_snag → can_edit_site). Deliberately NOT allowed while
-- an RCA is in flight: rca_pending means someone is actively working on one,
-- and cancel_rca is the way to abandon that (it leaves an audit trail and
-- returns the snag to resolved, at which point it can be waived).
create function public.waive_rca(p_snag_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Give a reason why no root-cause analysis is needed';
  end if;
  if v_snag.status <> 'resolved' then
    raise exception 'Only a resolved snag can have its root-cause analysis waived';
  end if;
  if v_snag.rca_waived_at is not null then
    raise exception 'Root-cause analysis is already waived on this snag';
  end if;
  if exists (select 1 from public.snag_rca where snag_id = p_snag_id and status = 'accepted') then
    raise exception 'This snag already has a completed root-cause analysis';
  end if;

  update public.snags
    set rca_waived_by = auth.uid(),
        rca_waived_at = now(),
        rca_waived_reason = btrim(p_reason)
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'rca_waived', auth.uid());
end;
$$;

create function public.unwaive_rca(p_snag_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
begin
  if v_snag.rca_waived_at is null then
    raise exception 'Root-cause analysis is not waived on this snag';
  end if;

  update public.snags
    set rca_waived_by = null, rca_waived_at = null, rca_waived_reason = null
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'rca_unwaived', auth.uid());
end;
$$;

grant execute on function public.waive_rca(uuid, text) to authenticated;
grant execute on function public.unwaive_rca(uuid) to authenticated;
revoke execute on function public.waive_rca(uuid, text) from public, anon;
revoke execute on function public.unwaive_rca(uuid) from public, anon;

-- ─── 3. Assigning an RCA supersedes a waiver ────────────────────────────────
-- Otherwise a snag could be both waived and under analysis, and the
-- rca_outstanding count would hide the in-flight RCA.

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

  -- Clear any waiver — a real analysis takes precedence over "not needed".
  update public.snags
    set status = 'rca_pending',
        rca_waived_by = null, rca_waived_at = null, rca_waived_reason = null
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'rca_assigned', auth.uid());

  perform public.dispatch_rca_notification(v_id, 'rca_assigned');

  return v_id;
end;
$$;

-- ─── 4. get_site_breakdown: add rca_outstanding ─────────────────────────────
--
-- Also fixes a pre-existing inconsistency: the snag-based counts included
-- merged children, while every drill-down list that reads them
-- (getUnassignedSnags, the web snags page) filters to parent_snag_id is null.
-- A site could report "Unassigned: 3" and expand to show one row. Children are
-- duplicates rolled into their parent, so they are now excluded from all three
-- snag counts, matching the lists.

drop function if exists public.get_site_breakdown(uuid);

create function public.get_site_breakdown(p_org_id uuid)
returns table (
  site_id uuid,
  site_name text,
  open_investigations bigint,
  unassigned bigint,
  overdue_actions bigint,
  rca_outstanding bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  -- `null is distinct from null` is false, so an explicit null check is needed
  -- for this guard to fail closed for a caller with no active org.
  if p_org_id is null or p_org_id is distinct from public.current_org_id() then
    raise exception 'Site breakdown is only available for your active organisation';
  end if;

  return query
  select
    s.id as site_id,
    s.name as site_name,
    coalesce(inv.cnt, 0) as open_investigations,
    coalesce(un.cnt, 0) as unassigned,
    coalesce(od.cnt, 0) as overdue_actions,
    coalesce(rca.cnt, 0) as rca_outstanding
  from public.sites s
  left join (
    select site_id, count(*) as cnt
    from public.snags
    where org_id = p_org_id and lane = 'serious'
      and status in ('flagged', 'in_progress', 'rca_pending')
      and parent_snag_id is null
    group by site_id
  ) inv on inv.site_id = s.id
  left join (
    select site_id, count(*) as cnt
    from public.snags
    where org_id = p_org_id and owner_id is null
      and status in ('flagged', 'in_progress')
      and parent_snag_id is null
    group by site_id
  ) un on un.site_id = s.id
  left join (
    select sn.site_id, count(*) as cnt
    from public.corrective_actions ca
    join public.snags sn on sn.id = ca.snag_id
    where sn.org_id = p_org_id
      and ca.due_date < current_date
      and not (ca.status = 'done' and ca.verified_by is not null)
    group by sn.site_id
  ) od on od.site_id = s.id
  left join (
    -- Serious snags past the point where an RCA becomes possible, with no
    -- accepted analysis and no recorded waiver. rca_pending is included: an
    -- assigned-but-unfinished RCA is still outstanding analysis work.
    select sn.site_id, count(*) as cnt
    from public.snags sn
    where sn.org_id = p_org_id and sn.lane = 'serious'
      and sn.status in ('resolved', 'rca_pending')
      and sn.rca_waived_at is null
      and sn.parent_snag_id is null
      and not exists (
        select 1 from public.snag_rca r
        where r.snag_id = sn.id and r.status = 'accepted'
      )
    group by sn.site_id
  ) rca on rca.site_id = s.id
  where s.org_id = p_org_id
  order by s.name;
end;
$$;

grant execute on function public.get_site_breakdown(uuid) to authenticated;
revoke execute on function public.get_site_breakdown(uuid) from public, anon;

-- ─── 5. Expose waiver state on the read view ────────────────────────────────
-- Appended to the end so the existing column order is untouched (a
-- requirement of CREATE OR REPLACE VIEW). security_invoker is restated so RLS
-- on snags keeps applying to callers of the view.

create or replace view public.snags_with_details
with (security_invoker = true) as
 SELECT s.id,
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
    reporter.name AS reporter_name,
    reporter.email AS reporter_email,
    owner.name AS owner_name,
    site.name AS site_name,
    COALESCE(cc.completed_count, 0::bigint) AS checklist_completed_count,
    COALESCE(ev.evidence_count, 0::bigint) AS evidence_count,
    COALESCE(ca.open_count, 0::bigint) AS open_corrective_action_count,
    COALESCE(cm.comment_count, 0::bigint) AS comment_count,
    COALESCE(v.vote_score, 0::bigint) AS vote_score,
    COALESCE(v.upvote_count, 0::bigint) AS upvote_count,
    COALESCE(v.downvote_count, 0::bigint) AS downvote_count,
    s.photo_paths,
    s.is_public_submission,
    s.parent_snag_id,
    s.merged_by,
    s.merged_at,
    COALESCE(children.child_count, 0::bigint) AS child_count,
    s.work_group_id,
    s.notifiable_marked_by,
    s.notifiable_marked_at,
    s.notifying_org_id,
    s.notifying_pcbu_note,
    notifying_org.name AS notifying_org_name,
    s.rca_waived_by,
    s.rca_waived_at,
    s.rca_waived_reason
   FROM snags s
     LEFT JOIN profiles reporter ON reporter.id = s.reporter_id
     LEFT JOIN profiles owner ON owner.id = s.owner_id
     LEFT JOIN sites site ON site.id = s.site_id
     LEFT JOIN organisations notifying_org ON notifying_org.id = s.notifying_org_id
     LEFT JOIN ( SELECT checklist_completions.snag_id,
            count(*) AS completed_count
           FROM checklist_completions
          GROUP BY checklist_completions.snag_id) cc ON cc.snag_id = s.id
     LEFT JOIN ( SELECT evidence_items.snag_id,
            count(*) AS evidence_count
           FROM evidence_items
          GROUP BY evidence_items.snag_id) ev ON ev.snag_id = s.id
     LEFT JOIN ( SELECT corrective_actions.snag_id,
            count(*) AS open_count
           FROM corrective_actions
          WHERE NOT (corrective_actions.status = 'done'::corrective_action_status AND corrective_actions.verified_by IS NOT NULL)
          GROUP BY corrective_actions.snag_id) ca ON ca.snag_id = s.id
     LEFT JOIN ( SELECT comments.snag_id,
            count(*) AS comment_count
           FROM comments
          GROUP BY comments.snag_id) cm ON cm.snag_id = s.id
     LEFT JOIN ( SELECT votes.snag_id,
            sum(votes.value) AS vote_score,
            count(*) FILTER (WHERE votes.value = 1) AS upvote_count,
            count(*) FILTER (WHERE votes.value = '-1'::integer) AS downvote_count
           FROM votes
          GROUP BY votes.snag_id) v ON v.snag_id = s.id
     LEFT JOIN ( SELECT snags2.parent_snag_id,
            count(*) AS child_count
           FROM snags snags2
          WHERE snags2.parent_snag_id IS NOT NULL
          GROUP BY snags2.parent_snag_id) children ON children.parent_snag_id = s.id;
