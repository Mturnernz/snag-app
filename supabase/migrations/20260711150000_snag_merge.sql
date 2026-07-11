-- Merge multiple snags into a parent/child relationship. A supervisor/admin
-- long-presses to multi-select snags on the list, then merges them: either
-- into a brand-new parent snag, or (if exactly one of the selection is
-- already a parent) into that existing parent. Changing the parent's status
-- cascades directly to every child (bypassing the child's own resolution
-- gates by design); changing a child's status independently never affects
-- its parent or siblings.

alter table public.snags
  add column parent_snag_id uuid references public.snags(id),
  add column merged_by uuid references public.profiles(id),
  add column merged_at timestamptz;

-- Defense in depth — guarantees a single-level hierarchy even though only
-- merge_snags/unmerge_snag ever write parent_snag_id.
create function public.enforce_snag_merge_invariants() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_snag_id is null then return new; end if;
  if new.parent_snag_id = new.id then
    raise exception 'A snag cannot be merged into itself';
  end if;
  if exists (select 1 from public.snags where id = new.parent_snag_id and parent_snag_id is not null) then
    raise exception 'Cannot merge into a snag that is itself already merged into another snag';
  end if;
  if exists (select 1 from public.snags where parent_snag_id = new.id) then
    raise exception 'Cannot merge a snag that already has children into another parent';
  end if;
  return new;
end;
$$;

create trigger snags_enforce_merge_invariants
  before insert or update of parent_snag_id on public.snags
  for each row execute function public.enforce_snag_merge_invariants();

-- snags_with_details: expose the merge columns plus a computed child_count.
create or replace view public.snags_with_details as
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
    coalesce(v.downvote_count, 0::bigint) as downvote_count,
    s.photo_paths,
    s.is_public_submission,
    s.parent_snag_id,
    s.merged_by,
    s.merged_at,
    coalesce(children.child_count, 0::bigint) as child_count
   from (((((((((public.snags s
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
          group by votes.snag_id) v on v.snag_id = s.id)
     left join ( select snags2.parent_snag_id,
            count(*) as child_count
           from public.snags snags2
          where snags2.parent_snag_id is not null
          group by snags2.parent_snag_id) children on children.parent_snag_id = s.id);

grant select on public.snags_with_details to anon, authenticated, service_role;

-- merge_snags: creates (or reuses) a parent snag and attaches the rest of
-- the selection as its children. p_kind/p_severity/p_site_id disambiguate
-- when the selection doesn't already agree on those fields; severity
-- ambiguity only blocks when the resolved kind is hazard/incident, since
-- niggles don't treat severity as authoritative.
create function public.merge_snags(
  p_snag_ids uuid[],
  p_description text default null,
  p_kind public.snag_kind default null,
  p_severity public.snag_severity default null,
  p_site_id uuid default null
)
returns table(id uuid, reference text)
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_distinct_count int;
  v_found_count int;
  v_already_merged_count int;
  v_existing_parents uuid[];
  v_parent_id uuid;
  v_is_new boolean;
  v_anchor public.snags;
  v_kind_count int;
  v_severity_count int;
  v_site_count int;
  v_kind public.snag_kind;
  v_severity public.snag_severity;
  v_site_id uuid;
  v_description text;
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can merge snags';
  end if;
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;

  select count(distinct x) into v_distinct_count from unnest(p_snag_ids) x;
  if v_distinct_count < 2 then
    raise exception 'Select at least two snags to merge';
  end if;

  select count(*) into v_found_count from public.snags where id = any(p_snag_ids) and org_id = v_org_id;
  if v_found_count <> v_distinct_count then
    raise exception 'Some of those snags were not found in your organisation';
  end if;

  select count(*) into v_already_merged_count from public.snags
    where id = any(p_snag_ids) and parent_snag_id is not null;
  if v_already_merged_count > 0 then
    raise exception 'One of the selected snags is already merged into another parent — unmerge it first';
  end if;

  select array_agg(s.id) into v_existing_parents
    from public.snags s
    where s.id = any(p_snag_ids) and exists (select 1 from public.snags c where c.parent_snag_id = s.id);
  if array_length(v_existing_parents, 1) > 1 then
    raise exception 'Cannot merge two existing parent snags together — unmerge one first';
  end if;

  v_is_new := array_length(v_existing_parents, 1) is null;
  if not v_is_new then
    v_parent_id := v_existing_parents[1];
  end if;

  -- Anchor: the first snag the user selected (long-pressed) — supplies
  -- fallback content when a field isn't ambiguous or a picker wasn't given.
  select * into v_anchor from public.snags where id = p_snag_ids[1];

  select count(distinct kind) into v_kind_count from public.snags where id = any(p_snag_ids);
  if v_kind_count > 1 and p_kind is null then
    raise exception 'Selected snags have different categories — choose one to continue';
  end if;
  v_kind := coalesce(p_kind, v_anchor.kind);

  select count(distinct severity) into v_severity_count from public.snags where id = any(p_snag_ids);
  if v_kind in ('hazard', 'incident') and v_severity_count > 1 and p_severity is null then
    raise exception 'Selected snags have different severities — choose one to continue';
  end if;
  v_severity := coalesce(p_severity, v_anchor.severity);

  select count(distinct site_id) into v_site_count from public.snags where id = any(p_snag_ids);
  if v_site_count > 1 and p_site_id is null then
    raise exception 'Selected snags are at different sites — choose one to continue';
  end if;
  if p_site_id is not null and not exists (select 1 from public.sites where id = p_site_id and org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;
  v_site_id := coalesce(p_site_id, v_anchor.site_id);

  v_description := coalesce(p_description, v_anchor.description);

  if v_is_new then
    insert into public.snags (
      org_id, site_id, reporter_id, kind, severity, description, photo_path, photo_paths,
      occurred_at, latitude, longitude
    ) values (
      v_org_id, v_site_id, auth.uid(), v_kind, v_severity, v_description,
      v_anchor.photo_path, v_anchor.photo_paths, v_anchor.occurred_at, v_anchor.latitude, v_anchor.longitude
    ) returning public.snags.id into v_parent_id;

    insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
      values (v_org_id, 'snag', v_parent_id, 'merge_created', auth.uid());
  else
    update public.snags
      set kind = v_kind, severity = v_severity, site_id = v_site_id,
          description = coalesce(p_description, description)
      where id = v_parent_id;

    insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
      values (v_org_id, 'snag', v_parent_id, 'merge_children_added', auth.uid());
  end if;

  update public.snags
    set parent_snag_id = v_parent_id, merged_by = auth.uid(), merged_at = now()
    where id = any(p_snag_ids) and id <> v_parent_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    select v_org_id, 'snag', s.id, 'merged_into_parent', auth.uid()
    from public.snags s where s.id = any(p_snag_ids) and s.id <> v_parent_id;

  return query select s.id, s.reference from public.snags s where s.id = v_parent_id;
end;
$$;

grant execute on function public.merge_snags(uuid[], text, public.snag_kind, public.snag_severity, uuid) to authenticated;

-- unmerge_snag: un-parents a single child. Never a delete — snags are
-- never removed, consistent with the table-wide no-delete rule.
create function public.unmerge_snag(p_snag_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can unmerge snags';
  end if;

  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if v_snag.parent_snag_id is null then
    raise exception 'This snag is not merged into a parent';
  end if;

  update public.snags set parent_snag_id = null, merged_by = null, merged_at = null where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'unmerged', auth.uid());
  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', v_snag.parent_snag_id, 'child_unmerged', auth.uid());
end;
$$;

grant execute on function public.unmerge_snag(uuid) to authenticated;

-- Cascade: a status change on a parent (serious lane, via update_snag_status)
-- applies directly to every child too, bypassing each child's own gates —
-- this is a direct row-level UPDATE, so notify_after_snag_update still fires
-- per child automatically.
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

  if exists (select 1 from public.snags where parent_snag_id = p_snag_id) then
    update public.snags
      set status = p_status,
          resolution_note = coalesce(p_note, resolution_note),
          resolved_by = case when p_status = 'resolved' then auth.uid() else resolved_by end,
          resolved_at = case when p_status = 'resolved' then now() else resolved_at end
      where parent_snag_id = p_snag_id;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_' || p_status, auth.uid());
end;
$$;

grant execute on function public.update_snag_status(uuid, public.snag_status, text) to authenticated;

-- Same cascade for the niggle-lane resolve path.
create or replace function public.resolve_snag(p_snag_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
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
        resolved_by = auth.uid(),
        resolved_at = now(),
        resolution_note = p_note
    where id = p_snag_id;

  if exists (select 1 from public.snags where parent_snag_id = p_snag_id) then
    update public.snags
      set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
      where parent_snag_id = p_snag_id;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_resolved', auth.uid());
end;
$$;

grant execute on function public.resolve_snag(uuid, text) to authenticated;
