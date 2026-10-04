-- A place has an owner, and only its owner can take it away from anybody.
--
-- On 4 October 2026 one joiner removed a household. The chain was four calls,
-- every one of them allowed:
--
--   1. accept_invitation made the joiner `owner`. Every joiner was an owner,
--      because household_members.role was never read and defaulted to owner.
--   2. remove_member, twice. Any member could remove any other member: the two
--      people who had built the household were taken out of it.
--   3. delete_my_account. The joiner was now the only member, and a household
--      somebody is alone in "goes with them". Both places and every job went.
--
-- And the joiner had only ever been shown the household's name, never the
-- name of the place they were being let into.
--
-- The fix is roles, **per place**, by the owner's decision. Mike owns 32 Le Roy
-- and Martin's Bay; he lets Leonie into Martin's Bay as a member and can hand
-- her ownership of it. She then sees only Martin's Bay, and can take Mike off
-- it, or he can leave it. Nothing she does can touch 32 Le Roy.
--
-- * `property_members.role` (owner | member). A place always has an owner.
-- * `household_members.role` is read at last: the household's owner is who made
--   it. A joiner is a member of the household, never its owner.
-- * Removing somebody else needs ownership: of the place (unlink_property_member)
--   or of the household (remove_member). Anybody can leave.
-- * Nothing leaves a place without an owner: hand it over first.
-- * Deleting a place or a household needs ownership of it.
-- * Deleting your account deletes only a household you own and are alone in.
--   A place you own and share is handed on.
-- * Invitations name places, and only a place's owner can invite to it.
--
-- Moving a place into another household is not here. Once Mike leaves Martin's
-- Bay it still sits in his household's row; nobody can see that from the app,
-- and it is a later step.

-- ---------------------------------------------------------------- the column

alter table home.property_members
  add column role home.member_role not null default 'member';

-- A joiner was an owner by default. The default is what a forgotten column in
-- an insert falls back to, so it is the safe answer now.
alter table home.household_members alter column role set default 'member';

-- Whoever has been on a place longest made it: create_household and
-- create_property link the creator in the same breath as the row.
update home.property_members pm
set role = 'owner'
where (pm.property_id, pm.profile_id) in (
  select distinct on (x.property_id) x.property_id, x.profile_id
  from home.property_members x
  order by x.property_id, x.created_at, x.profile_id
);

-- The same for a household: its earliest member made it, and everybody who
-- joined after is a member.
update home.household_members hm
set role = case
  when (hm.household_id, hm.profile_id) in (
    select distinct on (x.household_id) x.household_id, x.profile_id
    from home.household_members x
    order by x.household_id, x.created_at, x.profile_id
  ) then 'owner'::home.member_role
  else 'member'::home.member_role
end;
