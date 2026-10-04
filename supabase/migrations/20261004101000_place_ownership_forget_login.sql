-- Place ownership, part 11 of 11. Why: 20261004100000_place_ownership_roles.sql.
-- Split into small files so each can be applied and approved on its own.

-- The same for a login deleted from the dashboard.
create or replace function home.forget_login(p_uid uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  for v_household in
    select m.household_id
    from home.household_members m
    where m.profile_id = p_uid
      and exists (
        select 1 from home.household_members o
        where o.household_id = m.household_id and o.profile_id <> p_uid
      )
  loop
    perform home.leave_household_as(v_household, p_uid, null);
  end loop;

  delete from home.households h
  where exists (
    select 1 from home.household_members m
    where m.household_id = h.id and m.profile_id = p_uid and m.role = 'owner'
  )
  and not exists (
    select 1 from home.household_members o
    where o.household_id = h.id and o.profile_id <> p_uid
  );

  if v_email is not null then
    delete from home.invitations where lower(btrim(email)) = v_email;
  end if;

  update home.profiles
  set display_name = 'Someone who left',
      deleted_at   = coalesce(deleted_at, now())
  where id = p_uid
    and (display_name is distinct from 'Someone who left' or deleted_at is null);

  update public.invites i
  set email = ''
  from public.profiles p
  where p.id = p_uid
    and p.email <> ''
    and lower(btrim(i.email)) = lower(btrim(p.email));

  if v_email is not null then
    update public.invites set email = '' where lower(btrim(email)) = v_email;
  end if;

  update public.profiles
  set name  = 'Someone who left',
      email = ''
  where id = p_uid
    and (name <> 'Someone who left' or email <> '');
end;
$$;

revoke execute on function home.forget_login(uuid, text) from public, anon, authenticated;
