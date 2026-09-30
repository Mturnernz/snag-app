-- A login deleted anywhere leaves the same way *Delete my account* leaves.
--
-- `home.delete_my_account` takes somebody out of every household they share,
-- deletes the ones only they were in, drops invitations addressed to them, and
-- turns their name into *Someone who left* in both schemas — then deletes the
-- `auth.users` row. That is what the privacy statement promises.
--
-- **Deleting a user from the Supabase dashboard skipped all of it.** On
-- 29 September 2026 six logins were deleted there at once. Because
-- `home.profiles` no longer cascades from `auth.users` (20260915012629, so a
-- snag can still say who filed it), three profiles were left behind with their
-- names, still members of three households nobody could now open; and the
-- archive kept the names and addresses of every one of them.
--
-- So the leaving is done by a trigger on `auth.users`, after the row goes,
-- whoever deleted it. `delete_my_account` still does its part first — it has to,
-- because a household's files are cleared by the client *before* the membership
-- that authorises clearing them is gone — and the trigger then finds nothing
-- left to do. A dashboard delete gets the rest.
--
-- **One thing a trigger cannot do: the files.** `storage.protect_delete()`
-- refuses a direct delete of `storage.objects`, rightly, so the photos and
-- documents of a household deleted this way stay in the bucket under its id.
-- The orphan query in SNAG_INFRA_NOTES.md (*Finding files nothing points at*)
-- finds them; clear them from Storage → home-photos in the dashboard. Deleting
-- through the app never leaves any.
--
-- It runs as the owner, with an empty search path, and never asks who is
-- calling: a dashboard delete has no caller. Nothing may call it directly.

create or replace function home.forget_login(p_uid uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_keeper uuid;
  v_orphan uuid;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  -- Households shared with somebody else: what remove_member does, without its
  -- check on the caller. Their assignments go, because an assignee nobody can
  -- reach is a job that silently never gets done; a place only they were on is
  -- handed to whoever has been in the household longest.
  for v_household in
    select m.household_id
    from home.household_members m
    where m.profile_id = p_uid
      and exists (
        select 1 from home.household_members o
        where o.household_id = m.household_id and o.profile_id <> p_uid
      )
  loop
    update home.snags set assignee_id = null, updated_at = now()
    where household_id = v_household and assignee_id = p_uid;

    delete from home.property_members pm
    using home.properties p
    where pm.property_id = p.id
      and p.household_id = v_household
      and pm.profile_id = p_uid;

    select m.profile_id into v_keeper
    from home.household_members m
    where m.household_id = v_household and m.profile_id <> p_uid
    order by m.created_at, m.profile_id
    limit 1;

    for v_orphan in
      select p.id from home.properties p
      where p.household_id = v_household
        and not exists (select 1 from home.property_members pm where pm.property_id = p.id)
    loop
      insert into home.property_members (property_id, profile_id)
      values (v_orphan, v_keeper)
      on conflict do nothing;
    end loop;

    delete from home.household_members
    where household_id = v_household and profile_id = p_uid;
  end loop;

  -- What is left is the households nobody else is in. They go whole, as they
  -- do through the app; their files stay in the bucket (see the header).
  delete from home.households h
  where exists (
    select 1 from home.household_members m
    where m.household_id = h.id and m.profile_id = p_uid
  );

  if v_email is not null then
    delete from home.invitations where lower(btrim(email)) = v_email;
  end if;

  -- The tombstone, as delete_my_account writes it.
  update home.profiles
  set display_name = 'Someone who left',
      deleted_at   = coalesce(deleted_at, now())
  where id = p_uid
    and (display_name is distinct from 'Someone who left' or deleted_at is null);

  -- And the archive's copy of the same person: invites first, while the
  -- profile still holds the address they were sent to.
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

create or replace function home.forget_deleted_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.forget_login(old.id, old.email);
  return old;
end;
$$;

revoke execute on function home.forget_deleted_login() from public, anon, authenticated;

drop trigger if exists forget_deleted_login on auth.users;
create trigger forget_deleted_login
  after delete on auth.users
  for each row execute function home.forget_deleted_login();

-- ---------------------------------------------------------------- backfill

-- The logins deleted from the dashboard on 29 September 2026: every profile,
-- in either schema, whose login no longer exists and which has not already
-- been tombstoned.
do $$
declare
  v_uid uuid;
begin
  for v_uid in
    select p.id from home.profiles p
    where not exists (select 1 from auth.users u where u.id = p.id)
      and (p.deleted_at is null or p.display_name <> 'Someone who left'
           or exists (select 1 from home.household_members m where m.profile_id = p.id))
    union
    select p.id from public.profiles p
    where not exists (select 1 from auth.users u where u.id = p.id)
      and (p.name <> 'Someone who left' or p.email <> '')
  loop
    perform home.forget_login(v_uid, null);
  end loop;
end;
$$;
