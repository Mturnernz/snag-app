-- Phase 4 of Multi-Org-Support-Proposal.md: public organisations.
--
-- Orgs can opt into "public" mode: anyone with an account can submit a snag
-- to them (into a designated intake site) and can see only the snags they
-- themselves submitted. Public reporters have NO org membership — they are
-- just an identity (profiles row with org_id null) plus their authored snags.
--
-- Bundled security fix: snags_with_details was owned by postgres with no
-- security_invoker flag, meaning the view BYPASSED row-level security — any
-- authenticated user could read every organisation's snags through it.
-- security_invoker = true makes the snags/profiles/etc policies apply through
-- the view. The new `reporter_id = auth.uid()` branch on the snags policy is
-- simultaneously the public-reporter visibility rule and the fix's
-- compatibility path for members' own cross-org reports.

-- ── 1. Columns & tables ──────────────────────────────────────────────────────

alter table public.organisations
  add column is_public boolean not null default false,
  add column public_intake_site_id uuid references public.sites(id);

alter table public.snags
  add column is_public_submission boolean not null default false;

create table public.public_report_blocks (
  org_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  blocked_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- RPC-only access; no client policies.
alter table public.public_report_blocks enable row level security;

-- ── 2. Security fix: RLS applies through the list/detail view ────────────────

alter view public.snags_with_details set (security_invoker = true);

-- "You can always see what you reported" — the public reporter's entire
-- visibility rule, and members' own cross-org reports for free.
drop policy "members can view snags at sites they can see" on public.snags;
create policy "members can view snags at sites they can see"
  on public.snags for select
  using (
    (org_id = public.current_org_id() and public.can_view_site(site_id))
    or reporter_id = auth.uid()
  );

-- Staff need to see the names of people who reported into their org, even
-- when the reporter is not a member (public submissions).
create function public.reported_into_org(p_user_id uuid, p_org_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.snags
    where reporter_id = p_user_id and org_id = p_org_id
  );
$$;

drop policy "org members can view profiles in their org" on public.profiles;
create policy "org members can view profiles in their org"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_member_of_org(profiles.id, public.current_org_id())
    or public.reported_into_org(profiles.id, public.current_org_id())
  );

-- ── 3. Storage: public reporters upload to their own user folder ─────────────
-- The existing snag-photos policies are org-folder-scoped
-- ((foldername)[1] = current_org_id()), which a public reporter can never
-- satisfy. They upload under their own auth.uid() folder instead, and anyone
-- who can see a snag can fetch the photos attached to it.

create policy "users can upload snag photos to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'snag-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "photos attached to visible snags are viewable"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'snag-photos'
    and exists (
      select 1 from public.snags s
      where s.photo_path = name or name = any (s.photo_paths)
    )
  );

-- ── 4. Enable/disable public mode ────────────────────────────────────────────

create function public.set_org_public_mode(p_enabled boolean, p_intake_site_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can change public mode';
  end if;

  if p_enabled then
    if p_intake_site_id is null then
      raise exception 'Pick a site to receive public reports';
    end if;
    if not exists (select 1 from public.sites where id = p_intake_site_id and org_id = v_org_id) then
      raise exception 'That site does not belong to your organisation';
    end if;
    update public.organisations
      set is_public = true, public_intake_site_id = p_intake_site_id
      where id = v_org_id;
  else
    update public.organisations set is_public = false where id = v_org_id;
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id,
            case when p_enabled then 'public_mode_enabled' else 'public_mode_disabled' end,
            auth.uid());
end;
$$;

grant execute on function public.set_org_public_mode(boolean, uuid) to authenticated;

-- ── 5. Public directory & submission ─────────────────────────────────────────

create function public.search_public_orgs(p_query text default null)
returns table (org_id uuid, org_name text)
language sql stable security definer set search_path = public as $$
  select id, name from public.organisations
  where is_public
    and (p_query is null or btrim(p_query) = '' or name ilike '%' || btrim(p_query) || '%')
  order by name
  limit 30;
$$;

grant execute on function public.search_public_orgs(text) to authenticated;

create function public.create_public_snag(
  p_org_id uuid,
  p_description text,
  p_photo_paths text[] default '{}',
  p_is_hazard boolean default false,
  p_reporter_name text default null
)
returns table (id uuid, reference text)
language plpgsql security definer set search_path = public as $$
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

  -- Public reporters may have no profile yet (they never joined an org);
  -- create a minimal org-less identity on first report.
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

grant execute on function public.create_public_snag(uuid, text, text[], boolean, text) to authenticated;

-- ── 6. Blocking abusive reporters ────────────────────────────────────────────

create function public.block_public_reporter(p_snag_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can block a reporter';
  end if;

  select * into v_snag from public.snags
    where id = p_snag_id and org_id = v_org_id and is_public_submission;
  if v_snag.id is null then
    raise exception 'Public report not found in your organisation';
  end if;

  insert into public.public_report_blocks (org_id, user_id, blocked_by)
    values (v_org_id, v_snag.reporter_id, auth.uid())
    on conflict do nothing;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'profile', v_snag.reporter_id, 'public_reporter_blocked', auth.uid());
end;
$$;

grant execute on function public.block_public_reporter(uuid) to authenticated;
