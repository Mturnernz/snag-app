-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

-- M3: Everyone knows + the Snag board.
-- Realtime broadcast (serious snags) + email notifications, the shared
-- Snag board with owner assignment for niggles, per-site default owners,
-- seen-by, and the close-the-loop notification when a snag is Sorted.
--
-- Email delivery goes through an Edge Function (notify-snag) called via
-- pg_net from triggers below. Until a Resend API key is configured in
-- Supabase secrets, the function logs and no-ops instead of sending —
-- everything else (realtime, board, assignment, seen-by) works regardless.

create extension if not exists pg_net;

alter table public.snags add column owner_id uuid references public.profiles(id);
alter table public.snags add column assigned_at timestamptz;
alter table public.snags add column resolution_note text;

create table public.site_default_owners (
  site_id uuid primary key references public.sites(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.snag_views (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references public.snags(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  viewed_at timestamptz not null default now(),
  unique (snag_id, user_id)
);

create index on public.snag_views (snag_id);

alter table public.site_default_owners enable row level security;
alter table public.snag_views enable row level security;

create policy "org members can view default owners"
  on public.site_default_owners for select
  using (
    exists (
      select 1 from public.sites s
      where s.id = site_default_owners.site_id and s.org_id = public.current_org_id()
    )
  );

create policy "org members can view seen-by"
  on public.snag_views for select
  using (
    exists (
      select 1 from public.snags s
      where s.id = snag_views.snag_id and s.org_id = public.current_org_id()
    )
  );

-- Dispatch helper: fire-and-forget call to the notify-snag Edge Function.
-- Failures here must never block the underlying snag write, so trap errors.
create function public.dispatch_snag_notification(p_snag_id uuid, p_event text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://wpkdpukpllxuyqqlxkxf.supabase.co/functions/v1/notify-snag',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('event', p_event, 'snag_id', p_snag_id)
  );
exception when others then
  null;
end;
$$;

-- Niggles get a default owner automatically if the site has one set.
create function public.apply_default_owner()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lane = 'niggle' and new.owner_id is null then
    select owner_id into new.owner_id from public.site_default_owners where site_id = new.site_id;
    if new.owner_id is not null then
      new.assigned_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger snags_apply_default_owner
  before insert on public.snags
  for each row execute function public.apply_default_owner();

create function public.notify_after_snag_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lane = 'serious' then
    perform public.dispatch_snag_notification(new.id, 'serious_created');
  elsif new.owner_id is not null then
    perform public.dispatch_snag_notification(new.id, 'niggle_assigned');
  end if;
  return new;
end;
$$;

create trigger snags_notify_after_insert
  after insert on public.snags
  for each row execute function public.notify_after_snag_insert();

create function public.notify_after_snag_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null and new.owner_id is distinct from old.owner_id then
    perform public.dispatch_snag_notification(new.id, 'niggle_assigned');
  end if;
  if new.status = 'sorted' and old.status is distinct from 'sorted' then
    perform public.dispatch_snag_notification(new.id, 'snag_sorted');
  end if;
  return new;
end;
$$;

create trigger snags_notify_after_update
  after update on public.snags
  for each row execute function public.notify_after_snag_update();

-- Realtime: clients subscribe to postgres_changes on snags; RLS still
-- applies, so a user only ever receives their own org's rows.
alter publication supabase_realtime add table public.snags;

-- RPCs ----------------------------------------------------------------

create function public.set_site_default_owner(p_site_id uuid, p_owner_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can set the default owner';
  end if;
  if not exists (select 1 from public.sites where id = p_site_id and org_id = v_org_id) then
    raise exception 'That site does not belong to your organisation';
  end if;
  if not exists (select 1 from public.profiles where id = p_owner_id and org_id = v_org_id) then
    raise exception 'That person does not belong to your organisation';
  end if;

  insert into public.site_default_owners (site_id, owner_id, updated_at)
    values (p_site_id, p_owner_id, now())
    on conflict (site_id) do update set owner_id = excluded.owner_id, updated_at = now();

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'site_default_owner', p_site_id, 'set', auth.uid());
end;
$$;

grant execute on function public.set_site_default_owner(uuid, uuid) to authenticated;

create function public.assign_snag_owner(p_snag_id uuid, p_owner_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can assign an owner';
  end if;
  if not exists (select 1 from public.snags where id = p_snag_id and org_id = v_org_id) then
    raise exception 'Snag not found';
  end if;
  if not exists (select 1 from public.profiles where id = p_owner_id and org_id = v_org_id) then
    raise exception 'That person does not belong to your organisation';
  end if;

  update public.snags set owner_id = p_owner_id, assigned_at = now() where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'owner_assigned', auth.uid());
end;
$$;

grant execute on function public.assign_snag_owner(uuid, uuid) to authenticated;

create function public.update_snag_status(p_snag_id uuid, p_status public.snag_status, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_snag public.snags;
begin
  select * into v_snag from public.snags where id = p_snag_id and org_id = v_org_id;
  if v_snag is null then
    raise exception 'Snag not found';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') and auth.uid() <> v_snag.owner_id then
    raise exception 'Only the owner, a supervisor or an admin can change this snag''s status';
  end if;

  update public.snags
    set status = p_status, resolution_note = coalesce(p_note, resolution_note)
    where id = p_snag_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'snag', p_snag_id, 'status_' || p_status, auth.uid());
end;
$$;

grant execute on function public.update_snag_status(uuid, public.snag_status, text) to authenticated;

create function public.mark_snag_seen(p_snag_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.snags where id = p_snag_id and org_id = public.current_org_id()) then
    raise exception 'Snag not found';
  end if;
  insert into public.snag_views (snag_id, user_id) values (p_snag_id, auth.uid())
    on conflict (snag_id, user_id) do nothing;
end;
$$;

grant execute on function public.mark_snag_seen(uuid) to authenticated;
