-- An anonymous session is not an account, and cannot become a member.
--
-- Anonymous sign-ins are still switched on for this project — a leftover from
-- the retired product's QR reporting (`?report=<token>`), which has no client
-- any more. SNAG_INFRA_NOTES.md judged that harmless on the grounds that an
-- anonymous caller "is stopped at the schema", because `usage on schema home`
-- went to `authenticated` only. **That premise is wrong.** Supabase runs an
-- anonymous user as the `authenticated` role — the only difference is an
-- `is_anonymous` claim in the JWT — so every grant this schema makes to
-- `authenticated` is theirs too.
--
-- The read policies still hold, because every one asks for a membership row an
-- anonymous user has never had. The gap is the three doors that *make* a
-- membership, none of which asks who is knocking: `upsert_profile`,
-- `create_household` and `accept_invitation_by_token`. Anybody holding the
-- public anon key — it is in the web bundle — could call `signInAnonymously()`,
-- give themselves a name, create a household, and use the whole app with no
-- address, no password and no confirmation email: including `read-label`, which
-- spends the operator's Gemini key and whose fifty reads a day are per
-- household, of which there can be as many as anyone likes. Nothing says it has
-- happened: the project's three anonymous users date from 27 July and none of
-- them has a profile.
--
-- Switching anonymous sign-ins off (Auth → Providers) is the other half and is
-- a dashboard change; see SNAG_INFRA_NOTES.md. This half holds whichever way
-- that switch is set, and whatever door is added next.
--
-- **Triggers on the two tables, not a line in each function**, for the reason
-- `20260923100000` gives: restating three functions to add one check to each is
-- a diff in which the lines that matter are easy to miss, and the next person
-- to replace one would have to know to carry it. Every way into a household
-- ends in an insert into one of these two tables, and a profile is required
-- before a membership can exist, so guarding both covers today's three doors
-- and any future one.
--
-- Read from `auth.users.is_anonymous` rather than the JWT claim, so the check
-- is about the person being added rather than whoever's token is making the
-- call.

create or replace function home.refuse_anonymous_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Which column names the person: `id` on profiles, `profile_id` on
  -- household_members. Passed in by the trigger so one function serves both.
  v_person uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if exists (
    select 1 from auth.users u
    where u.id = v_person and u.is_anonymous
  ) then
    raise exception 'Create an account to use Snag'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Called by the triggers, never by a person. Named rather than swept: the
-- platform's default privileges hand new functions to anon and authenticated,
-- so revoking from public alone would leave both.
revoke all on function home.refuse_anonymous_member() from public, anon, authenticated;

drop trigger if exists profiles_refuse_anonymous on home.profiles;
create trigger profiles_refuse_anonymous
  before insert on home.profiles
  for each row
  execute function home.refuse_anonymous_member('id');

drop trigger if exists household_members_refuse_anonymous on home.household_members;
create trigger household_members_refuse_anonymous
  before insert on home.household_members
  for each row
  execute function home.refuse_anonymous_member('profile_id');

-- Before insert, which is also before `upsert_profile`'s `on conflict`: the
-- check runs whether the row would have been new or updated. Nothing is
-- backfilled because there is nothing to backfill — no anonymous user has a
-- profile or a membership (checked 25 September 2026).
