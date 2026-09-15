-- An invitation that waits, and an account that can end itself.
--
-- `add_member_by_email` could only ever add somebody who had already signed up
-- AND already saved a name. Every account on this project except one is in
-- neither state, so the real answer to "add my partner to the house" was
-- *That account has not finished signing up yet* — a true sentence that names
-- neither what went wrong nor what to do about it, shown to the person who
-- cannot fix it. The order was load-bearing and nothing said so: they had to
-- finish signing up before you could type their address.
--
-- So the row waits instead. You invite an address whenever you like; if there
-- is no account behind it yet, the invitation sits until there is.
--
-- **This is the pending state CLAUDE.md ruled out, and the rule it was
-- protecting is still kept.** That rule came from the retired product's
-- `invite_user`: it wrote the invite row, returned, and the app said "Invite
-- sent" — and no invite was ever emailed for the entire life of the feature.
-- The failure was the *claim*, not the row. Nothing here sends anything and
-- nothing here says it did: the screen calls a waiting invitation waiting, and
-- telling the other person is still a thing you do out loud. What the row buys
-- is that they no longer have to do their half first, in an order nobody
-- published.
--
-- The invitee answers it. `accept_invitation` and `decline_invitation` are
-- theirs alone — matched on the address the invitation names, so an invitation
-- is only ever actionable by the person it is addressed to.

-- ---------------------------------------------------------------- the row

create table home.invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references home.households(id) on delete cascade,
  -- Stored lowered and trimmed. `auth.users.email` is matched the same way
  -- everywhere, because an invitation that misses on capitalisation is an
  -- invitation that never arrives and never says why.
  email text not null check (length(btrim(email)) between 3 and 320),
  -- Empty means every property in the household, which is the one-place answer.
  -- A uuid[] rather than a join table: an invitation is a short-lived row with
  -- no life of its own, and a property deleted before the invitation is claimed
  -- is filtered out at claim time rather than cascaded here.
  property_ids uuid[] not null default '{}',
  invited_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  unique (household_id, email)
);

create index on home.invitations (email);

alter table home.invitations enable row level security;

-- Members see who is waiting on their own house. The invitee does NOT read the
-- table — they go through `my_invitations` below, which matches on their
-- address, so nobody can enumerate invitations by household id.
create policy "members read their invitations"
  on home.invitations for select using (home.is_member(household_id));

grant select on home.invitations to authenticated;

-- ---------------------------------------------------------------- helpers

-- The caller's own address, lowered. SECURITY DEFINER because `auth.users` is
-- not readable by `authenticated`, and read from the table rather than from the
-- JWT: a claim is whatever was minted at sign-in, and this has to agree with
-- what `invite_to_household` wrote at a completely different moment.
create function home.my_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(u.email)) from auth.users u where u.id = auth.uid();
$$;

revoke execute on function home.my_email() from public, anon, authenticated;

-- ---------------------------------------------------------------- inviting

-- Supersedes `add_member_by_email`, which is dropped at the foot of this file.
-- Keeping both would leave a granted RPC that joins somebody to a household
-- without their ever being asked, which is the half this replaces.
create function home.invite_to_household(
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

  -- Already here is not an error worth a dialog, but it is worth saying: the
  -- alternative is an invitation nobody can accept, sitting under Who's here
  -- next to the person it names.
  select u.id into v_user_id from auth.users u where lower(btrim(u.email)) = v_email;
  if v_user_id is not null and home.is_member_profile(p_household_id, v_user_id) then
    raise exception 'They are already in this household';
  end if;

  -- Re-inviting rewrites the places rather than failing. Someone correcting
  -- which place a waiting invitation lands on should not have to cancel first.
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

create function home.cancel_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  select household_id into v_household_id
  from home.invitations where id = p_invitation_id;

  if v_household_id is null then
    return; -- already gone, or claimed. Cancelling twice is not an error.
  end if;

  perform home.require_member(v_household_id);

  delete from home.invitations where id = p_invitation_id;
end;
$$;

-- ---------------------------------------------------------------- answering

-- What is waiting for *me*, whoever I am. Matched on address, never on id, so
-- this is the only way an invitee reaches an invitation and they can only ever
-- reach their own.
create function home.my_invitations()
returns table (
  id uuid,
  household_id uuid,
  household_name text,
  invited_by_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.household_id, h.name, p.display_name, i.created_at
  from home.invitations i
  join home.households h on h.id = i.household_id
  join home.profiles p   on p.id = i.invited_by
  where i.email = home.my_email()
  order by i.created_at;
$$;

grant execute on function home.my_invitations() to authenticated;

create function home.accept_invitation(p_invitation_id uuid)
returns home.household_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation home.invitations;
  v_member home.household_members;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- A profile is still required, but it is now required of the person doing the
  -- accepting rather than demanded of them by somebody else's error dialog.
  if not exists (select 1 from home.profiles pr where pr.id = auth.uid()) then
    raise exception 'Save your name first';
  end if;

  select * into v_invitation
  from home.invitations
  where id = p_invitation_id and email = home.my_email();

  if v_invitation.id is null then
    raise exception 'That invitation is no longer open';
  end if;

  insert into home.household_members (household_id, profile_id, role)
  values (v_invitation.household_id, auth.uid(), 'owner')
  on conflict (household_id, profile_id) do update set role = excluded.role
  returning * into v_member;

  -- An empty list means every property. A property deleted between the
  -- invitation and the acceptance simply isn't there to link.
  insert into home.property_members (property_id, profile_id)
  select p.id, auth.uid()
  from home.properties p
  where p.household_id = v_invitation.household_id
    and (
      v_invitation.property_ids = '{}'
      or p.id = any(v_invitation.property_ids)
    )
  on conflict do nothing;

  delete from home.invitations where id = v_invitation.id;

  return v_member;
end;
$$;

create function home.decline_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from home.invitations
  where id = p_invitation_id and email = home.my_email();
end;
$$;

-- ---------------------------------------------------------------- an ending

-- Every storage key this account would strand by leaving entirely: the files of
-- each household where it is the only member, which are the households
-- `delete_my_account` is about to delete.
--
-- Read BEFORE the account goes, for the reason `20260914161000` gives in full:
-- the storage delete policy asks `home.is_member(<household id>)`, so an
-- account that has deleted itself cannot clear up after itself.
create function home.my_orphan_file_paths()
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
    select m.household_id
    from home.household_members m
    where m.profile_id = auth.uid()
      and (
        select count(*) from home.household_members o
        where o.household_id = m.household_id
      ) = 1
  loop
    v_paths := v_paths || home.household_file_paths(v_household);
  end loop;

  return v_paths;
end;
$$;

grant execute on function home.my_orphan_file_paths() to authenticated;

-- Ends the account itself, which nothing could do before. It is the answer to
-- the nine accounts on this project that signed up, never saved a name, and had
-- no way forward or back.
--
-- Deliberately not a refusal anywhere. Somebody deleting their account is not
-- asking whether it is tidy; a household they are alone in goes with them, and
-- a household they share does not.
create function home.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
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

  -- What is left is the households nobody else is in. They go whole.
  delete from home.households h
  where exists (
    select 1 from home.household_members m
    where m.household_id = h.id and m.profile_id = v_uid
  );

  -- Invitations addressed to this account die with it; ones it sent do not,
  -- because the household they point at may well outlive the sender.
  delete from home.invitations where email = home.my_email();

  delete from home.profiles where id = v_uid;
  -- The profile cascades from auth.users anyway; deleting it first means the
  -- row is gone even if the auth delete is ever restricted.
  delete from auth.users where id = v_uid;
end;
$$;

grant execute on function home.delete_my_account() to authenticated;

-- ---------------------------------------------------------------- grants

grant execute on function home.invite_to_household(uuid, text, uuid[]) to authenticated;
grant execute on function home.cancel_invitation(uuid)                 to authenticated;
grant execute on function home.accept_invitation(uuid)                 to authenticated;
grant execute on function home.decline_invitation(uuid)                to authenticated;

-- Superseded. It joined somebody to a household without asking them, which is
-- the half `accept_invitation` now owns, and it refused every account that had
-- not already finished signing up — the dead end this migration exists to end.
drop function home.add_member_by_email(uuid, text, uuid[]);
