-- A supervisor can sign off their own investigation document.
--
-- This reverses the independent-acceptance rule added in 20260729000000. The
-- working assumption behind that rule was wrong: it treated attaching and
-- accepting as two people's jobs in every case. In practice a site lead
-- allocates the investigation to a crew, the crew completes it, and the
-- supervisor accepts — the two are already different people without a rule
-- forcing it. The rule only ever bit the case where a supervisor did the work
-- themselves, and there it produced a deadlock: an org whose only supervisor
-- attached the document had nobody left who could accept it, and the snag
-- could not be resolved at all.
--
-- Blocking a legitimate closure is a worse failure than recording a self-
-- signed one, so the check goes and the *record* carries the fact instead.
-- document_attached_by is still stamped, so an auditor reading the
-- investigation can see when the attacher and the acceptor are the same
-- person. That was always the more useful half; preventing it was not.
--
-- Note the asymmetry with corrective actions, which keep their
-- verifier-cannot-be-owner rule. That one is about a task someone was assigned
-- and marked done themselves. This one is about an organisation's completed
-- investigation, which the supervisor is accountable for either way.

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

  update public.investigations
    set document_accepted_by = auth.uid(),
        document_accepted_at = now()
    where snag_id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'investigation_document_accepted', auth.uid());
end;
$$;
