-- Two changes, both decided deliberately.
--
-- 1. Workers can add to the document library, not just read it.
--
--    Reading already worked: the org_documents policy and the storage view
--    policy are org-scoped with no role check. Only creation was restricted.
--    A worker running a document-mode investigation has to be able to file the
--    completed document, and a policy library nobody can contribute to is a
--    filing cabinet with one key. Deleting stays supervisor/admin — removing
--    an org record is a different act from adding one.
--
-- 2. Accepting an investigation document must be somebody else.
--
--    Acceptance is the gate condition that means "a supervisor read this and
--    signed it off". If the person who attached it can also accept it, that
--    sentence isn't true and the condition is decorative. This mirrors
--    corrective actions, where the verifier already cannot be the action's
--    owner. Requires knowing who attached it, which wasn't recorded.

begin;

alter table public.investigations
  add column if not exists document_attached_by uuid references public.profiles(id);

create or replace function public.create_org_document(p_file_path text, p_title text, p_category text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_id uuid;
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
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

drop policy if exists "supervisors and admins can upload to their org's documents buck" on storage.objects;
create policy "org members can upload to their org's documents bucket"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'org-documents'
    and (storage.foldername(name))[1] = (public.current_org_id())::text
  );

create or replace function public.attach_investigation_document(
  p_snag_id uuid,
  p_document_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
begin
  if not exists (
    select 1 from public.org_documents where id = p_document_id and org_id = v_snag.org_id
  ) then
    raise exception 'That document does not belong to your organisation';
  end if;

  insert into public.investigations (snag_id, mode, document_id, document_attached_by)
    values (p_snag_id, 'document', p_document_id, auth.uid())
  on conflict (snag_id) do update
    set mode = 'document',
        document_id = excluded.document_id,
        document_attached_by = excluded.document_attached_by,
        -- A different document is a different investigation. Whatever was
        -- accepted before was accepted about the old one.
        document_accepted_by = null,
        document_accepted_at = null;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'investigation_document_attached', auth.uid());
end;
$$;

create or replace function public.accept_investigation_document(p_snag_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
  v_inv public.investigations;
begin
  select * into v_inv from public.investigations where snag_id = p_snag_id;
  if v_inv is null or v_inv.document_id is null then
    raise exception 'Attach the investigation document before accepting it';
  end if;
  if v_inv.mode <> 'document' then
    raise exception 'This snag is using the SNAG investigation, not a document';
  end if;
  if v_inv.document_attached_by = auth.uid() then
    raise exception 'The investigation document has to be accepted by someone other than the person who attached it';
  end if;

  update public.investigations
    set document_accepted_by = auth.uid(),
        document_accepted_at = now()
    where snag_id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'investigation_document_accepted', auth.uid());
end;
$$;

commit;
