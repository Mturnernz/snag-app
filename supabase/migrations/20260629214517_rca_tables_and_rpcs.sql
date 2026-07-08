-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

-- P1.1: Delegated Root Cause Analysis (RCA / 5 Whys).
--
-- A supervisor/admin can assign an RCA on any sorted serious snag to any
-- org member (worker included). This moves the snag sorted -> rca_pending.
-- The assignee completes a guided 5-Whys form; submitting calls the
-- existing set_root_cause RPC so the "mark sorted" gate in
-- update_snag_status (which checks investigations existence) keeps
-- working unchanged. Accepting returns the snag to sorted; rejecting
-- keeps it at rca_pending and reopens the RCA for editing.

create type public.rca_status as enum ('assigned', 'in_progress', 'submitted', 'accepted', 'rejected');

create table public.snag_rca (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  assigned_to uuid not null references public.profiles(id),
  assigned_by uuid not null references public.profiles(id),
  status public.rca_status not null default 'assigned',
  rejection_note text,
  submitted_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.rca_why_steps (
  id uuid primary key default gen_random_uuid(),
  rca_id uuid not null references public.snag_rca(id) on delete cascade,
  why_index int not null check (why_index between 1 and 5),
  why_text text not null,
  answer_text text not null,
  updated_at timestamptz not null default now(),
  unique (rca_id, why_index)
);

create index on public.snag_rca (snag_id);
create index on public.snag_rca (assigned_to);
create index on public.rca_why_steps (rca_id);

alter table public.snag_rca enable row level security;
alter table public.rca_why_steps enable row level security;

-- Same join-based RLS convention as checklist_completions/investigations/
-- corrective_actions: no denormalized org_id, join through snag_id ->
-- snags.org_id. All writes go through security definer RPCs below, so
-- there are no insert/update/delete policies, matching that precedent.
create policy "org members can view rca"
  on public.snag_rca for select
  using (exists (select 1 from public.snags s where s.id = snag_rca.snag_id and s.org_id = public.current_org_id()));

create policy "org members can view rca why steps"
  on public.rca_why_steps for select
  using (
    exists (
      select 1 from public.snag_rca r
      join public.snags s on s.id = r.snag_id
      where r.id = rca_why_steps.rca_id and s.org_id = public.current_org_id()
    )
  );

-- RCA notification recipients (assigned_to / assigned_by) live on
-- snag_rca, not on snags, so dispatch_snag_notification can't resolve
-- them. This is a parallel function, modeled exactly on it.
create function public.dispatch_rca_notification(p_rca_id uuid, p_event text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
  v_snag_id uuid;
begin
  select snag_id into v_snag_id from public.snag_rca where id = p_rca_id;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'snag_internal_secret';

  perform net.http_post(
    url := 'https://wpkdpukpllxuyqqlxkxf.supabase.co/functions/v1/notify-snag',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-snag-internal-secret', v_secret
    ),
    body := jsonb_build_object('event', p_event, 'snag_id', v_snag_id, 'rca_id', p_rca_id)
  );
exception when others then
  null;
end;
$$;

-- RPCs --------------------------------------------------------------

-- Supervisor/admin only, via require_serious_snag (already excludes
-- workers via can_edit_site). Snag must currently be sorted.
create function public.assign_rca(p_snag_id uuid, p_assignee_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
  v_id uuid;
begin
  if v_snag.status <> 'sorted' then
    raise exception 'An RCA can only be assigned on a sorted snag';
  end if;
  if not exists (select 1 from public.profiles where id = p_assignee_id and org_id = v_snag.org_id) then
    raise exception 'That person does not belong to your organisation';
  end if;

  insert into public.snag_rca (snag_id, assigned_to, assigned_by)
    values (p_snag_id, p_assignee_id, auth.uid())
    returning id into v_id;

  update public.snags set status = 'rca_pending' where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'rca_assigned', auth.uid());

  perform public.dispatch_rca_notification(v_id, 'rca_assigned');

  return v_id;
end;
$$;

grant execute on function public.assign_rca(uuid, uuid) to authenticated;

-- Plain org lookup, NOT require_serious_snag (that would wrongly block a
-- worker-assignee via its internal can_edit_site check). Permission:
-- the assignee themselves, or anyone who can edit the snag's site.
create function public.save_rca_why(p_rca_id uuid, p_why_index int, p_why_text text, p_answer_text text)
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
  if auth.uid() <> v_rca.assigned_to and not public.can_edit_site(v_snag.site_id) then
    raise exception 'Only the assignee, a supervisor of this site, or an admin can edit this RCA';
  end if;
  if v_rca.status not in ('assigned', 'in_progress', 'rejected') then
    raise exception 'This RCA can no longer be edited';
  end if;

  insert into public.rca_why_steps (rca_id, why_index, why_text, answer_text)
    values (p_rca_id, p_why_index, p_why_text, p_answer_text)
    on conflict (rca_id, why_index) do update
      set why_text = excluded.why_text, answer_text = excluded.answer_text, updated_at = now();

  if v_rca.status = 'assigned' then
    update public.snag_rca set status = 'in_progress' where id = p_rca_id;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_rca', p_rca_id, 'why_step_saved', auth.uid());
end;
$$;

grant execute on function public.save_rca_why(uuid, int, text, text) to authenticated;

-- Submitting builds a combined root-cause text from the 5 why steps and
-- calls the existing set_root_cause RPC, so the "mark sorted" gate in
-- update_snag_status keeps working unchanged.
create function public.submit_rca(p_rca_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rca public.snag_rca;
  v_snag public.snags;
  v_step_count int;
  v_combined text;
begin
  select * into v_rca from public.snag_rca where id = p_rca_id;
  if v_rca is null then
    raise exception 'RCA not found';
  end if;
  select * into v_snag from public.snags where id = v_rca.snag_id and org_id = public.current_org_id();
  if v_snag is null then
    raise exception 'RCA not found';
  end if;
  if auth.uid() <> v_rca.assigned_to and not public.can_edit_site(v_snag.site_id) then
    raise exception 'Only the assignee, a supervisor of this site, or an admin can submit this RCA';
  end if;
  if v_rca.status not in ('in_progress', 'rejected') then
    raise exception 'This RCA is not ready to submit';
  end if;

  select count(*) into v_step_count from public.rca_why_steps where rca_id = p_rca_id;
  if v_step_count < 5 then
    raise exception 'Answer all five whys before submitting';
  end if;

  select string_agg('Why ' || why_index || ': ' || why_text || ' -> ' || answer_text, e'\n' order by why_index)
    into v_combined
    from public.rca_why_steps where rca_id = p_rca_id;

  update public.snag_rca
    set status = 'submitted', submitted_at = now(), rejection_note = null
    where id = p_rca_id;

  perform public.set_root_cause(v_snag.id, v_combined);

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_rca', p_rca_id, 'submitted', auth.uid());

  perform public.dispatch_rca_notification(p_rca_id, 'rca_submitted');
end;
$$;

grant execute on function public.submit_rca(uuid) to authenticated;

-- Accept: supervisor/admin only. Returns the snag to sorted. Terminal.
create function public.accept_rca(p_rca_id uuid)
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
  v_snag := public.require_serious_snag(v_rca.snag_id);
  if v_rca.status <> 'submitted' then
    raise exception 'Only a submitted RCA can be accepted';
  end if;

  update public.snag_rca
    set status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
    where id = p_rca_id;

  update public.snags set status = 'sorted' where id = v_snag.id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_rca', p_rca_id, 'accepted', auth.uid());
end;
$$;

grant execute on function public.accept_rca(uuid) to authenticated;

-- Reject: supervisor/admin only. Snag stays rca_pending; RCA reopens for
-- editing with a visible rejection note.
create function public.reject_rca(p_rca_id uuid, p_rejection_note text)
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
  v_snag := public.require_serious_snag(v_rca.snag_id);
  if v_rca.status <> 'submitted' then
    raise exception 'Only a submitted RCA can be rejected';
  end if;
  if p_rejection_note is null or btrim(p_rejection_note) = '' then
    raise exception 'A rejection note is required';
  end if;

  update public.snag_rca
    set status = 'rejected', rejection_note = p_rejection_note, submitted_at = null
    where id = p_rca_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_rca', p_rca_id, 'rejected', auth.uid());

  perform public.dispatch_rca_notification(p_rca_id, 'rca_rejected');
end;
$$;

grant execute on function public.reject_rca(uuid, text) to authenticated;

-- update_snag_status: rca_pending is only ever set by assign_rca/accept_rca
-- directly, never via this generic RPC, and a snag with an RCA in flight
-- can't have its status changed by any other path until accept/reject.
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
    raise exception 'Niggles use resolve_snag / confirm_snag instead';
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

  if p_status = 'sorted' then
    select count(*) into v_checklist_count from public.checklist_completions where snag_id = p_snag_id;
    select count(*) into v_statement_count from public.witness_statements where snag_id = p_snag_id;
    select count(*) into v_evidence_count from public.evidence_items where snag_id = p_snag_id;
    select count(*) into v_open_actions from public.corrective_actions where snag_id = p_snag_id and status = 'open';
    select exists(select 1 from public.investigations where snag_id = p_snag_id) into v_has_root_cause;

    if v_checklist_count < 5 then
      raise exception 'Finish the first-response checklist before marking this sorted';
    end if;
    if v_statement_count = 0 then
      raise exception 'Add at least one witness statement before marking this sorted';
    end if;
    if v_evidence_count = 0 then
      raise exception 'Add at least one piece of evidence before marking this sorted';
    end if;
    if not v_has_root_cause then
      raise exception 'Record a root cause before marking this sorted';
    end if;
    if v_open_actions > 0 then
      raise exception 'Close every corrective action before marking this sorted';
    end if;
  end if;

  update public.snags
    set status = p_status, resolution_note = coalesce(p_note, resolution_note)
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_' || p_status, auth.uid());
end;
$$;
