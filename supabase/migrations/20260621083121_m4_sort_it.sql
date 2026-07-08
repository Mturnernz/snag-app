-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

-- M4: Sort it (serious depth).
-- Conditional guided investigation for Hazard/Incident snags: first-response
-- checklist, locked witness statements, evidence, root cause, corrective
-- actions, then status -> Sorted. Light-lane sort (assign -> done -> note)
-- was already wired in M3; this migration only adds serious-lane depth and
-- tightens update_snag_status so a serious snag can't be marked Sorted
-- until the guided path is actually complete.

create type public.checklist_step as enum (
  'make_safe', 'preserve_scene', 'capture_evidence', 'identify_witnesses', 'find_root_cause'
);

create type public.corrective_action_status as enum ('open', 'done');

create table public.checklist_completions (
  snag_id uuid not null references public.snags(id) on delete cascade,
  step public.checklist_step not null,
  completed_by uuid not null references public.profiles(id),
  completed_at timestamptz not null default now(),
  primary key (snag_id, step)
);

create table public.witness_statements (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  witness_name text not null,
  statement_text text not null,
  taken_by uuid not null references public.profiles(id),
  taken_at timestamptz not null default now(),
  locked boolean not null default true,
  locked_at timestamptz default now()
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  media_path text not null,
  caption text,
  captured_at timestamptz not null default now(),
  sort_index int not null default 0
);

create table public.investigations (
  snag_id uuid primary key references public.snags(id) on delete cascade,
  root_cause_text text not null,
  lead_investigator_id uuid not null references public.profiles(id),
  completed_at timestamptz not null default now()
);

create table public.corrective_actions (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  description text not null,
  owner_id uuid not null references public.profiles(id),
  due_date date not null,
  status public.corrective_action_status not null default 'open',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index on public.checklist_completions (snag_id);
create index on public.witness_statements (snag_id);
create index on public.evidence_items (snag_id);
create index on public.corrective_actions (snag_id);
create index on public.corrective_actions (owner_id);

alter table public.checklist_completions enable row level security;
alter table public.witness_statements enable row level security;
alter table public.evidence_items enable row level security;
alter table public.investigations enable row level security;
alter table public.corrective_actions enable row level security;

-- All four are org-scoped via their snag; writes go through RPCs below.
create policy "org members can view checklist progress"
  on public.checklist_completions for select
  using (exists (select 1 from public.snags s where s.id = checklist_completions.snag_id and s.org_id = public.current_org_id()));

create policy "org members can view witness statements"
  on public.witness_statements for select
  using (exists (select 1 from public.snags s where s.id = witness_statements.snag_id and s.org_id = public.current_org_id()));

create policy "org members can view evidence"
  on public.evidence_items for select
  using (exists (select 1 from public.snags s where s.id = evidence_items.snag_id and s.org_id = public.current_org_id()));

create policy "org members can view investigations"
  on public.investigations for select
  using (exists (select 1 from public.snags s where s.id = investigations.snag_id and s.org_id = public.current_org_id()));

create policy "org members can view corrective actions"
  on public.corrective_actions for select
  using (exists (select 1 from public.snags s where s.id = corrective_actions.snag_id and s.org_id = public.current_org_id()));

-- Evidence storage: same org-prefixed convention as snag-photos.
insert into storage.buckets (id, name, public) values ('snag-evidence', 'snag-evidence', false);

create policy "org members can upload evidence to their org folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'snag-evidence'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create policy "org members can view their org's evidence"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'snag-evidence'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

-- Helper: only a supervisor/admin may run the guided investigation, and
-- only on a serious-lane snag belonging to their org. Used by every RPC below.
create function public.require_serious_snag(p_snag_id uuid)
returns public.snags
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = public.current_org_id();
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if v_snag.lane <> 'serious' then
    raise exception 'Only hazard/incident snags have a guided investigation';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can run the investigation';
  end if;
  return v_snag;
end;
$$;

revoke execute on function public.require_serious_snag(uuid) from anon, authenticated;

-- RPCs ------------------------------------------------------------------

create function public.complete_checklist_step(p_snag_id uuid, p_step public.checklist_step)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
begin
  insert into public.checklist_completions (snag_id, step, completed_by)
    values (p_snag_id, p_step, auth.uid())
    on conflict (snag_id, step) do nothing;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'checklist_' || p_step, auth.uid());
end;
$$;

grant execute on function public.complete_checklist_step(uuid, public.checklist_step) to authenticated;

create function public.add_witness_statement(p_snag_id uuid, p_witness_name text, p_statement_text text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
  v_id uuid;
begin
  insert into public.witness_statements (snag_id, witness_name, statement_text, taken_by)
    values (p_snag_id, p_witness_name, p_statement_text, auth.uid())
    returning id into v_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'witness_statement_added', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.add_witness_statement(uuid, text, text) to authenticated;

create function public.add_evidence_item(p_snag_id uuid, p_media_path text, p_caption text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
  v_id uuid;
  v_next_index int;
begin
  select coalesce(max(sort_index) + 1, 0) into v_next_index from public.evidence_items where snag_id = p_snag_id;

  insert into public.evidence_items (snag_id, uploaded_by, media_path, caption, sort_index)
    values (p_snag_id, auth.uid(), p_media_path, p_caption, v_next_index)
    returning id into v_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'evidence_added', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.add_evidence_item(uuid, text, text) to authenticated;

create function public.set_root_cause(p_snag_id uuid, p_root_cause_text text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
begin
  insert into public.investigations (snag_id, root_cause_text, lead_investigator_id, completed_at)
    values (p_snag_id, p_root_cause_text, auth.uid(), now())
    on conflict (snag_id) do update
      set root_cause_text = excluded.root_cause_text,
          lead_investigator_id = excluded.lead_investigator_id,
          completed_at = now();

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'root_cause_set', auth.uid());
end;
$$;

grant execute on function public.set_root_cause(uuid, text) to authenticated;

create function public.create_corrective_action(
  p_snag_id uuid, p_description text, p_owner_id uuid, p_due_date date
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_owner_id and org_id = v_snag.org_id) then
    raise exception 'That person does not belong to your organisation';
  end if;

  insert into public.corrective_actions (snag_id, description, owner_id, due_date)
    values (p_snag_id, p_description, p_owner_id, p_due_date)
    returning id into v_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag', p_snag_id, 'corrective_action_created', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.create_corrective_action(uuid, text, uuid, date) to authenticated;

create function public.complete_corrective_action(p_action_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_action public.corrective_actions;
  v_org_id uuid := public.current_org_id();
begin
  select ca.* into v_action
    from public.corrective_actions ca
    join public.snags s on s.id = ca.snag_id
    where ca.id = p_action_id and s.org_id = v_org_id;

  if v_action is null then
    raise exception 'Corrective action not found';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') and auth.uid() <> v_action.owner_id then
    raise exception 'Only the owner, a supervisor or an admin can close this action';
  end if;

  update public.corrective_actions set status = 'done', completed_at = now() where id = p_action_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'corrective_action', p_action_id, 'completed', auth.uid());
end;
$$;

grant execute on function public.complete_corrective_action(uuid) to authenticated;

-- Tighten update_snag_status: a serious snag can only move to Sorted once
-- the full guided path is complete (all 5 checklist steps, at least one
-- witness statement, at least one evidence item, a recorded root cause,
-- and every corrective action closed). Niggle behaviour is unchanged.
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
  if public.current_role() not in ('officer_admin', 'supervisor') and auth.uid() <> v_snag.owner_id then
    raise exception 'Only the owner, a supervisor or an admin can change this snag''s status';
  end if;

  if p_status = 'sorted' and v_snag.lane = 'serious' then
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
