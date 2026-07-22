-- General org document library (SNAG_WEB_APP_PLAN.md §5/§10, decision D2) —
-- H&S policies, compliance certificates, induction packs and the like, not
-- tied to any single snag. Distinct from snag-scoped evidence
-- (snag-evidence/investigation-files), which already existed and needed
-- nothing new. Same table/bucket/policy shape as governance_reports
-- (20260719140000_governance_export.sql), except read access is every org
-- member (a document library is meant to be read org-wide), while write
-- access (upload/delete) is supervisor/officer_admin only — mirrors the
-- read-vs-write split already used for site/work-group management.

create table public.org_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  file_path text not null,
  title text not null,
  category text,
  created_at timestamptz not null default now()
);

create index on public.org_documents (org_id);

alter table public.org_documents enable row level security;

create policy "org members can view their org's documents"
  on public.org_documents for select
  using (org_id = public.current_org_id());

-- All writes go through create_org_document/delete_org_document below (the
-- "RPC-only writes, RLS on all tables" convention) — no insert/update/delete
-- policy needed on the table itself since nothing is meant to write to it
-- directly.

insert into storage.buckets (id, name, public) values ('org-documents', 'org-documents', false);

create policy "org members can view their org's documents bucket"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'org-documents'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create policy "supervisors and admins can upload to their org's documents bucket"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'org-documents'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_role() in ('supervisor', 'officer_admin')
  );

create policy "supervisors and admins can delete from their org's documents bucket"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'org-documents'
    and (storage.foldername(name))[1] = public.current_org_id()::text
    and public.current_role() in ('supervisor', 'officer_admin')
  );

create function public.create_org_document(p_file_path text, p_title text, p_category text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_id uuid;
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can upload a document';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Please enter a title';
  end if;

  insert into public.org_documents (org_id, uploaded_by, file_path, title, category)
    values (v_org_id, auth.uid(), p_file_path, btrim(p_title), p_category)
    returning id into v_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'org_document', v_id, 'document_uploaded', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.create_org_document(text, text, text) to authenticated;
revoke execute on function public.create_org_document(text, text, text) from public, anon;

create function public.delete_org_document(p_document_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_doc public.org_documents;
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can delete a document';
  end if;

  select * into v_doc from public.org_documents where id = p_document_id and org_id = v_org_id;
  if v_doc is null then
    raise exception 'Document not found';
  end if;

  delete from public.org_documents where id = p_document_id;

  -- The storage object itself is deleted by the caller (via the Storage API,
  -- gated by the delete policy above) — this RPC only owns the metadata row,
  -- same division of responsibility as the rest of the document library.
  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'org_document', p_document_id, 'document_deleted', auth.uid());
end;
$$;

grant execute on function public.delete_org_document(uuid) to authenticated;
revoke execute on function public.delete_org_document(uuid) from public, anon;
