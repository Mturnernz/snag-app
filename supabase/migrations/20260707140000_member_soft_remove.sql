-- "Delete member" is implemented as a soft-remove, not a row delete: almost
-- every table (snags, comments, audit_log, RCA records...) has a FK to
-- profiles with no ON DELETE action, so a hard delete would either be
-- rejected outright or (if cascaded) destroy the H&S audit trail this app
-- exists to preserve. Instead, removed_at marks the profile inactive;
-- current_org_id()/current_role() (which gate virtually every RLS policy
-- and RPC) treat a removed profile as belonging to no organisation, which
-- locks them out immediately while their name stays attached to history.

alter table public.profiles add column removed_at timestamptz;

create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid() and removed_at is null;
$$;

create or replace function public."current_role"() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and removed_at is null;
$$;

create function public.remove_org_member(p_member_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can remove a member';
  end if;
  if p_member_id = auth.uid() then
    raise exception 'You cannot remove yourself';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_member_id and org_id = v_org_id and removed_at is null
  ) then
    raise exception 'Member not found in your organisation';
  end if;

  update public.profiles set removed_at = now() where id = p_member_id;
  delete from public.site_members where user_id = p_member_id;
  delete from public.site_supervisors where user_id = p_member_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'profile', p_member_id, 'member_removed', auth.uid());
end;
$$;

grant execute on function public.remove_org_member(uuid) to authenticated;
