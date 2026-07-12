-- set_active_org was the one org-membership RPC that never checked
-- is_org_active — every other RPC added by the deactivation feature
-- (create_snag, join_org_via_code, get_org_by_join_code, invite_user, ...)
-- already guards this way. Without it, a member could still make a
-- deactivated org their active reporting org (e.g. via the Report screen's
-- org switcher, which — separately — is also being fixed to stop listing
-- deactivated orgs at all).

create or replace function public.set_active_org(p_org_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.org_memberships
    where user_id = auth.uid() and org_id = p_org_id and removed_at is null;
  if v_role is null then
    raise exception 'You are not a member of that organisation';
  end if;
  if not public.is_org_active(p_org_id) then
    raise exception 'This organisation is no longer active';
  end if;

  insert into public.user_active_org (user_id, org_id) values (auth.uid(), p_org_id)
    on conflict (user_id) do update set org_id = excluded.org_id, updated_at = now();

  -- removed_at on profiles is the deprecated whole-profile soft-remove;
  -- clearing it here self-heals users re-added after an old-style removal.
  update public.profiles set org_id = p_org_id, role = v_role, removed_at = null
    where id = auth.uid();
end;
$$;
