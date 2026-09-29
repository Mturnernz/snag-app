-- First-run setup is a list of steps, and this remembers which ones a person
-- has already been shown.
--
-- The setup flow (apps/mobile/src/setup/steps.ts) is a registry: one entry per
-- question a new person is asked, each with a stable id. When a later change
-- adds a question, somebody who set up months ago should be asked *that one*
-- and nothing else — the way a phone, after an update, shows the two new
-- screens and not the whole of first-run again. That needs one fact the data
-- itself cannot answer: whether this person has already been asked.
--
-- **Only that fact is stored.** Whether the house has a name, whether the rooms
-- are right, whether anybody else is in it — those are read from the tables
-- that hold them, never recorded here as "done". A step skipped with *Set up
-- later* is recorded as seen, because skipping is an answer and asking again on
-- every open would nag.
--
-- **Per person, like `projects_enabled`**, because "has this person been
-- asked" is about a person: the second member of a household is asked about
-- the rooms even though the first one already was.
alter table home.profiles
  add column if not exists setup_seen text[] not null default '{}';

-- Everybody already using the app has, in effect, been through setup. Without
-- this every existing account would be walked through first-run on the next
-- open, which is the one thing a migration must not do to people. Only
-- profiles already in a household: somebody who saved a name and is still
-- waiting to be added has not seen the rooms or the invite step yet.
--
-- This list is the baseline, and `steps.test.ts` asserts it equals the steps
-- whose `since` is 1. A step added later must NOT be added here — it is the
-- whole point that existing people see it.
update home.profiles p
   set setup_seen = array['name', 'household', 'rooms', 'invite']
 where exists (select 1 from home.household_members m where m.profile_id = p.id);

-- There are deliberately no insert/update/delete policies on any `home` table.
-- Appends rather than replaces, and keeps each id once, so two phones marking
-- the same step cannot undo each other. Unknown ids are stored as given: the
-- client's registry is the vocabulary, and refusing an id here would mean a
-- migration for every new step.
create or replace function home.mark_setup_seen(p_steps text[])
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

  update home.profiles
     set setup_seen = (
       select coalesce(array_agg(distinct s order by s), '{}')
         from unnest(setup_seen || coalesce(p_steps, '{}')) as s
        where s is not null and btrim(s) <> ''
     )
   where id = auth.uid()
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Finish setting up your profile first';
  end if;

  return v_profile;
end;
$$;

-- By name, never by sweep — and PUBLIC's default EXECUTE taken back first, or
-- the anon key could call it one schema grant away (20260929014049).
revoke execute on function home.mark_setup_seen(text[]) from public, anon;
grant execute on function home.mark_setup_seen(text[]) to authenticated;

notify pgrst, 'reload schema';
