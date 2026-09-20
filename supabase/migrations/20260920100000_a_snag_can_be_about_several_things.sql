-- A job can be about more than one thing.
--
-- `snags.thing_id` held exactly one, which was the right shape while the answer
-- was asked as a two-second tag at capture. It is the wrong shape for the
-- question people actually arrive with: a leak under the sink is about the
-- mixer *and* the waste trap, and a kitchen job is very often about two
-- appliances sitting beside each other.
--
-- **It is a join table rather than a second column**, and the old column stops
-- being the link rather than staying as a "primary" one. Two writers of one
-- fact is the failure this schema keeps naming — `needs_parts` maintained
-- beside the list it describes, a rollup with two paths to sum through — and a
-- `thing_id` kept in step with the first row of a set is exactly that.
create table if not exists home.snag_things (
  snag_id  uuid not null references home.snags(id)  on delete cascade,
  thing_id uuid not null references home.things(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references home.profiles(id),
  primary key (snag_id, thing_id)
);

create index if not exists snag_things_thing_idx on home.snag_things (thing_id);

-- **Cascade here, unlike `snags.thing_id`.** That column is `on delete set
-- null` because what was wrong with the old dishwasher is still what was wrong
-- — the *job* survives its subject. A row in this table is not a job, it is the
-- statement "these two are related", and a statement about a thing that no
-- longer exists is not worth keeping.

alter table home.snag_things enable row level security;

-- Readable by whoever can read the snag, which is the property check every
-- other read policy goes through. Writes have no policy, as everywhere in this
-- schema: `set_snag_things` is the only way in.
create policy snag_things_read on home.snag_things for select using (
  exists (
    select 1 from home.snags s
    where s.id = snag_things.snag_id
      and home.is_property_member(s.property_id)
  )
);

grant select on home.snag_things to authenticated;

-- Everything the single column already said, carried over so nothing is lost
-- and so the join table is the only place to look from here on.
insert into home.snag_things (snag_id, thing_id)
select s.id, s.thing_id
from home.snags s
where s.thing_id is not null
on conflict do nothing;

/*
 * Replacing what a job is about.
 *
 * The whole set in one call rather than add/remove pairs: a picker with
 * checkboxes and a Done button is answering one question, and two RPCs would
 * let somebody's half-finished answer reach the row.
 *
 * **It does not start the job, and that is deliberate.** `update_snag` moves a
 * snag to 'doing' on assignee, due date, repeat or parts, because each of those
 * is deciding to do the work. Saying what something is about is the tail of
 * capture — the same gesture as tagging the room — and a link that marked a
 * brand-new snag 'doing' would empty the status from the same end the retired
 * *Start it* button did. So this touches neither `status` nor `updated_at`,
 * and it is its own function precisely so a caller cannot smuggle the link in
 * beside eight other fields, the same argument `set_part_bought` and
 * `set_quote_status` are separate for.
 */
create or replace function home.set_snag_things(p_snag_id uuid, p_thing_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property uuid;
  v_wanted uuid[] := coalesce(p_thing_ids, '{}');
begin
  select s.property_id into v_property from home.snags s where s.id = p_snag_id;
  if v_property is null then
    raise exception 'That job no longer exists';
  end if;
  if not home.is_property_member(v_property) then
    raise exception 'That job is at a place you are not on';
  end if;

  -- Every thing has to be at the same place as the job. A snag at the house
  -- pointing at the bach's dishwasher is a row nobody can read back, and the
  -- read policy would hide half of what was just written.
  if exists (
    select 1 from unnest(v_wanted) w(id)
    left join home.things t on t.id = w.id
    where t.id is null or t.property_id is distinct from v_property
  ) then
    raise exception 'Those are not all recorded at this place';
  end if;

  delete from home.snag_things st
  where st.snag_id = p_snag_id
    and not (st.thing_id = any(v_wanted));

  insert into home.snag_things (snag_id, thing_id, created_by)
  select p_snag_id, w.id, auth.uid() from unnest(v_wanted) w(id)
  on conflict do nothing;
end;
$$;

grant execute on function home.set_snag_things(uuid, uuid[]) to authenticated;

-- `create or replace view` can only *append* columns, which is exactly what
-- this is — so the grant survives and nothing has to be re-issued.
create or replace view home.snags_with_details as
 SELECT s.id,
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
    s.project_id,
    s.reporter_id,
    s.created_at,
    s.updated_at,
    s.updated_by,
    s.last_done_at,
    s.done_at,
    COALESCE(( SELECT array_agg(t.i ORDER BY t.ordinality) AS array_agg
           FROM unnest(s.parts) WITH ORDINALITY t(i, ordinality)
          WHERE (EXISTS ( SELECT 1
                   FROM home.bought_parts b
                  WHERE b.snag_id = s.id AND b.item = t.i))), '{}'::text[]) AS bought,
    (EXISTS ( SELECT 1
           FROM unnest(s.parts) i(i)
          WHERE NOT (EXISTS ( SELECT 1
                   FROM home.bought_parts b
                  WHERE b.snag_id = s.id AND b.item = i.i)))) AS needs_parts,
    p.name AS property_name,
    reporter.display_name AS reporter_name,
    assignee.display_name AS assignee_name,
    thing.name AS thing_name,
    thing.make AS thing_make,
    thing.model AS thing_model,
    project.name AS project_name,
    ( SELECT count(*) AS count
           FROM home.comments c
          WHERE c.snag_id = s.id) AS comment_count,
    s.project_item_id,
    item.name AS project_item_name,
    element.name AS project_element_name,
    -- What the job is about, whole, so the card can draw itself without a
    -- second round trip per row. Ordered by name because the card is read
    -- rather than ranked, and `'[]'` rather than null because a caller
    -- defaulting a null is a caller that can forget to.
    COALESCE(( SELECT jsonb_agg(jsonb_build_object(
                   'id', lt.id, 'name', lt.name, 'room', lt.room,
                   'make', lt.make, 'model', lt.model, 'kind', lt.kind)
                 ORDER BY lt.name)
           FROM home.snag_things st
           JOIN home.things lt ON lt.id = st.thing_id
          WHERE st.snag_id = s.id), '[]'::jsonb) AS linked_things
   FROM home.snags s
     JOIN home.properties p ON p.id = s.property_id
     JOIN home.profiles reporter ON reporter.id = s.reporter_id
     LEFT JOIN home.profiles assignee ON assignee.id = s.assignee_id
     LEFT JOIN home.things thing ON thing.id = s.thing_id
     LEFT JOIN home.projects project ON project.id = s.project_id
     LEFT JOIN home.project_items item ON item.id = s.project_item_id
     LEFT JOIN home.project_elements element ON element.id = item.element_id;

-- The House tab's counts follow the link rather than the retired column. The
-- backfill above means this can only ever be the same number or larger, never
-- smaller, so no count somebody has already seen goes down because of this.
create or replace view home.things_with_details as
 SELECT t.id,
    t.household_id,
    t.property_id,
    t.kind,
    t.name,
    t.room,
    t.photo_paths,
    t.document_paths,
    t.make,
    t.model,
    t.serial,
    t.consumables,
    t.installed_at,
    t.warranty_until,
    t.service_days,
    t.spec,
    t.notes,
    t.project_id,
    t.created_by,
    t.created_at,
    t.updated_at,
    t.updated_by,
    p.name AS property_name,
    project.name AS project_name,
    project.finished_on AS project_finished_on,
    ( SELECT count(*) AS count
           FROM home.snag_things st
          WHERE st.thing_id = t.id) AS snag_count,
    ( SELECT count(*) AS count
           FROM home.snag_things st
           JOIN home.snags s ON s.id = st.snag_id
          WHERE st.thing_id = t.id AND s.status <> 'done'::home.snag_status) AS open_snag_count,
    t.project_item_id
   FROM home.things t
     JOIN home.properties p ON p.id = t.property_id
     LEFT JOIN home.projects project ON project.id = t.project_id;

notify pgrst, 'reload schema';
