-- A job filed from a thing's own page is about that thing.
--
-- Three doors on the thing page file a job — *Report a problem with it*,
-- *Schedule service*, and now the cart beside a consumable — and all three pass
-- `p_thing_id` to `create_snag`. That writes `snags.thing_id`, the retired
-- single link. Since `20260920100000` nothing *reads* that column for the link:
-- `snags_with_details.linked_things` and both counts on `things_with_details`
-- read `home.snag_things`. So every job filed from a thing's page arrived with
-- **Linked assets** empty and without adding to the thing's "on the list"
-- count — about the heat pump in the one column nobody looks at, and about
-- nothing everywhere a person does.
--
-- **On insert only, and that is the whole of what keeps this from being a
-- second writer.** `20260920100000` names the failure precisely: a `thing_id`
-- kept in step with the first row of a set is two writers of one fact. This
-- keeps nothing in step. It says, once, at the moment a job is created about a
-- thing, that the job is about it — the same statement the backfill in that
-- migration made for every row that existed then. After that, `set_snag_things`
-- is the only way the set changes, and `update_snag(p_thing_id)` does not reach
-- the join table at all, exactly as before.
--
-- A trigger rather than a line in `create_snag`, because restating that
-- function to add one insert is a hundred lines of diff in which the one line
-- that matters is invisible, and the next person to replace `create_snag` would
-- have to know to carry it.

create or replace function home.link_snag_thing_on_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into home.snag_things (snag_id, thing_id, created_by)
  values (new.id, new.thing_id, new.reporter_id)
  on conflict do nothing;
  return new;
end;
$$;

-- Called by the trigger, never by a person. Nothing is granted.
revoke all on function home.link_snag_thing_on_create() from public;

drop trigger if exists snags_link_thing_on_create on home.snags;
create trigger snags_link_thing_on_create
  after insert on home.snags
  for each row
  when (new.thing_id is not null)
  execute function home.link_snag_thing_on_create();

-- **No backfill, deliberately.** The jobs filed this way since the join table
-- arrived could be carried over — but a job whose link somebody has since
-- *removed* in the picker looks exactly the same from here (a `thing_id`, no
-- row), and re-adding that link would be this migration contradicting a person
-- who said the job is not about the heat pump. The handful affected are two taps
-- from right on their own page; an answer overwritten is not recoverable.
