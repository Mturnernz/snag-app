-- Officer/governance due-diligence export (Governance & Contractors, Phase 3).
--
-- get_org_stats and get_site_breakdown already exist and power ReportsScreen
-- and AdminDashboardScreen, but there's no artefact an officer can actually
-- keep on file to evidence due diligence — this adds a periodic PDF export
-- of the same data, restricted to officer_admin (narrower than the
-- supervisor-or-admin gate on export-investigation, since this is an
-- org-wide governance artefact rather than a single incident's record).
-- Same table/bucket/RPC shape as investigation_files/record_investigation_export
-- (20260621084954_m5_on_record.sql).

create table public.governance_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  file_path text not null,
  generated_by uuid not null references public.profiles(id),
  generated_at timestamptz not null default now(),
  period_start date not null,
  period_end date not null
);

create index on public.governance_reports (org_id);

alter table public.governance_reports enable row level security;

create policy "org members can view governance reports"
  on public.governance_reports for select
  using (org_id = public.current_org_id());

insert into storage.buckets (id, name, public) values ('governance-reports', 'governance-reports', false);

create policy "org members can view their org's governance reports"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'governance-reports'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

create function public.record_governance_export(p_file_path text, p_period_start date, p_period_end date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_id uuid;
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can export the governance report';
  end if;

  insert into public.governance_reports (org_id, file_path, generated_by, period_start, period_end)
    values (v_org_id, p_file_path, auth.uid(), p_period_start, p_period_end)
    returning id into v_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'governance_report_exported', auth.uid());

  return v_id;
end;
$$;

grant execute on function public.record_governance_export(text, date, date) to authenticated;
revoke execute on function public.record_governance_export(text, date, date) from public, anon;
