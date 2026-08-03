-- A witness statement can carry the document it was taken from.
--
-- The table has held only typed text since m4, which quietly assumed every
-- statement is transcribed into the app. In practice the artefact that matters
-- is often a signed sheet, a scan, or a statement someone wrote up in Word —
-- and with nowhere to put it, that file ended up either in the evidence grid
-- (where it reads as a photo of the scene) or nowhere at all.
--
-- Not a replacement for statement_text, which stays required: a searchable
-- record of what the witness said is the point, and an attachment nobody can
-- read without downloading it is not that.

begin;

alter table public.witness_statements
  add column if not exists media_path text;

comment on column public.witness_statements.media_path is
  'Object in the snag-evidence bucket — a signed statement, a scan, or a copy '
  'taken from the org document library. Copies, never references: a document '
  'removed from the library must not take a snag''s record with it.';

-- Statements can be captured with the document in one go. The 3-argument
-- version is dropped rather than left alongside this one: two overloads that
-- differ only by a defaulted argument make a 3-argument call ambiguous to
-- PostgREST, and the clients call these by name.
drop function if exists public.add_witness_statement(uuid, text, text);

create function public.add_witness_statement(
  p_snag_id uuid,
  p_witness_name text,
  p_statement_text text,
  p_media_path text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_investigation_access(p_snag_id);
  v_id uuid;
begin
  insert into public.witness_statements (snag_id, witness_name, statement_text, taken_by, media_path)
    values (p_snag_id, p_witness_name, p_statement_text, auth.uid(), nullif(btrim(coalesce(p_media_path, '')), ''))
    returning id into v_id;

  perform public.mark_in_progress_if_flagged(p_snag_id);

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'witness_statement_added', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.add_witness_statement(uuid, text, text, text) to authenticated;
revoke execute on function public.add_witness_statement(uuid, text, text, text) from public, anon;

-- Attaching to a statement already taken. Refused once the statement is
-- locked, which is the whole point of the lock: a statement that can grow a
-- new document after it was sealed was never sealed.
create function public.attach_witness_document(p_statement_id uuid, p_media_path text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_statement public.witness_statements;
  v_snag public.snags;
begin
  select * into v_statement from public.witness_statements where id = p_statement_id;
  if v_statement is null then
    raise exception 'Witness statement not found';
  end if;

  v_snag := public.require_investigation_access(v_statement.snag_id);

  if v_statement.locked then
    raise exception 'This statement is locked — its document cannot be changed';
  end if;

  update public.witness_statements
    set media_path = nullif(btrim(coalesce(p_media_path, '')), '')
    where id = p_statement_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', v_statement.snag_id, 'witness_document_attached', auth.uid());
end;
$$;

grant execute on function public.attach_witness_document(uuid, text) to authenticated;
revoke execute on function public.attach_witness_document(uuid, text) from public, anon;

commit;
