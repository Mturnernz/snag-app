-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

alter table public.snags
  add column retained_until date generated always as (((created_at at time zone 'utc')::date + interval '5 years')::date) stored;

alter table public.snags
  add column is_notifiable boolean not null default false;

create table public.investigation_files (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  file_path text not null,
  generated_by uuid not null references public.profiles(id),
  generated_at timestamptz not null default now()
);

create index on public.investigation_files (snag_id);

alter table public.investigation_files enable row level security;

create policy "org members can view investigation files"
  on public.investigation_files for select
  using (exists (select 1 from public.snags s where s.id = investigation_files.snag_id and s.org_id = public.current_org_id()));

insert into storage.buckets (id, name, public) values ('investigation-files', 'investigation-files', false);

create policy "org members can view their org's investigation files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'investigation-files'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create function public.block_snag_delete_within_retention()
returns trigger
language plpgsql as $$
begin
  if old.retained_until > current_date then
    raise exception 'This snag is retained until % and cannot be deleted', old.retained_until;
  end if;
  return old;
end;
$$;

create trigger block_snag_delete_within_retention
  before delete on public.snags
  for each row execute function public.block_snag_delete_within_retention();

create function public.set_notifiable_flag(p_snag_id uuid, p_value boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if not exists (select 1 from public.snags where id = p_snag_id and org_id = v_org_id) then
    raise exception 'Snag not found';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can set the notifiable flag';
  end if;

  update public.snags set is_notifiable = p_value where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, case when p_value then 'marked_notifiable' else 'unmarked_notifiable' end, auth.uid());
end;
$$;

grant execute on function public.set_notifiable_flag(uuid, boolean) to authenticated;

create function public.record_investigation_export(p_snag_id uuid, p_file_path text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
  v_file_id uuid;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can export the investigation file';
  end if;
  if v_snag.lane <> 'serious' then
    raise exception 'Only serious snags have an investigation file';
  end if;

  insert into public.investigation_files (snag_id, file_path, generated_by)
    values (p_snag_id, p_file_path, auth.uid())
    returning id into v_file_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'investigation_file_exported', auth.uid());

  return v_file_id;
end;
$$;

grant execute on function public.record_investigation_export(uuid, text) to authenticated;
