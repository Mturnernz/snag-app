-- A code you can hold up.
--
-- Inviting by address assumes you know the address and are willing to type it.
-- Standing in the same kitchen, both of those are friction: the shortest path
-- from "you should have this" to "they have this" is holding up a phone.
--
-- So an invitation can be addressed two ways, and it is deliberately **one
-- table and one accept path**, not a second mechanism beside the first. The
-- Schedule tab's rule applies here as hard as it does to dates: the moment
-- there are two ways to join a household, neither is trustworthy. A row is
-- addressed by `email` OR by `token`, never both and never neither, and
-- everything downstream — the Waiting rows, cancelling, what a household sees,
-- what happens when somebody says yes — is the same code either way.
--
-- **Nothing is scanned by this app.** The QR encodes an ordinary
-- `https://app.snaghq.co.nz/join/<token>` URL, and the phone's own camera opens
-- it. That is not a shortcut, it is the point: the person scanning has not
-- installed Snag yet, which is precisely why they are being sent a link. It
-- also means no camera permission, no scanner screen, and no getUserMedia to
-- get past the deployed CSP that nothing local enforces. `expo-camera` stays
-- unused, as it has been since the pivot.
--
-- The link is short-lived and revocable, and that is the whole of its security
-- model. A screenshot is a way into the house until it expires. Twenty-four
-- hours is the window, one tap revokes it, and every arrival still has to press
-- Join — which is what keeps this from becoming the retired product's join
-- codes, printed on walls with no way to tell who held one.

-- ---------------------------------------------------------------- the row

alter table home.invitations alter column email drop not null;

alter table home.invitations
  add column token uuid unique,
  add column expires_at timestamptz;

-- Exactly one way in per row. A row with both would have two accept paths and a
-- row with neither could never be answered by anybody.
alter table home.invitations
  add constraint invitations_addressed_one_way check ((email is null) <> (token is null));

-- One live link per household. `unique (household_id, email)` does not cover
-- these, because Postgres treats NULLs as distinct — so without this, every tap
-- of Show a QR code would leave the previous code working.
create unique index invitations_one_link_per_household
  on home.invitations (household_id) where token is not null;

comment on column home.invitations.token is
  'Set for a link/QR invitation, null for one addressed to an email. The URL is '
  'https://app.snaghq.co.nz/join/<token> and is opened by the scanner''s own '
  'camera — nothing in this app scans anything.';

-- ---------------------------------------------------------------- the link

-- Mints the household's one live code, replacing any previous one. Returns the
-- whole row so the client has the token to build the URL and the expiry to say
-- out loud; there is no separate read, because a code you cannot see is not a
-- code you can hold up.
create function home.create_invite_link(
  p_household_id uuid,
  p_property_ids uuid[] default null,
  p_hours integer default 24
)
returns home.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation home.invitations;
begin
  perform home.require_member(p_household_id);

  if p_hours is null or p_hours < 1 or p_hours > 168 then
    raise exception 'A code can last between an hour and a week';
  end if;

  -- Replaced, not added to: the partial unique index above says one live link,
  -- and the reason is that the old code silently continuing to work is exactly
  -- what somebody pressing this button is trying to stop.
  delete from home.invitations
  where household_id = p_household_id and token is not null;

  insert into home.invitations (household_id, email, token, property_ids, invited_by, expires_at)
  values (
    p_household_id, null, gen_random_uuid(),
    coalesce(p_property_ids, '{}'), auth.uid(),
    now() + make_interval(hours => p_hours)
  )
  returning * into v_invitation;

  return v_invitation;
end;
$$;

create function home.revoke_invite_link(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_member(p_household_id);

  delete from home.invitations
  where household_id = p_household_id and token is not null;
end;
$$;

-- What a scanner is being asked to join, named before they answer. Deliberately
-- `authenticated` only, like everything else in this schema — `anon` has never
-- had USAGE on `home` and this is not the thing to open it for. Someone
-- arriving signed-out signs in first and the token rides through the round trip
-- in the URL; see resetWebPathIfStale.
create function home.invitation_by_token(p_token uuid)
returns table (
  id uuid,
  household_id uuid,
  household_name text,
  invited_by_name text,
  expires_at timestamptz,
  already_a_member boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.household_id, h.name, p.display_name, i.expires_at,
    exists (
      select 1 from home.household_members m
      where m.household_id = i.household_id and m.profile_id = auth.uid()
    )
  from home.invitations i
  join home.households h on h.id = i.household_id
  join home.profiles p   on p.id = i.invited_by
  where i.token = p_token
    and i.expires_at > now();
$$;

grant execute on function home.invitation_by_token(uuid) to authenticated;

-- The same join as accept_invitation, reached by token instead of by address.
--
-- It does NOT consume the row: the code is good for its whole window so two
-- people can be added in one sitting. Idempotent for that reason too — scanning
-- twice is a thing people do, and the second scan must not be an error.
create function home.accept_invitation_by_token(p_token uuid)
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

  if not exists (select 1 from home.profiles pr where pr.id = auth.uid()) then
    raise exception 'Save your name first';
  end if;

  select * into v_invitation
  from home.invitations
  where token = p_token and expires_at > now();

  if v_invitation.id is null then
    raise exception 'That code has expired — ask them for a new one';
  end if;

  insert into home.household_members (household_id, profile_id, role)
  values (v_invitation.household_id, auth.uid(), 'owner')
  on conflict (household_id, profile_id) do update set role = excluded.role
  returning * into v_member;

  insert into home.property_members (property_id, profile_id)
  select p.id, auth.uid()
  from home.properties p
  where p.household_id = v_invitation.household_id
    and (
      v_invitation.property_ids = '{}'
      or p.id = any(v_invitation.property_ids)
    )
  on conflict do nothing;

  -- An address invitation for this person, if one was also outstanding, has now
  -- been answered by other means. Leaving it would sit under Who's here as
  -- somebody waiting who is already standing in the room.
  delete from home.invitations
  where household_id = v_invitation.household_id
    and email = home.my_email();

  return v_member;
end;
$$;

grant execute on function home.accept_invitation_by_token(uuid) to authenticated;

-- ---------------------------------------------------------------- the rest

-- A link is addressed to nobody, so it is not something waiting for *me*.
-- Without this it would appear on every signed-in person's Setup screen as an
-- invitation they never received.
create or replace function home.my_invitations()
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
    and i.token is null
  order by i.created_at;
$$;

grant execute on function home.my_invitations() to authenticated;

grant execute on function home.create_invite_link(uuid, uuid[], integer) to authenticated;
grant execute on function home.revoke_invite_link(uuid)                  to authenticated;
