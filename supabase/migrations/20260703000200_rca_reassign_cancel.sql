-- P2.4.2 (part 2): reassign_rca and cancel_rca.
--
-- Without these, a snag whose RCA assignee leaves is stuck at rca_pending
-- forever. Reassign hands an unfinished RCA to someone else (and notifies
-- them); cancel abandons the RCA and returns the snag from rca_pending to
-- sorted. Both supervisor/admin (site-scoped via can_edit_site), audited.

create function public.reassign_rca(p_rca_id uuid, p_new_assignee_id uuid)
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
    raise exception 'Only a supervisor of this site, or an admin, can reassign an RCA';
  end if;
  if v_rca.status not in ('assigned', 'in_progress', 'rejected') then
    raise exception 'This RCA has been submitted or closed and cannot be reassigned';
  end if;
  if not exists (select 1 from public.profiles where id = p_new_assignee_id and org_id = v_snag.org_id) then
    raise exception 'That person does not belong to your organisation';
  end if;

  update public.snag_rca set assigned_to = p_new_assignee_id where id = p_rca_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_rca', p_rca_id, 'reassigned', auth.uid());

  perform public.dispatch_rca_notification(p_rca_id, 'rca_assigned');
end;
$$;

grant execute on function public.reassign_rca(uuid, uuid) to authenticated;

create function public.cancel_rca(p_rca_id uuid)
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

  update public.snags set status = 'sorted'
    where id = v_snag.id and status = 'rca_pending';

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_rca', p_rca_id, 'cancelled', auth.uid());
end;
$$;

grant execute on function public.cancel_rca(uuid) to authenticated;
