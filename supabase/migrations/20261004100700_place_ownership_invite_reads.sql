-- Place ownership, part 8 of 11. Why: 20261004100000_place_ownership_roles.sql.
-- Split into small files so each can be applied and approved on its own.

-- Stops every live link to a place the caller owns.
create or replace function home.revoke_invite_link(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_member(p_household_id);

  delete from home.invitations i
  where i.household_id = p_household_id
    and i.token is not null
    and not exists (
      select 1 from unnest(i.property_ids) x
      where not home.is_property_owner_profile(x, auth.uid())
    );
end;
$$;

revoke execute on function home.revoke_invite_link(uuid) from public, anon;
grant execute on function home.revoke_invite_link(uuid) to authenticated;

-- What a scanner is being asked to join, by place. Dropped rather than
-- replaced, because the row it returns gains a column.
drop function home.invitation_by_token(uuid);

create function home.invitation_by_token(p_token uuid)
returns table (
  id uuid,
  household_id uuid,
  household_name text,
  invited_by_name text,
  expires_at timestamptz,
  already_a_member boolean,
  property_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.household_id, h.name, p.display_name, i.expires_at,
    not exists (
      select 1 from unnest(i.property_ids) x
      where not exists (
        select 1 from home.property_members m
        where m.property_id = x and m.profile_id = auth.uid()
      )
    ),
    array(
      select pr.name from home.properties pr
      where pr.id = any(i.property_ids)
      order by pr.created_at, pr.id
    )
  from home.invitations i
  join home.households h on h.id = i.household_id
  join home.profiles p   on p.id = i.invited_by
  where i.token = p_token
    and i.expires_at > now();
$$;

revoke execute on function home.invitation_by_token(uuid) from public, anon;
grant execute on function home.invitation_by_token(uuid) to authenticated;

drop function home.my_invitations();

create function home.my_invitations()
returns table (
  id uuid,
  household_id uuid,
  household_name text,
  invited_by_name text,
  created_at timestamptz,
  property_names text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.household_id, h.name, p.display_name, i.created_at,
    array(
      select pr.name from home.properties pr
      where pr.id = any(i.property_ids)
      order by pr.created_at, pr.id
    )
  from home.invitations i
  join home.households h on h.id = i.household_id
  join home.profiles p   on p.id = i.invited_by
  where i.email = home.my_email()
    and i.token is null
  order by i.created_at;
$$;

revoke execute on function home.my_invitations() from public, anon;
grant execute on function home.my_invitations() to authenticated;
