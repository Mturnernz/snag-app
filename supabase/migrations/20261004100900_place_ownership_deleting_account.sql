-- Place ownership, part 10 of 11. Why: 20261004100000_place_ownership_roles.sql.
-- Split into small files so each can be applied and approved on its own.

-- ---------------------------------------------------------------- an ending

-- What deleting this account would delete: households it owns and is alone in.
-- Named, so the confirmation can say what will actually go rather than warn in
-- general. A household it shares, or does not own, is never on this list.
create function home.my_account_deletes()
returns table (household_id uuid, household_name text, property_names text[])
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, h.name,
    array(
      select p.name from home.properties p
      where p.household_id = h.id
      order by p.created_at, p.id
    )
  from home.households h
  join home.household_members m on m.household_id = h.id
  where m.profile_id = auth.uid()
    and m.role = 'owner'
    and not exists (
      select 1 from home.household_members o
      where o.household_id = h.id and o.profile_id <> auth.uid()
    )
  order by h.created_at, h.id;
$$;

revoke execute on function home.my_account_deletes() from public, anon;
grant execute on function home.my_account_deletes() to authenticated;

create or replace function home.my_orphan_file_paths()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_paths text[] := '{}';
  v_household uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  for v_household in
    select d.household_id from home.my_account_deletes() d
  loop
    v_paths := v_paths || home.household_file_paths(v_household);
  end loop;

  return v_paths;
end;
$$;

revoke execute on function home.my_orphan_file_paths() from public, anon;
grant execute on function home.my_orphan_file_paths() to authenticated;

-- A household goes only when the leaver owns it and nobody else is in it. Every
-- other household is left the way remove_member leaves one, and a place they
-- owned and shared is handed on. A joiner deleting their account can never
-- delete what they do not own.
create or replace function home.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := home.my_email();
  v_household uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  for v_household in
    select m.household_id
    from home.household_members m
    where m.profile_id = v_uid
      and exists (
        select 1 from home.household_members o
        where o.household_id = m.household_id and o.profile_id <> v_uid
      )
  loop
    perform home.leave_household_as(v_household, v_uid, null);
  end loop;

  delete from home.households h
  where exists (
    select 1 from home.household_members m
    where m.household_id = h.id and m.profile_id = v_uid and m.role = 'owner'
  )
  and not exists (
    select 1 from home.household_members o
    where o.household_id = h.id and o.profile_id <> v_uid
  );

  delete from home.invitations where email = v_email;

  update home.profiles
  set display_name = 'Someone who left',
      deleted_at   = coalesce(deleted_at, now())
  where id = v_uid;

  update public.profiles
  set name  = 'Someone who left',
      email = ''
  where id = v_uid;

  if v_email is not null then
    update public.invites
    set email = ''
    where lower(btrim(email)) = v_email;
  end if;

  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function home.delete_my_account() from public, anon;
grant execute on function home.delete_my_account() to authenticated;
