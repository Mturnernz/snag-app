-- A profile outlives its login.
--
-- `delete_my_account` landed in the migration before this one and could not
-- run. A test caught it on the first realistic shape — somebody alone in one
-- house, sharing another:
--
--   23503: update or delete on table "profiles" violates foreign key
--   constraint "snags_reporter_id_fkey" on table "snags"
--
-- Six columns point at `home.profiles` to record who did something —
-- `snags.reporter_id`, `snags.updated_by`, `comments.author_id`,
-- `things.created_by`, `things.updated_by`, `absent_things.created_by` — and
-- three of them are NOT NULL. They are NO ACTION on purpose: `remove_member`
-- already leaves the profile row alone so that a snag filed by somebody who has
-- since left still says who filed it. That was the right call and this does not
-- undo it.
--
-- The mistake was thinking an account and a person are the same row.
-- `profiles.id` cascaded from `auth.users`, so deleting the login tried to take
-- the person with it, and the person is still referenced by every household
-- they leave behind. **So the cascade goes.** A login is a way in; a profile is
-- a name attached to work that happened. Deleting the first must not be able to
-- delete the second, and after this it cannot: `delete_my_account` removes the
-- `auth.users` row and leaves a tombstone.
--
-- What a tombstone is: the row, with `deleted_at` set and the display name
-- replaced. The personal thing about a profile is the name, and the name is
-- what goes. `snags_with_details.reporter_name` then reads *Someone who left*,
-- which is true, rather than the screen breaking or the household losing work
-- that was never the leaver's to take.

-- ---------------------------------------------------------------- the row

-- The only thing that made a profile die with its login.
alter table home.profiles drop constraint profiles_id_fkey;

comment on table home.profiles is
  'A person, not a login. Ids come from auth.users via upsert_profile, but the '
  'row deliberately outlives that account: six columns across snags, comments, '
  'things and absent_things record who did something and three are NOT NULL, so '
  'a deleted account has to leave its name behind or take a household''s history '
  'with it. A row with deleted_at set is a tombstone — never a member, never '
  'invitable, only ever a name on something already filed.';

alter table home.profiles add column deleted_at timestamptz;

-- ---------------------------------------------------------------- the ending

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

  -- Shared households first: remove_member does the careful part — nulling the
  -- assignments that would otherwise point at nobody, and handing on any
  -- property this account was alone on.
  for v_household in
    select m.household_id
    from home.household_members m
    where m.profile_id = v_uid
      and (
        select count(*) from home.household_members o
        where o.household_id = m.household_id
      ) > 1
  loop
    perform home.remove_member(v_household, v_uid);
  end loop;

  -- What is left is the households nobody else is in. They go whole, and their
  -- snags and things go with them, so nothing in those points at this profile.
  delete from home.households h
  where exists (
    select 1 from home.household_members m
    where m.household_id = h.id and m.profile_id = v_uid
  );

  -- Invitations addressed to this account die with it; ones it sent do not,
  -- because the household they point at may well outlive the sender. Read the
  -- address before the auth row goes, since my_email() reads from it.
  delete from home.invitations where email = v_email;

  -- The tombstone. Not a delete: see the header — three NOT NULL columns in
  -- households that survive still name this person, and they are right to.
  update home.profiles
  set display_name = 'Someone who left',
      deleted_at   = coalesce(deleted_at, now())
  where id = v_uid;

  delete from auth.users where id = v_uid;
end;
$$;

grant execute on function home.delete_my_account() to authenticated;

-- ---------------------------------------------------------------- guards

-- A tombstone is not a person you can invite back. The account is gone, so a
-- new sign-up on the same address gets a new auth id and a new profile — this
-- only stops the old row being mistaken for a live one.
create or replace function home.invite_to_household(
  p_household_id uuid,
  p_email text,
  p_property_ids uuid[] default null
)
returns home.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user_id uuid;
  v_invitation home.invitations;
begin
  perform home.require_member(p_household_id);

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address';
  end if;

  if v_email = home.my_email() then
    raise exception 'That is your own address';
  end if;

  select u.id into v_user_id from auth.users u where lower(btrim(u.email)) = v_email;
  if v_user_id is not null and home.is_member_profile(p_household_id, v_user_id) then
    raise exception 'They are already in this household';
  end if;

  insert into home.invitations (household_id, email, property_ids, invited_by)
  values (p_household_id, v_email, coalesce(p_property_ids, '{}'), auth.uid())
  on conflict (household_id, email) do update
    set property_ids = excluded.property_ids,
        invited_by   = excluded.invited_by,
        created_at   = now()
  returning * into v_invitation;

  return v_invitation;
end;
$$;

-- Signing up again on the same address is a new account and a new profile, so
-- this can only ever be reached by an id that is live. It clears deleted_at
-- rather than trusting that, because a tombstone that came back to life while
-- still flagged would read as gone everywhere it is named.
create or replace function home.upsert_profile(p_display_name text)
returns home.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile home.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  insert into home.profiles (id, display_name)
  values (auth.uid(), btrim(p_display_name))
  on conflict (id) do update
    set display_name = excluded.display_name,
        deleted_at   = null
  returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function home.upsert_profile(text) to authenticated;
