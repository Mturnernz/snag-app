-- Evidence could be added and never taken back.
--
-- add_evidence_item has existed since m4; nothing has ever deleted an
-- evidence_items row or corrected a caption. A mis-picked photo, a caption
-- typed into the wrong sheet, or five frames of the same wall were permanent —
-- and since the evidence grid is what a regulator reads, "permanent" there
-- means the record is wrong on purpose-looking terms.
--
-- Two RPCs, both mirroring the actor rules of the add side rather than
-- inventing new ones, so nobody can remove evidence they could not have
-- attached in the first place.

begin;

-- Shared gate. Evidence rows come from two different add paths with two
-- different actor sets, and getting that wrong in one of the two RPCs is
-- exactly the kind of drift the investigation-access split was written to
-- stop, so it is resolved once, here.
create function public.require_evidence_access(p_evidence_id uuid)
returns public.evidence_items
language plpgsql security definer set search_path = public as $$
declare
  v_evidence public.evidence_items;
  v_snag public.snags;
  v_action public.corrective_actions;
begin
  select e.* into v_evidence
    from public.evidence_items e
    join public.snags s on s.id = e.snag_id
    where e.id = p_evidence_id and s.org_id = public.current_org_id();

  if v_evidence is null then
    raise exception 'Evidence not found';
  end if;

  if v_evidence.corrective_action_id is not null then
    -- Completion evidence: same actors as add_corrective_action_evidence —
    -- the action's owner, or a supervisor/admin of the snag's site. A
    -- corrective action can hang off a niggle, so require_investigation_access
    -- (which insists on the serious lane) is the wrong gate here.
    select * into v_action from public.corrective_actions where id = v_evidence.corrective_action_id;
    select * into v_snag from public.snags where id = v_evidence.snag_id;
    if not public.can_edit_site(v_snag.site_id) and auth.uid() <> v_action.owner_id then
      raise exception 'Only the owner, a supervisor of this site, or an admin can change evidence on this action';
    end if;
    return v_evidence;
  end if;

  -- Investigation evidence: doing, not directing — the assigned lead
  -- investigator (any role) as well as supervisors and admins.
  perform public.require_investigation_access(v_evidence.snag_id);
  return v_evidence;
end;
$$;

revoke all on function public.require_evidence_access(uuid) from public, anon;

-- Correcting what a photo shows is a correction to a description, so it stays
-- available for the life of the snag, including after it closes. It is
-- audited; a caption that has been edited is not a caption that has been
-- quietly rewritten.
create function public.update_evidence_caption(p_evidence_id uuid, p_caption text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_evidence public.evidence_items := public.require_evidence_access(p_evidence_id);
  v_org_id uuid := public.current_org_id();
begin
  update public.evidence_items
    set caption = nullif(btrim(coalesce(p_caption, '')), '')
    where id = p_evidence_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', v_evidence.snag_id, 'evidence_caption_edited', auth.uid());
end;
$$;

grant execute on function public.update_evidence_caption(uuid, text) to authenticated;
revoke execute on function public.update_evidence_caption(uuid, text) from public, anon;

-- Removal on a resolved snag is recorded, not refused.
--
-- update_snag_status will not close a serious snag without evidence, so the
-- evidence on a resolved snag is part of what justified closing it — which is
-- an argument for making the removal visible, not for making it impossible. A
-- photo of the wrong site, or of somebody's face, does not stop being wrong
-- because the snag closed, and the person who most needs to take it down is
-- usually the supervisor who closed it. So the deletion goes through and the
-- audit action says when it happened: 'evidence_deleted_after_resolve' rather
-- than 'evidence_deleted'.
--
-- Returns the media_path so the caller can drop the storage object. This RPC
-- owns the row; the object is the caller's to remove, the same division of
-- responsibility as delete_org_document. Row first, object second: an object
-- with no row is invisible, whereas a row with no object is a broken thumbnail
-- in the middle of an investigation.
create function public.delete_evidence_item(p_evidence_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_evidence public.evidence_items := public.require_evidence_access(p_evidence_id);
  v_snag public.snags;
  v_org_id uuid := public.current_org_id();
begin
  select * into v_snag from public.snags where id = v_evidence.snag_id;

  delete from public.evidence_items where id = p_evidence_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (
      v_org_id, 'snag', v_evidence.snag_id,
      case when v_snag.status = 'resolved' then 'evidence_deleted_after_resolve' else 'evidence_deleted' end,
      auth.uid()
    );

  return v_evidence.media_path;
end;
$$;

grant execute on function public.delete_evidence_item(uuid) to authenticated;
revoke execute on function public.delete_evidence_item(uuid) from public, anon;

-- snag-evidence carried INSERT and SELECT policies and no DELETE, so until now
-- nothing could remove an object from it at all. Scoped the same way the
-- org-documents delete policy is, plus the object's own uploader: a worker
-- running an investigation must be able to take back a photo they just
-- attached, and `owner` is the uid that uploaded it.
create policy "evidence can be deleted by its uploader, supervisors and admins"
  on storage.objects for delete
  using (
    bucket_id = 'snag-evidence'
    and (storage.foldername(name))[1] = (public.current_org_id())::text
    and (
      public.current_role() in ('supervisor', 'officer_admin')
      or owner = auth.uid()
    )
  );

commit;
