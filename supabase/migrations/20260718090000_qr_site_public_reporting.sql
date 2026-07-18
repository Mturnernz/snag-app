-- Phase 2.2 of the Pre-Launch Development Proposal: QR public reporting.
--
-- The existing "public organisation" feature (20260708090000_public_orgs.sql)
-- already covers a signed-in-but-org-less reporter browsing/searching public
-- orgs and submitting to one org-wide designated intake site. This adds a
-- second, narrower path: a per-site QR code that resolves straight to one
-- site (no browsing) via an opaque token, meant to be paired with Supabase
-- anonymous auth on the client so scanning the code needs no account at all.
--
-- The existing org-picker flow (create_public_snag, organisations.
-- public_intake_site_id) is untouched — this is additive, not a replacement.
-- organisations.is_public remains the master switch: a site's token only
-- resolves while its org is still public, so turning that off invalidates
-- every site's QR without deleting the tokens.

alter table public.sites
  add column public_report_token uuid unique default null;

-- Supervisor/admin toggles a site's QR reporting on/off. Calling again while
-- already enabled rotates the token, invalidating old QR codes/printouts —
-- same recovery pattern as regenerate_org_join_code.
create function public.set_site_public_intake(p_site_id uuid, p_enabled boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_token uuid;
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only a supervisor or admin can change public intake for a site';
  end if;
  if not exists (select 1 from public.sites where id = p_site_id and org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;

  if p_enabled then
    v_token := gen_random_uuid();
  else
    v_token := null;
  end if;
  update public.sites set public_report_token = v_token where id = p_site_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site', p_site_id,
            case when p_enabled then 'public_intake_enabled' else 'public_intake_disabled' end,
            auth.uid());

  return v_token;
end;
$$;

grant execute on function public.set_site_public_intake(uuid, boolean) to authenticated;
revoke execute on function public.set_site_public_intake(uuid, boolean) from public, anon;

-- Anonymous-readable lookup so a QR scan can show "Reporting at <site>,
-- <org>" before the reporter has any session at all. Mirrors
-- get_org_by_join_code's anon+authenticated grant.
create function public.get_site_by_public_token(p_token uuid)
returns table (org_id uuid, org_name text, site_id uuid, site_name text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, s.id, s.name
  from public.sites s
  join public.organisations o on o.id = s.org_id
  where s.public_report_token = p_token and o.is_public;
$$;

grant execute on function public.get_site_by_public_token(uuid) to anon, authenticated;

-- QR-specific submission: resolves org/site from the token server-side
-- (never trusted from the client), so a reporter can't spoof which org/site
-- a report lands in. Mirrors create_public_snag's rate-limit, abuse-block
-- and org-less-profile-on-first-use logic; the real differences are site
-- resolution and coalescing auth.email() to '', since it's null for an
-- anonymous-auth session and profiles.email is not null.
create function public.create_public_snag_by_token(
  p_token uuid,
  p_description text,
  p_photo_paths text[] default '{}',
  p_is_hazard boolean default false,
  p_reporter_name text default null
)
returns table (id uuid, reference text)
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
  v_site_id uuid;
  v_snag_id uuid;
  v_photo_paths text[] := coalesce(p_photo_paths, '{}');
  v_recent int;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;
  if p_description is null or btrim(p_description) = '' then
    raise exception 'Please describe the issue';
  end if;
  if array_length(v_photo_paths, 1) > 5 then
    raise exception 'A maximum of 5 photos are allowed';
  end if;

  select o.id, s.id into v_org_id, v_site_id
  from public.sites s
  join public.organisations o on o.id = s.org_id
  where s.public_report_token = p_token and o.is_public;

  if v_org_id is null then
    raise exception 'This QR code is no longer active';
  end if;

  if exists (
    select 1 from public.public_report_blocks
    where org_id = v_org_id and user_id = auth.uid()
  ) then
    raise exception 'This organisation is not accepting reports from your account';
  end if;

  select count(*) into v_recent from public.snags
    where reporter_id = auth.uid()
      and is_public_submission
      and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'You have reached the limit of public reports for now — please try again later';
  end if;

  -- Public/anonymous reporters may have no profile yet — create a minimal
  -- org-less identity on first report, same as create_public_snag.
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    insert into public.profiles (id, org_id, name, email)
      values (auth.uid(), null, coalesce(btrim(p_reporter_name), ''), coalesce(auth.email(), ''));
  elsif p_reporter_name is not null and btrim(p_reporter_name) <> '' then
    update public.profiles set name = btrim(p_reporter_name)
      where id = auth.uid() and name = '';
  end if;

  insert into public.snags (
    org_id, site_id, reporter_id, kind, severity, description,
    photo_path, photo_paths, is_public_submission
  ) values (
    v_org_id,
    v_site_id,
    auth.uid(),
    case when p_is_hazard then 'hazard'::public.snag_kind else 'fixit'::public.snag_kind end,
    case when p_is_hazard then 'moderate'::public.snag_severity else null end,
    btrim(p_description),
    v_photo_paths[1],
    v_photo_paths,
    true
  ) returning public.snags.id into v_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', v_snag_id, 'created_public', auth.uid());

  return query select v_snag_id, s.reference from public.snags s where s.id = v_snag_id;
end;
$$;

grant execute on function public.create_public_snag_by_token(uuid, text, text[], boolean, text) to authenticated;
revoke execute on function public.create_public_snag_by_token(uuid, text, text[], boolean, text) from public, anon;
