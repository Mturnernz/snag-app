-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

-- P1.2: Hot/formal debriefs on serious snags.
--
-- A supervisor/admin can run a hot or formal debrief on any serious snag,
-- in any status, any number of times. Each debrief captures findings,
-- attendees, and lessons learned. Corrective actions raised from a
-- debrief go through the existing create_corrective_action RPC directly
-- — there's no new linkage table, since corrective_actions already
-- references snag_id and that's enough to find them from the snag.

create type public.debrief_format as enum ('hot', 'formal');
create type public.debrief_status as enum ('in_progress', 'completed');

create table public.snag_debriefs (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  format public.debrief_format not null,
  status public.debrief_status not null default 'in_progress',
  started_by uuid not null references public.profiles(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.debrief_findings (
  id uuid primary key default gen_random_uuid(),
  debrief_id uuid not null references public.snag_debriefs(id) on delete cascade,
  finding_text text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.debrief_attendees (
  id uuid primary key default gen_random_uuid(),
  debrief_id uuid not null references public.snag_debriefs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (debrief_id, profile_id)
);

create table public.debrief_lessons (
  id uuid primary key default gen_random_uuid(),
  debrief_id uuid not null references public.snag_debriefs(id) on delete cascade,
  lesson_text text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index on public.snag_debriefs (snag_id);
create index on public.debrief_findings (debrief_id);
create index on public.debrief_attendees (debrief_id);
create index on public.debrief_lessons (debrief_id);

alter table public.snag_debriefs enable row level security;
alter table public.debrief_findings enable row level security;
alter table public.debrief_attendees enable row level security;
alter table public.debrief_lessons enable row level security;

-- Same join-based RLS convention as snag_rca/investigations/corrective_actions:
-- no denormalized org_id, join through snag_id/debrief_id -> snags.org_id.
-- All writes go through security definer RPCs, so there are no
-- insert/update/delete policies, matching that precedent.
create policy "org members can view debriefs"
  on public.snag_debriefs for select
  using (exists (select 1 from public.snags s where s.id = snag_debriefs.snag_id and s.org_id = public.current_org_id()));

create policy "org members can view debrief findings"
  on public.debrief_findings for select
  using (
    exists (
      select 1 from public.snag_debriefs d
      join public.snags s on s.id = d.snag_id
      where d.id = debrief_findings.debrief_id and s.org_id = public.current_org_id()
    )
  );

create policy "org members can view debrief attendees"
  on public.debrief_attendees for select
  using (
    exists (
      select 1 from public.snag_debriefs d
      join public.snags s on s.id = d.snag_id
      where d.id = debrief_attendees.debrief_id and s.org_id = public.current_org_id()
    )
  );

create policy "org members can view debrief lessons"
  on public.debrief_lessons for select
  using (
    exists (
      select 1 from public.snag_debriefs d
      join public.snags s on s.id = d.snag_id
      where d.id = debrief_lessons.debrief_id and s.org_id = public.current_org_id()
    )
  );

-- Helper RPCs ---------------------------------------------------------

-- Parallel to require_serious_snag but without its implicit status
-- restriction — debriefs apply regardless of snag status, open or
-- closed, any number of times.
create function public.require_debrief_access(p_debrief_id uuid)
returns public.snags
language plpgsql security definer set search_path = public as $$
declare
  v_snag_id uuid;
  v_snag public.snags;
begin
  select snag_id into v_snag_id from public.snag_debriefs where id = p_debrief_id;
  if v_snag_id is null then
    raise exception 'Debrief not found';
  end if;

  select * into v_snag from public.snags where id = v_snag_id and org_id = public.current_org_id();
  if v_snag is null then
    raise exception 'Debrief not found';
  end if;
  if v_snag.lane <> 'serious' then
    raise exception 'Only hazard/incident snags have debriefs';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can run a debrief';
  end if;

  return v_snag;
end;
$$;

-- RPCs ------------------------------------------------------------------

create function public.start_debrief(p_snag_id uuid, p_format public.debrief_format)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
  v_id uuid;
begin
  insert into public.snag_debriefs (snag_id, format, started_by)
    values (p_snag_id, p_format, auth.uid())
    returning id into v_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_debrief', v_id, 'debrief_started', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.start_debrief(uuid, public.debrief_format) to authenticated;

create function public.add_debrief_finding(p_debrief_id uuid, p_finding_text text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_debrief_access(p_debrief_id);
  v_status public.debrief_status;
  v_id uuid;
begin
  select status into v_status from public.snag_debriefs where id = p_debrief_id;
  if v_status <> 'in_progress' then
    raise exception 'This debrief is already completed';
  end if;

  insert into public.debrief_findings (debrief_id, finding_text, created_by)
    values (p_debrief_id, p_finding_text, auth.uid())
    returning id into v_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_debrief', p_debrief_id, 'finding_added', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.add_debrief_finding(uuid, text) to authenticated;

create function public.add_debrief_attendee(p_debrief_id uuid, p_profile_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_debrief_access(p_debrief_id);
  v_status public.debrief_status;
  v_id uuid;
begin
  select status into v_status from public.snag_debriefs where id = p_debrief_id;
  if v_status <> 'in_progress' then
    raise exception 'This debrief is already completed';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and org_id = v_snag.org_id) then
    raise exception 'That person does not belong to your organisation';
  end if;

  insert into public.debrief_attendees (debrief_id, profile_id)
    values (p_debrief_id, p_profile_id)
    on conflict (debrief_id, profile_id) do nothing
    returning id into v_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_debrief', p_debrief_id, 'attendee_added', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.add_debrief_attendee(uuid, uuid) to authenticated;

create function public.add_debrief_lesson(p_debrief_id uuid, p_lesson_text text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_debrief_access(p_debrief_id);
  v_status public.debrief_status;
  v_id uuid;
begin
  select status into v_status from public.snag_debriefs where id = p_debrief_id;
  if v_status <> 'in_progress' then
    raise exception 'This debrief is already completed';
  end if;

  insert into public.debrief_lessons (debrief_id, lesson_text, created_by)
    values (p_debrief_id, p_lesson_text, auth.uid())
    returning id into v_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_debrief', p_debrief_id, 'lesson_added', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.add_debrief_lesson(uuid, text) to authenticated;

-- Terminal — no reopen RPC. A new debrief can always be started instead,
-- since any number of debriefs are allowed per snag.
create function public.complete_debrief(p_debrief_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_debrief_access(p_debrief_id);
  v_status public.debrief_status;
begin
  select status into v_status from public.snag_debriefs where id = p_debrief_id;
  if v_status <> 'in_progress' then
    raise exception 'This debrief is already completed';
  end if;

  update public.snag_debriefs
    set status = 'completed', completed_at = now()
    where id = p_debrief_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_debrief', p_debrief_id, 'debrief_completed', auth.uid());
end;
$$;

grant execute on function public.complete_debrief(uuid) to authenticated;
