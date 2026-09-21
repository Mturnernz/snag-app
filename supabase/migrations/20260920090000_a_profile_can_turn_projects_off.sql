-- Projects, turned off by the person rather than by the household.
--
-- A renovation is a third noun and not every household has one. Somebody with
-- no project in progress pays a tab, a set of reads and a row of controls for a
-- feature that answers nothing about their house — so they can put it away.
--
-- **It is per profile, deliberately, and this is the one setting in the app
-- that is.** Everything else the schema remembers is per household or per
-- property, because there is one house and two people disagreeing about whether
-- it has a dryer is not a state worth modelling. This is not that: it is a
-- statement about what one person wants on their screen, and one member hiding
-- the Projects tab must not take it off the other's phone. The column therefore
-- sits on `home.profiles` and nowhere near `households`.
--
-- Stored server-side rather than on the device for the same reason
-- `last_reported_property` is: a preference kept in a browser is a preference
-- that resets on the next phone, and the person would have to find this screen
-- again to say something they have already said once.
--
-- **Default true, so nothing changes for anybody who never opens the setting.**
-- A migration that quietly hid a tab would read as the feature having been
-- withdrawn.
alter table home.profiles
  add column if not exists projects_enabled boolean not null default true;

-- There are deliberately no insert/update/delete policies on any `home` table,
-- so this is a function like every other write. It is its own RPC rather than a
-- field on `upsert_profile` because that one is the sign-up path — it runs
-- before a household exists and is called with a display name and nothing else,
-- and routing a preference through it would mean every caller of it having an
-- opinion about the Projects tab.
--
-- It returns the row rather than void: the client re-reads its profile from
-- what comes back, so the toggle can never end up showing a state the database
-- does not hold.
create or replace function home.set_projects_enabled(p_enabled boolean)
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

  if p_enabled is null then
    raise exception 'Say whether projects are on or off';
  end if;

  update home.profiles
     set projects_enabled = p_enabled
   where id = auth.uid()
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Finish setting up your profile first';
  end if;

  return v_profile;
end;
$$;

-- By name, never by sweep. See 20260803120200 in the retired product for what a
-- grant sweep hands out when nobody is reading both of its lists.
grant execute on function home.set_projects_enabled(boolean) to authenticated;

notify pgrst, 'reload schema';
