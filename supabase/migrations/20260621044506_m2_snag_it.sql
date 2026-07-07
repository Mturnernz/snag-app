-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

-- M2: Snag it — report flow with the four kinds, lane routing, feed,
-- status lifecycle, photo upload and auto time/GPS.
-- Fix-it / Improvement are the niggle lane (no investigation depth yet —
-- that lane's board + assignment lands in M3). Hazard / Incident are the
-- serious lane (realtime broadcast + guided investigation land in M3/M4).

create type public.snag_kind as enum ('fixit', 'improvement', 'hazard', 'incident');
create type public.snag_severity as enum ('minor', 'moderate', 'injury', 'critical');
create type public.snag_status as enum ('flagged', 'in_progress', 'sorted');

create sequence public.snag_reference_seq;

create table public.snags (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('SNAG-' || lpad(nextval('public.snag_reference_seq')::text, 5, '0')),
  org_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id),
  kind public.snag_kind not null,
  lane text not null generated always as (
    case when kind in ('fixit', 'improvement') then 'niggle' else 'serious' end
  ) stored,
  severity public.snag_severity,
  description text,
  photo_path text,
  occurred_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  status public.snag_status not null default 'flagged',
  created_at timestamptz not null default now(),
  check (description is not null or photo_path is not null),
  check (kind not in ('hazard', 'incident') or severity is not null)
);

create index on public.snags (org_id);
create index on public.snags (site_id);
create index on public.snags (reporter_id);

alter table public.snags enable row level security;

create policy "org members can view their org's snags"
  on public.snags for select
  using (org_id = public.current_org_id());

-- Writes go through a SECURITY DEFINER RPC (below) so org/site/reporter are
-- always set correctly and every snag is audited, matching the M1 pattern.

create function public.create_snag(
  p_kind public.snag_kind,
  p_description text default null,
  p_severity public.snag_severity default null,
  p_photo_path text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_site_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_site_id uuid := p_site_id;
  v_snag_id uuid;
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;

  if v_site_id is null then
    select site_id into v_site_id from public.site_members where user_id = auth.uid() limit 1;
  end if;
  if v_site_id is null then
    raise exception 'You are not assigned to a site yet';
  end if;
  if not exists (select 1 from public.sites where id = v_site_id and org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;

  insert into public.snags (
    org_id, site_id, reporter_id, kind, severity, description, photo_path, latitude, longitude
  ) values (
    v_org_id, v_site_id, auth.uid(), p_kind, p_severity, p_description, p_photo_path, p_latitude, p_longitude
  ) returning id into v_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', v_snag_id, 'created', auth.uid());

  return v_snag_id;
end;
$$;

grant execute on function public.create_snag(
  public.snag_kind, text, public.snag_severity, text, double precision, double precision, uuid
) to authenticated;

-- Photo storage: one bucket, objects path-prefixed by org_id so RLS can
-- scope access the same way as every other table.
insert into storage.buckets (id, name, public) values ('snag-photos', 'snag-photos', false);

create policy "org members can upload snag photos to their org folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'snag-photos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create policy "org members can view their org's snag photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'snag-photos'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );
