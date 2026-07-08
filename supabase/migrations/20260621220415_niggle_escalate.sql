-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

-- Let a worker flag their own niggle as needing more serious attention,
-- without granting recategorise rights (that stays supervisor/admin).
alter table public.snags
  add column escalated_by uuid references public.profiles(id),
  add column escalated_at timestamptz;

create function public.escalate_snag(p_snag_id uuid)
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
    raise exception 'Only niggles can be escalated this way';
  end if;
  if v_snag.reporter_id <> auth.uid() then
    raise exception 'Only the person who reported this can escalate it';
  end if;
  if v_snag.status not in ('flagged', 'in_progress') then
    raise exception 'This snag is not open';
  end if;
  if v_snag.escalated_at is not null then
    raise exception 'This has already been flagged for attention';
  end if;

  update public.snags
    set escalated_by = auth.uid(), escalated_at = now()
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'escalated', auth.uid());

  perform public.dispatch_snag_notification(p_snag_id, 'niggle_escalated');
end;
$$;

grant execute on function public.escalate_snag(uuid) to authenticated;
