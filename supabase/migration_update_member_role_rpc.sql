-- The existing "manage user access" admin feature needs a way to change
-- another member's role. profiles RLS only allows self-updates (id = auth.uid()),
-- and no such RPC existed yet — this closes that gap, following the same
-- SECURITY DEFINER + explicit role-check pattern as the rest of the RPC surface.
create or replace function public.update_member_role(p_member_id uuid, p_role user_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'only officer_admin can change member roles';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_member_id and org_id = public.current_org_id()
  ) then
    raise exception 'member not found in your organisation';
  end if;

  if p_member_id = auth.uid() then
    raise exception 'cannot change your own role';
  end if;

  update public.profiles set role = p_role where id = p_member_id;
end;
$$;
