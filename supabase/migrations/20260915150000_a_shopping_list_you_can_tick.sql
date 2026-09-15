-- A shopping list you can tick, and a flag that cannot lie about it.
--
-- The parts list has been the answer to "why has this sat for a fortnight" since
-- `20260912140000`: the trip to the shop is the thing that does not happen, and
-- collecting every job's items into one card is the one piece of the retired
-- Weekend tab worth keeping. What it could not do was record the trip. You
-- bought the seal, and the list went on saying you needed it.
--
-- **This is a side table of what has been bought, not a second list.** The items
-- themselves stay in `home.snags.parts`, written the one way they always were,
-- through `update_snag`. `home.bought_parts` answers a different question about
-- each of them — has it been got — and a row exists only when the answer is yes.
-- Absence is unbought, which is the resting state of nearly every row, so the
-- table stays the size of the shopping actually done rather than the shopping
-- ever listed.
--
-- Two consequences, and the second one is the point of the migration.
--
-- **`needs_parts` becomes derived, in the view.** It was a column maintained by
-- `update_snag` alongside the list, on the argument that a flag and the list it
-- describes must not be able to disagree. Ticking breaks that: buying the last
-- item has to clear the flag, so either `set_part_bought` maintains the column
-- too — two writers of one derived value, which is the disagreement arriving by
-- another door — or nothing does. So the column goes and the view computes it:
-- **has an item nobody has bought yet.** One expression, one reader, nothing to
-- keep in step.
--
-- **And the view's columns are written out one by one.** It was `select s.*`,
-- which is the footgun `20260914140000` already paid for on `things_with_details`:
-- a star freezes at creation, so the next column added to `home.snags` would be
-- missing from every read in the app with nothing anywhere to report it. Naming
-- them makes the next omission a visible one, in a diff.
--
-- **Ticking is not doing.** `update_snag` moves a job to 'doing' when its parts
-- change, because deciding what to buy is deciding to do the work. Buying one is
-- not adding one, so `set_part_bought` touches neither the status nor
-- `updated_at` — and it is a separate function precisely so it cannot.

-- ---------------------------------------------------------------- what's bought

create table home.bought_parts (
  snag_id uuid not null references home.snags(id) on delete cascade,
  -- The item as it is written on the snag's own list. Not a foreign key,
  -- because the list is a text[] — and matching on the text is what lets the
  -- items keep being written the one way they already were.
  item text not null check (length(btrim(item)) between 1 and 60),
  household_id uuid not null references home.households(id) on delete cascade,
  bought_at timestamptz not null default now(),
  bought_by uuid not null references home.profiles(id),
  primary key (snag_id, item)
);

create index on home.bought_parts (household_id);

alter table home.bought_parts enable row level security;

-- The comments policy's shape: a child of a snag asks the snag's property.
-- Deliberately not through `home.snag_property`, which is only ever called from
-- inside SECURITY DEFINER functions and stays revoked from `authenticated` — a
-- policy expression runs as the *calling* role, so using it here would raise
-- `42501 permission denied for function snag_property` on every read rather
-- than returning no rows. That is what 20260911093000 exists for.
create policy "members read what has been bought"
  on home.bought_parts for select using (
    exists (
      select 1 from home.snags s
      where s.id = home.bought_parts.snag_id
        and home.is_property_member(s.property_id)
    )
  );

grant select on home.bought_parts to authenticated;

-- One person ticks at the shop and the other sees it, because there is one
-- house and one trip. Per household, never per person — the same argument as
-- `absent_things`.
create function home.set_part_bought(p_snag_id uuid, p_item text, p_bought boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item text := btrim(p_item);
  v_household uuid;
begin
  perform home.require_property_member(home.snag_property(p_snag_id));

  -- A tick for something that is not on the list is a tick nothing will ever
  -- show, so it is refused rather than stored where nobody can find it.
  select s.household_id into v_household
  from home.snags s
  where s.id = p_snag_id and v_item = any(s.parts);

  if v_household is null then
    raise exception 'That is not on this job''s list';
  end if;

  if p_bought then
    insert into home.bought_parts (snag_id, item, household_id, bought_by)
    values (p_snag_id, v_item, v_household, auth.uid())
    on conflict (snag_id, item) do nothing;
  else
    delete from home.bought_parts
    where snag_id = p_snag_id and item = v_item;
  end if;
end;
$$;

grant execute on function home.set_part_bought(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------- the view

drop view home.snags_with_details;

alter table home.snags drop column needs_parts;

create view home.snags_with_details
with (security_invoker = true)
as
select
  s.id,
  s.reference,
  s.household_id,
  s.property_id,
  s.room,
  s.photo_paths,
  s.description,
  s.status,
  s.priority,
  s.parts,
  s.due_at,
  s.repeat_days,
  s.assignee_id,
  s.thing_id,
  s.reporter_id,
  s.created_at,
  s.updated_at,
  s.updated_by,
  s.last_done_at,
  s.done_at,
  -- What has been got, in the order it is written on the list, so the client
  -- can tick each item without a second read.
  coalesce(
    (select array_agg(i order by ordinality)
     from unnest(s.parts) with ordinality as t(i, ordinality)
     where exists (
       select 1 from home.bought_parts b
       where b.snag_id = s.id and b.item = t.i
     )),
    '{}'
  )                                             as bought,
  -- Derived, so the flag the list filters on cannot disagree with the list:
  -- something is still needed only while an item has not been bought.
  exists (
    select 1
    from unnest(s.parts) as i
    where not exists (
      select 1 from home.bought_parts b
      where b.snag_id = s.id and b.item = i
    )
  )                                             as needs_parts,
  p.name                                        as property_name,
  reporter.display_name                         as reporter_name,
  assignee.display_name                         as assignee_name,
  thing.name                                    as thing_name,
  thing.make                                    as thing_make,
  thing.model                                   as thing_model,
  (select count(*) from home.comments c where c.snag_id = s.id) as comment_count
from home.snags s
join home.properties p       on p.id = s.property_id
join home.profiles reporter  on reporter.id = s.reporter_id
left join home.profiles assignee on assignee.id = s.assignee_id
left join home.things thing      on thing.id = s.thing_id;

grant select on home.snags_with_details to authenticated;

-- ---------------------------------------------------------------- the write

-- Recreated from `20260912160000`'s version — the one that carries `p_thing_id`
-- — with exactly two changes: `needs_parts` is no longer a column to set, and
-- replacing the list drops what was bought for anything no longer on it. Taking
-- an item off the list is deciding it is not needed, so remembering that
-- somebody once bought it would only make the next tick lie.
--
-- `create or replace` keeps the signature, so nothing has to be re-granted and
-- no client call changes shape.
create or replace function home.update_snag(
  p_snag_id uuid,
  p_room text default null,
  p_description text default null,
  p_priority home.snag_priority default null,
  p_due_at timestamptz default null,
  p_repeat_days integer default null,
  p_assignee_id uuid default null,
  p_photo_paths text[] default null,
  p_parts text[] default null,
  p_thing_id uuid default null,
  p_clear text[] default '{}'
)
returns home.snags
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snag home.snags;
  v_clear text[] := coalesce(p_clear, '{}');
  v_started boolean;
begin
  perform home.require_property_member(home.snag_property(p_snag_id));

  if p_assignee_id is not null
     and not exists (
       select 1 from home.property_members m
       where m.property_id = home.snag_property(p_snag_id)
         and m.profile_id = p_assignee_id
     ) then
    raise exception 'That person is not linked to this property';
  end if;

  if p_thing_id is not null
     and home.thing_property(p_thing_id) is distinct from home.snag_property(p_snag_id) then
    raise exception 'That is not something at this place';
  end if;

  -- Deciding to work on something is what starts it, and these are the fields
  -- that say so. Deliberately not room/description/priority, not thing_id —
  -- and deliberately not a tick, which is why buying something has its own
  -- function rather than riding in here.
  v_started := p_assignee_id is not null
            or p_due_at is not null
            or p_repeat_days is not null
            or p_parts is not null
            or 'assignee_id' = any(v_clear)
            or 'due_at' = any(v_clear)
            or 'repeat_days' = any(v_clear);

  update home.snags s set
    room         = case when 'room'        = any(v_clear) then null
                        else coalesce(nullif(btrim(coalesce(p_room, '')), ''), s.room) end,
    description  = case when 'description' = any(v_clear) then null
                        else coalesce(nullif(btrim(coalesce(p_description, '')), ''), s.description) end,
    priority     = case when 'priority'    = any(v_clear) then null else coalesce(p_priority, s.priority) end,
    due_at       = case when 'due_at'      = any(v_clear) then null else coalesce(p_due_at, s.due_at) end,
    repeat_days  = case when 'repeat_days' = any(v_clear) then null else coalesce(p_repeat_days, s.repeat_days) end,
    assignee_id  = case when 'assignee_id' = any(v_clear) then null else coalesce(p_assignee_id, s.assignee_id) end,
    thing_id     = case when 'thing_id'    = any(v_clear) then null else coalesce(p_thing_id, s.thing_id) end,
    photo_paths  = coalesce(p_photo_paths, s.photo_paths),
    parts        = coalesce(p_parts, s.parts),
    status       = case when s.status = 'open' and v_started then 'doing' else s.status end,
    updated_at   = now(),
    updated_by   = auth.uid()
  where s.id = p_snag_id
  returning * into v_snag;

  if v_snag.id is null then
    raise exception 'No such snag';
  end if;

  delete from home.bought_parts b
  where b.snag_id = p_snag_id
    and not (b.item = any(v_snag.parts));

  return v_snag;
end;
$$;
