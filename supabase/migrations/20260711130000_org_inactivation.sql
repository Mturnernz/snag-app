-- Let an org's officer_admin ("owner") deactivate it. Deactivating:
--   - hides it from every org picker/list (get_my_memberships exposes an
--     org_active flag; client code filters on it everywhere except the
--     admin tab's own "your organisations" management list)
--   - blocks new snag submissions (member and public), viewing snags (except
--     for that org's own officer_admins, who still need to manage/reactivate
--     it), joining via QR/code, and inviting new people
-- This is a whole-org flag, not per-user — it affects every member.

alter table public.organisations add column is_active boolean not null default true;

create or replace function public.is_org_active(p_org_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce((select o.is_active from public.organisations o where o.id = p_org_id), false);
$$;

create or replace function public.set_organisation_active(p_org_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.org_memberships m
    where m.user_id = auth.uid() and m.org_id = p_org_id
      and m.removed_at is null and m.role = 'officer_admin'
  ) then
    raise exception 'Only an admin of that organisation can change its active status';
  end if;

  update public.organisations set is_active = p_active where id = p_org_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (p_org_id, 'organisation', p_org_id, case when p_active then 'activated' else 'deactivated' end, auth.uid());
end;
$$;

grant execute on function public.set_organisation_active(uuid, boolean) to authenticated;

-- Add an org_active flag alongside the existing "is this my current pick"
-- is_active flag, so clients can tell the two apart and filter accordingly.
drop function if exists public.get_my_memberships();

create function public.get_my_memberships()
returns table(org_id uuid, org_name text, role user_role, is_active boolean, org_active boolean)
language sql
stable security definer
set search_path to 'public'
as $$
  select m.org_id, o.name, m.role,
    m.org_id = (select uao.org_id from public.user_active_org uao where uao.user_id = auth.uid()),
    o.is_active
  from public.org_memberships m
  join public.organisations o on o.id = m.org_id
  where m.user_id = auth.uid() and m.removed_at is null
  order by o.name;
$$;

-- Block new snag submissions into an inactive org.
create or replace function public.create_snag(
  p_kind public.snag_kind,
  p_description text default null,
  p_severity public.snag_severity default null,
  p_photo_paths text[] default '{}',
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_site_id uuid default null
)
returns table (id uuid, reference text)
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_site_id uuid := p_site_id;
  v_snag_id uuid;
  v_photo_paths text[] := coalesce(p_photo_paths, '{}');
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if not public.is_org_active(v_org_id) then
    raise exception 'This organisation is no longer active';
  end if;

  if v_site_id is null then
    select site_id into v_site_id from public.site_members where user_id = auth.uid() limit 1;
  end if;
  if v_site_id is null then
    raise exception 'You are not assigned to a site yet';
  end if;
  if not exists (select 1 from public.sites where public.sites.id = v_site_id and public.sites.org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;
  if array_length(v_photo_paths, 1) > 5 then
    raise exception 'A maximum of 5 photos are allowed';
  end if;

  insert into public.snags (
    org_id, site_id, reporter_id, kind, severity, description, photo_path, photo_paths, latitude, longitude
  ) values (
    v_org_id, v_site_id, auth.uid(), p_kind, p_severity, p_description,
    v_photo_paths[1], v_photo_paths, p_latitude, p_longitude
  ) returning public.snags.id into v_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', v_snag_id, 'created', auth.uid());

  return query select v_snag_id, s.reference from public.snags s where s.id = v_snag_id;
end;
$$;

-- Block public submissions into an inactive org.
create or replace function public.create_public_snag(
  p_org_id uuid,
  p_description text,
  p_photo_paths text[] default '{}',
  p_is_hazard boolean default false,
  p_reporter_name text default null
)
returns table(id uuid, reference text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org public.organisations;
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

  select * into v_org from public.organisations where id = p_org_id;
  if v_org.id is null or not v_org.is_public or v_org.public_intake_site_id is null then
    raise exception 'This organisation does not accept public reports';
  end if;
  if not v_org.is_active then
    raise exception 'This organisation is no longer active';
  end if;

  if exists (
    select 1 from public.public_report_blocks
    where org_id = p_org_id and user_id = auth.uid()
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

  if not exists (select 1 from public.profiles where id = auth.uid()) then
    insert into public.profiles (id, org_id, name, email)
      values (auth.uid(), null, coalesce(btrim(p_reporter_name), ''), auth.email());
  elsif p_reporter_name is not null and btrim(p_reporter_name) <> '' then
    update public.profiles set name = btrim(p_reporter_name)
      where id = auth.uid() and name = '';
  end if;

  insert into public.snags (
    org_id, site_id, reporter_id, kind, severity, description,
    photo_path, photo_paths, is_public_submission
  ) values (
    p_org_id,
    v_org.public_intake_site_id,
    auth.uid(),
    case when p_is_hazard then 'hazard'::public.snag_kind else 'fixit'::public.snag_kind end,
    case when p_is_hazard then 'moderate'::public.snag_severity else null end,
    btrim(p_description),
    v_photo_paths[1],
    v_photo_paths,
    true
  ) returning public.snags.id into v_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (p_org_id, 'snag', v_snag_id, 'created_public', auth.uid());

  return query select v_snag_id, s.reference from public.snags s where s.id = v_snag_id;
end;
$$;

-- Block joining an inactive org, whether new or re-entering as an existing
-- member (e.g. rescanning its QR code).
create or replace function public.join_org_via_code(p_code text, p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org_id uuid;
  v_site_id uuid;
  v_has_profile boolean := exists (select 1 from public.profiles where id = auth.uid());
begin
  if auth.uid() is null then
    raise exception 'Must be signed in';
  end if;

  select id into v_org_id from public.organisations where join_code = p_code;
  if v_org_id is null then
    raise exception 'That join code is invalid';
  end if;
  if not public.is_org_active(v_org_id) then
    raise exception 'This organisation is no longer active';
  end if;

  if exists (
    select 1 from public.org_memberships
    where user_id = auth.uid() and org_id = v_org_id and removed_at is null
  ) then
    perform public.set_active_org(v_org_id);
    return;
  end if;

  if not v_has_profile then
    if p_name is null or btrim(p_name) = '' then
      raise exception 'Please enter your name';
    end if;
    insert into public.profiles (id, org_id, name, email, role)
      values (auth.uid(), v_org_id, btrim(p_name), auth.email(), 'worker');
  end if;

  insert into public.org_memberships (user_id, org_id, role)
    values (auth.uid(), v_org_id, 'worker')
    on conflict (user_id, org_id) do update set removed_at = null, role = 'worker';

  perform public.set_active_org(v_org_id);

  select id into v_site_id from public.sites where org_id = v_org_id order by created_at asc limit 1;
  if v_site_id is not null then
    insert into public.site_members (site_id, user_id) values (v_site_id, auth.uid())
      on conflict do nothing;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'joined_via_qr', auth.uid());
end;
$$;

-- An inactive org's join code no longer resolves, so the join-preview screen
-- can't find it either.
create or replace function public.get_org_by_join_code(p_code text)
returns table(org_id uuid, org_name text)
language sql
stable security definer
set search_path to 'public'
as $$
  select id, name from public.organisations where join_code = p_code and is_active;
$$;

-- Public org search/discovery excludes inactive orgs.
create or replace function public.search_public_orgs(p_query text default null)
returns table(org_id uuid, org_name text)
language sql
stable security definer
set search_path to 'public'
as $$
  select id, name from public.organisations
  where is_public and is_active
    and (p_query is null or btrim(p_query) = '' or name ilike '%' || btrim(p_query) || '%')
  order by name
  limit 30;
$$;

-- Block inviting new people into an inactive org.
create or replace function public.invite_user(p_email text, p_role public.user_role, p_site_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org_id uuid := public.current_org_id();
  v_invite_id uuid;
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can invite people';
  end if;
  if not public.is_org_active(v_org_id) then
    raise exception 'This organisation is no longer active';
  end if;
  if p_site_id is not null and not exists (
    select 1 from public.sites where id = p_site_id and org_id = v_org_id
  ) then
    raise exception 'That site does not belong to your organisation';
  end if;

  insert into public.invites (org_id, site_id, email, role, invited_by)
    values (v_org_id, p_site_id, lower(p_email), p_role, auth.uid())
    returning id into v_invite_id;
  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'invite', v_invite_id, 'created', auth.uid());

  return v_invite_id;
end;
$$;

-- Members can no longer view an inactive org's snags — except that org's own
-- officer_admins, who still need to review/manage it (and reactivate it).
drop policy if exists "members can view snags at sites they can see" on public.snags;
create policy "members can view snags at sites they can see" on public.snags
for select using (
  (org_id = current_org_id() and can_view_site(site_id) and (public.is_org_active(org_id) or public.current_role() = 'officer_admin'))
  or reporter_id = auth.uid()
);
