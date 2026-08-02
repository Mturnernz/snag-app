-- merge_snags could produce a niggle carrying a severity.
--
-- `recategorise_snag` has always enforced the rule that severity belongs to the
-- serious lane only:
--
--   severity = case when p_kind in ('hazard','incident') then p_severity else null end
--
-- `merge_snags` did not. It resolved `v_severity := coalesce(p_severity,
-- v_anchor.severity)` and wrote that straight through on both paths — the
-- insert for a new parent and the update for an existing one — with no test on
-- the resolved kind. Two ways through:
--
--   * merge two fixits whose anchor already carries a severity, and the parent
--     keeps it;
--   * merge a mixed selection down to a niggle kind, and the anchor's severity
--     survives the recategorisation the merge is performing.
--
-- The severity-ambiguity prompt doesn't catch either, because it only fires
-- `when v_kind in ('hazard','incident')` — for a niggle the RPC never asks, it
-- just carries whatever was there.
--
-- Why it matters beyond tidiness: severity outranks kind in the card's alert
-- border (`CardAlertBorder`), so such a snag renders with the black injury or
-- red critical border while sitting on the lane where none of the serious-lane
-- apparatus ever engages — no first-response checklist, no witness statement,
-- no evidence, no notifiable decision, and `update_snag_status` applies none of
-- the resolve gate. It reads as the most serious thing on the list and is
-- treated as the least.
--
-- This does NOT cover a reporter choosing the wrong lane at entry, which is a
-- separate gap tracked in TODO.md — that one needs a question on the report
-- form, not a constraint here.
--
-- Also adds the friendly severity check `recategorise_snag` already has. Merging
-- two niggles *up* to a hazard with no severity supplied previously fell through
-- to the table's own check constraint, which raises a constraint violation
-- rather than something a client can show a user.
--
-- Otherwise byte-for-byte the definition from
-- 20260712000000_fix_ambiguous_id_work_groups_merge.sql: same guards, same
-- anchor resolution, same audit entries, same return.

create or replace function public.merge_snags(
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

  select count(*) into v_found_count from public.snags where public.snags.id = any(p_snag_ids) and org_id = v_org_id;
  if v_found_count <> v_distinct_count then
    raise exception 'Some of those snags were not found in your organisation';
  end if;

  select count(*) into v_already_merged_count from public.snags
    where public.snags.id = any(p_snag_ids) and parent_snag_id is not null;
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
  select * into v_anchor from public.snags where public.snags.id = p_snag_ids[1];

  select count(distinct kind) into v_kind_count from public.snags where public.snags.id = any(p_snag_ids);
  if v_kind_count > 1 and p_kind is null then
    raise exception 'Selected snags have different categories — choose one to continue';
  end if;
  v_kind := coalesce(p_kind, v_anchor.kind);

  select count(distinct severity) into v_severity_count from public.snags where public.snags.id = any(p_snag_ids);
  if v_kind in ('hazard', 'incident') and v_severity_count > 1 and p_severity is null then
    raise exception 'Selected snags have different severities — choose one to continue';
  end if;

  -- The fix. Same shape as recategorise_snag: severity exists on the serious
  -- lane and nowhere else, whatever the anchor happened to be carrying.
  v_severity := case
    when v_kind in ('hazard', 'incident') then coalesce(p_severity, v_anchor.severity)
    else null
  end;

  if v_kind in ('hazard', 'incident') and v_severity is null then
    raise exception 'A hazard or incident needs a severity';
  end if;

  select count(distinct site_id) into v_site_count from public.snags where public.snags.id = any(p_snag_ids);
  if v_site_count > 1 and p_site_id is null then
    raise exception 'Selected snags are at different sites — choose one to continue';
  end if;
  if p_site_id is not null and not exists (select 1 from public.sites where public.sites.id = p_site_id and public.sites.org_id = v_org_id) then
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
      where public.snags.id = v_parent_id;

    insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
      values (v_org_id, 'snag', v_parent_id, 'merge_children_added', auth.uid());
  end if;

  update public.snags
    set parent_snag_id = v_parent_id, merged_by = auth.uid(), merged_at = now()
    where public.snags.id = any(p_snag_ids) and public.snags.id <> v_parent_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    select v_org_id, 'snag', s.id, 'merged_into_parent', auth.uid()
    from public.snags s where s.id = any(p_snag_ids) and s.id <> v_parent_id;

  return query select s.id, s.reference from public.snags s where s.id = v_parent_id;
end;
$$;

-- Existing rows are left alone. Clearing severity on a niggle that already
-- carries one is a data decision, not a schema one: the value may be the only
-- record that somebody once judged it critical, and on a resolved snag there is
-- nothing left to gate. Query for them before deciding:
--
--   select reference, kind, severity, status
--   from public.snags
--   where kind in ('fixit', 'improvement') and severity is not null;
