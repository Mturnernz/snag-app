-- Closing a serious snag early is a decision, so it gets a name and a reason.
--
-- The Admin dashboard's "RCA outstanding" list is full of snags that are marked
-- resolved, which reads as a bug in the count and isn't one: an RCA is owed on
-- every serious snag until it's accepted or explicitly waived, and resolution
-- doesn't discharge that. What *is* wrong is how several of them got to
-- `resolved` in the first place — with no notifiable decision, no checklist, no
-- witness statement and no evidence, and nothing on the record saying why.
--
-- Two routes did that, and only one of them was history:
--
--   1. Snags resolved before update_snag_status grew its gate. Nothing to do
--      about those but surface them (see §5) — they are not rewritten here.
--
--   2. `resolve_snag`, the niggle path, cascading `resolved` to *every* child of
--      a merged parent. merge_snags will put a hazard or an incident under a
--      fixit parent, and resolving that parent then closed the serious children
--      without going near the gate. SNAG-00003/4/6 are sitting in exactly that
--      state under a fixit. Fixed in §4 — a serious child keeps its own status
--      and its own gate, and stays open until somebody investigates it.
--
-- With the hole closed, the rule the app should actually enforce can be stated:
-- a serious snag reaches `resolved` either with every prerequisite met, or with
-- a supervisor's written reason why not. There is no third way in, and the
-- reason is recorded against the snag with who wrote it, when, and which
-- conditions were outstanding at that moment — so an early close is legible a
-- year later instead of being indistinguishable from a complete investigation.

-- ─── 1. Where the decision is recorded ──────────────────────────────────────

alter table public.snags
  add column if not exists resolution_exception_reason text,
  add column if not exists resolution_exception_by uuid references public.profiles(id),
  add column if not exists resolution_exception_at timestamptz,
  add column if not exists resolution_exception_unmet text[];

comment on column public.snags.resolution_exception_reason is
  'Why this serious snag was marked resolved with investigation prerequisites still outstanding. Required by update_snag_status when the gate is unmet; cleared when the snag is reopened.';
comment on column public.snags.resolution_exception_unmet is
  'The resolve-gate condition keys that were unmet when the exception was recorded — the same keys seriousResolveGate uses, snapshotted so the record survives later changes to the investigation.';

-- Resolved with the gate unmet: what the dashboard and both clients look for.
create index if not exists snags_resolution_exception_idx
  on public.snags (org_id, site_id)
  where resolution_exception_at is not null;

-- ─── 2. The gate, as an array instead of the first raise ────────────────────
--
-- This is not a third copy of the rule. update_snag_status held the SQL copy
-- inline and raised on the first condition it found; that is fine for refusing
-- a resolve and useless for recording what was outstanding when one is allowed.
-- So the SQL copy moves here and update_snag_status reads it, leaving the rule
-- stated once per layer exactly as before — here, and seriousResolveGate in
-- packages/supabase-queries for the clients.
--
-- Order matters and matches seriousResolveGate term for term: the notifiable
-- decision leads because it carries a statutory clock, then the three both
-- modes require, then the two the mode forks on. Keys are the client's
-- ResolveGateKey values, so a snapshot can be rendered without translation.
create or replace function public.serious_resolve_unmet(p_snag_id uuid)
returns text[]
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_snag public.snags;
  v_inv public.investigations;
  v_unmet text[] := '{}';
  v_checklist_count int;
  v_statement_count int;
  v_evidence_count int;
  v_open_actions int;
begin
  select * into v_snag from public.snags where id = p_snag_id;
  -- A niggle has no investigation to be outstanding.
  if v_snag is null or v_snag.lane <> 'serious' then
    return '{}';
  end if;

  select count(*) into v_checklist_count from public.checklist_completions where snag_id = p_snag_id;
  select count(*) into v_statement_count from public.witness_statements where snag_id = p_snag_id;
  select count(*) into v_evidence_count from public.evidence_items where snag_id = p_snag_id;
  select count(*) into v_open_actions from public.corrective_actions
    where snag_id = p_snag_id and not (status = 'done' and verified_by is not null);
  select * into v_inv from public.investigations where snag_id = p_snag_id;

  if v_snag.notifiable_marked_at is null and v_snag.is_notifiable is not true then
    v_unmet := v_unmet || 'notifiable'::text;
  end if;
  if v_checklist_count < 5 then
    v_unmet := v_unmet || 'checklist'::text;
  end if;
  if v_statement_count = 0 then
    v_unmet := v_unmet || 'witnesses'::text;
  end if;
  if v_evidence_count = 0 then
    v_unmet := v_unmet || 'evidence'::text;
  end if;

  if v_inv.mode = 'document' then
    if v_inv.document_id is null then
      v_unmet := v_unmet || 'investigationDocument'::text;
    end if;
    if v_inv.document_accepted_at is null then
      v_unmet := v_unmet || 'documentAccepted'::text;
    end if;
  else
    if v_inv is null or v_inv.root_cause_text is null then
      v_unmet := v_unmet || 'rootCause'::text;
    end if;
    if v_open_actions > 0 then
      v_unmet := v_unmet || 'correctiveActions'::text;
    end if;
  end if;

  return v_unmet;
end;
$function$;

grant execute on function public.serious_resolve_unmet(uuid) to authenticated;
revoke execute on function public.serious_resolve_unmet(uuid) from public, anon;

-- ─── 3. Resolve, with or without an exception ───────────────────────────────
--
-- Dropped rather than replaced: the new p_exception_reason parameter would
-- otherwise create a second overload, and every existing three-argument call
-- would fail as ambiguous rather than picking one.
drop function if exists public.update_snag_status(uuid, public.snag_status, text);

create or replace function public.update_snag_status(
  p_snag_id uuid,
  p_status public.snag_status,
  p_note text default null,
  p_exception_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
  v_unmet text[] := '{}';
  v_reason text := nullif(btrim(coalesce(p_exception_reason, '')), '');
  v_exception_reason text;
  v_exception_unmet text[];
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
    v_unmet := public.serious_resolve_unmet(p_snag_id);

    if array_length(v_unmet, 1) is not null then
      -- No reason offered: refuse exactly as before, naming the first unmet
      -- condition. A client that knows nothing about exceptions is unaffected.
      if v_reason is null then
        raise exception '%', case v_unmet[1]
          when 'notifiable' then 'Decide whether this is a notifiable event before marking this resolved'
          when 'checklist' then 'Finish the first-response checklist before marking this resolved'
          when 'witnesses' then 'Add at least one witness statement before marking this resolved'
          when 'evidence' then 'Add at least one piece of evidence before marking this resolved'
          when 'investigationDocument' then 'Attach the investigation document before marking this resolved'
          when 'documentAccepted' then 'A supervisor must accept the investigation document before marking this resolved'
          when 'rootCause' then 'Record a root cause before marking this resolved'
          when 'correctiveActions' then 'Complete and verify every corrective action before marking this resolved'
        end;
      end if;

      -- Closing an incomplete investigation is a directing act, so the owner
      -- alone isn't enough here even though they may change status generally.
      if not public.can_edit_site(v_snag.site_id) then
        raise exception 'Only a supervisor of this site, or an admin, can resolve this with the investigation incomplete';
      end if;
      if length(v_reason) < 10 then
        raise exception 'Explain why this is being resolved with the investigation incomplete';
      end if;

      v_exception_reason := v_reason;
      v_exception_unmet := v_unmet;
    end if;
  end if;

  update public.snags
    set status = p_status,
        owner_id = case when p_status = 'resolved' then coalesce(owner_id, auth.uid()) else owner_id end,
        resolution_note = coalesce(p_note, resolution_note),
        resolved_by = case when p_status = 'resolved' then auth.uid() else null end,
        resolved_at = case when p_status = 'resolved' then now() else null end,
        -- A clean resolve clears any earlier exception, and so does a reopen:
        -- the field describes this resolution, not a previous one.
        resolution_exception_reason = case when p_status = 'resolved' then v_exception_reason else null end,
        resolution_exception_by = case when p_status = 'resolved' and v_exception_reason is not null then auth.uid() else null end,
        resolution_exception_at = case when p_status = 'resolved' and v_exception_reason is not null then now() else null end,
        resolution_exception_unmet = case when p_status = 'resolved' then v_exception_unmet else null end,
        rca_waived_by = case when p_status = 'resolved' then rca_waived_by else null end,
        rca_waived_at = case when p_status = 'resolved' then rca_waived_at else null end,
        rca_waived_reason = case when p_status = 'resolved' then rca_waived_reason else null end
    where id = p_snag_id;

  -- Children of a serious parent are one incident investigated once, on the
  -- parent — so they inherit its resolution, exception and all.
  if exists (select 1 from public.snags where parent_snag_id = p_snag_id) then
    update public.snags
      set status = p_status,
          owner_id = case when p_status = 'resolved' then coalesce(owner_id, auth.uid()) else owner_id end,
          resolution_note = coalesce(p_note, resolution_note),
          resolved_by = case when p_status = 'resolved' then auth.uid() else null end,
          resolved_at = case when p_status = 'resolved' then now() else null end,
          resolution_exception_reason = case when p_status = 'resolved' then v_exception_reason else null end,
          resolution_exception_by = case when p_status = 'resolved' and v_exception_reason is not null then auth.uid() else null end,
          resolution_exception_at = case when p_status = 'resolved' and v_exception_reason is not null then now() else null end,
          resolution_exception_unmet = case when p_status = 'resolved' then v_exception_unmet else null end,
          rca_waived_by = case when p_status = 'resolved' then rca_waived_by else null end,
          rca_waived_at = case when p_status = 'resolved' then rca_waived_at else null end,
          rca_waived_reason = case when p_status = 'resolved' then rca_waived_reason else null end
      where parent_snag_id = p_snag_id;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_' || p_status, auth.uid());

  -- Its own action, not a flavour of status_resolved: this is the line somebody
  -- reviewing the org's serious snags needs to be able to find.
  if v_exception_reason is not null then
    insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
      values (v_org_id, 'snag', p_snag_id, 'resolved_with_exception', auth.uid());
  end if;

  if p_status = 'resolved' and v_snag.owner_id is null then
    insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
      values (v_org_id, 'snag', p_snag_id, 'owner_assigned_on_resolve', auth.uid());
  end if;
end;
$function$;

grant execute on function public.update_snag_status(uuid, public.snag_status, text, text) to authenticated;
revoke execute on function public.update_snag_status(uuid, public.snag_status, text, text) from public, anon;

-- Snags already closed with the gate unmet — §5's list — can have the missing
-- reason supplied without being reopened and re-resolved, which would restamp
-- resolved_at and lose when the work actually finished. Only ever fills a gap:
-- a snag that already carries a reason keeps it, and the alternative to writing
-- one is reopening the snag and doing the investigation.
create or replace function public.record_resolution_exception(p_snag_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_unmet text[];
begin
  if v_snag.status <> 'resolved' then
    raise exception 'Only a resolved snag can have a resolution exception recorded';
  end if;
  if v_snag.resolution_exception_at is not null then
    raise exception 'A reason is already recorded for this snag';
  end if;
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Explain why this was resolved with the investigation incomplete';
  end if;

  v_unmet := public.serious_resolve_unmet(p_snag_id);
  if array_length(v_unmet, 1) is null then
    raise exception 'This snag''s investigation is complete — there is nothing to explain';
  end if;

  update public.snags
    set resolution_exception_reason = v_reason,
        resolution_exception_by = auth.uid(),
        resolution_exception_at = now(),
        resolution_exception_unmet = v_unmet
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'resolution_exception_recorded', auth.uid());
end;
$function$;

grant execute on function public.record_resolution_exception(uuid, text) to authenticated;
revoke execute on function public.record_resolution_exception(uuid, text) from public, anon;

-- ─── 4. The niggle path stops closing serious snags ─────────────────────────
--
-- Only the lane's own children cascade. A hazard merged under a fixit is still
-- a hazard: it keeps its status, it keeps its gate, and it goes on counting as
-- an open investigation until somebody runs one. That is the point — three of
-- them were closed this way with nothing recorded against them at all.
create or replace function public.resolve_snag(p_snag_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
begin
  if p_note is null or btrim(p_note) = '' then
    raise exception 'Add a note describing what was done before marking this resolved';
  end if;

  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if v_snag.lane <> 'niggle' then
    raise exception 'Only niggles use the resolve/confirm flow';
  end if;
  if v_snag.status not in ('flagged', 'in_progress') then
    raise exception 'This snag is not open';
  end if;

  update public.snags
    set status = 'resolved',
        owner_id = coalesce(owner_id, auth.uid()),
        resolved_by = auth.uid(),
        resolved_at = now(),
        resolution_note = p_note
    where id = p_snag_id;

  if exists (select 1 from public.snags where parent_snag_id = p_snag_id and lane = 'niggle') then
    update public.snags
      set status = 'resolved',
          owner_id = coalesce(owner_id, auth.uid()),
          resolved_by = auth.uid(),
          resolved_at = now(),
          resolution_note = p_note
      where parent_snag_id = p_snag_id and lane = 'niggle';
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_resolved', auth.uid());

  if v_snag.owner_id is null then
    insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
      values (v_org_id, 'snag', p_snag_id, 'owner_assigned_on_resolve', auth.uid());
  end if;
end;
$function$;

-- ─── 5. Making it visible ───────────────────────────────────────────────────

-- The detail screens read this view, and an early close has to be as legible on
-- the snag as the resolution note beside it.
create or replace view public.snags_with_details
with (security_invoker = true) as
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
  notifying_org.name as notifying_org_name,
  s.rca_waived_by,
  s.rca_waived_at,
  s.rca_waived_reason,
  s.resolution_exception_reason,
  s.resolution_exception_by,
  s.resolution_exception_at,
  s.resolution_exception_unmet,
  exception_by.name as resolution_exception_by_name
from public.snags s
  left join public.profiles reporter on reporter.id = s.reporter_id
  left join public.profiles owner on owner.id = s.owner_id
  left join public.profiles exception_by on exception_by.id = s.resolution_exception_by
  left join public.sites site on site.id = s.site_id
  left join public.organisations notifying_org on notifying_org.id = s.notifying_org_id
  left join (
    select checklist_completions.snag_id, count(*) as completed_count
    from public.checklist_completions group by checklist_completions.snag_id
  ) cc on cc.snag_id = s.id
  left join (
    select evidence_items.snag_id, count(*) as evidence_count
    from public.evidence_items group by evidence_items.snag_id
  ) ev on ev.snag_id = s.id
  left join (
    select corrective_actions.snag_id, count(*) as open_count
    from public.corrective_actions
    where not (corrective_actions.status = 'done'::corrective_action_status and corrective_actions.verified_by is not null)
    group by corrective_actions.snag_id
  ) ca on ca.snag_id = s.id
  left join (
    select comments.snag_id, count(*) as comment_count
    from public.comments group by comments.snag_id
  ) cm on cm.snag_id = s.id
  left join (
    select votes.snag_id,
      sum(votes.value) as vote_score,
      count(*) filter (where votes.value = 1) as upvote_count,
      count(*) filter (where votes.value = '-1'::integer) as downvote_count
    from public.votes group by votes.snag_id
  ) v on v.snag_id = s.id
  left join (
    select snags2.parent_snag_id, count(*) as child_count
    from public.snags snags2
    where snags2.parent_snag_id is not null
    group by snags2.parent_snag_id
  ) children on children.parent_snag_id = s.id;

-- The dashboard's RCA-outstanding list carries the same facts, so a supervisor
-- opening the count can tell "closed early, and here's why" from "closed early,
-- and nobody said why" without opening every snag in the list.
create or replace view public.snag_rca_outstanding
with (security_invoker = true) as
select
  sn.id as snag_id,
  sn.org_id,
  sn.site_id,
  sn.reference,
  sn.description,
  sn.status,
  sn.severity,
  sn.owner_id,
  sn.resolution_exception_reason,
  sn.resolution_exception_at,
  -- Recomputed rather than read from the snapshot: the snapshot says what was
  -- outstanding when the snag was closed, this says what is outstanding now.
  -- serious_resolve_unmet rather than snag_gate_inputs + snagGateSummary, which
  -- is how the snag list does the same job — that view is one row per *unmerged*
  -- serious snag, and merged children under a niggle parent are precisely the
  -- rows this list needs to explain.
  coalesce(array_length(public.serious_resolve_unmet(sn.id), 1), 0) as unmet_count
from public.snags sn
where sn.lane = 'serious'
  and sn.status in ('resolved', 'rca_pending')
  and sn.rca_waived_at is null
  and not exists (
    select 1 from public.snag_rca r
    where r.snag_id = sn.id and r.status = 'accepted'
  )
  and (
    sn.parent_snag_id is null
    or not exists (
      select 1 from public.snags parent
      where parent.id = sn.parent_snag_id and parent.lane = 'serious'
    )
  );

grant select on public.snag_rca_outstanding to authenticated;
