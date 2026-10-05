-- ============================================================================
-- A consumable is used with things — one, several or none.
-- ============================================================================
--
-- The dishwasher tablets go with the dishwasher; one box of heat pump filters
-- fits three heads; the weed killer goes with nothing and lives in the Garage.
-- So it is a join table, the `snag_things` shape, rather than a column: a
-- consumable pointing at one appliance would be wrong the first time a house
-- has two of something.
--
-- **Cascade on both sides.** A row is the statement "these two go together",
-- and that statement about a thing that no longer exists is worth nothing —
-- the consumable itself stays, it simply goes with one fewer thing.

create table if not exists home.thing_uses (
  consumable_id uuid not null references home.things(id) on delete cascade,
  thing_id      uuid not null references home.things(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references home.profiles(id),
  primary key (consumable_id, thing_id),
  constraint thing_uses_not_itself check (consumable_id <> thing_id)
);

create index if not exists thing_uses_thing_idx on home.thing_uses (thing_id);

alter table home.thing_uses enable row level security;

-- Readable by whoever can read the consumable — the property check every other
-- read policy goes through. No write policies: `set_thing_uses` is the way in.
create policy thing_uses_read on home.thing_uses for select using (
  exists (
    select 1 from home.things t
    where t.id = thing_uses.consumable_id
      and home.is_property_member(t.property_id)
  )
);

grant select on home.thing_uses to authenticated;

/*
 * What a consumable is used with, as a whole set in one call — a picker with
 * checkboxes answers one question, and add/remove pairs would let a half
 * answer reach the row (`set_snag_things`' argument).
 *
 * Refuses, in words: a thing that is not a consumable; anything at another
 * place, which the read policy would then hide; and a consumable used with
 * another consumable, which is a shopping list rather than a link.
 */
create or replace function home.set_thing_uses(p_consumable_id uuid, p_thing_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property uuid;
  v_kind home.thing_kind;
  v_wanted uuid[] := coalesce(p_thing_ids, '{}');
begin
  select t.property_id, t.kind into v_property, v_kind from home.things t where t.id = p_consumable_id;
  if v_property is null then
    raise exception 'That item no longer exists';
  end if;
  if not home.is_property_member(v_property) then
    raise exception 'That item is at a place you are not on';
  end if;
  if v_kind <> 'consumable' then
    raise exception 'Only a consumable is used with other things';
  end if;

  if exists (
    select 1 from unnest(v_wanted) w(id)
    left join home.things t on t.id = w.id
    where t.id is null or t.property_id is distinct from v_property
  ) then
    raise exception 'Those are not all recorded at this place';
  end if;

  if exists (
    select 1 from unnest(v_wanted) w(id)
    join home.things t on t.id = w.id
    where t.kind = 'consumable'
  ) then
    raise exception 'A consumable is used with an appliance, not another consumable';
  end if;

  delete from home.thing_uses u
  where u.consumable_id = p_consumable_id
    and not (u.thing_id = any(v_wanted));

  insert into home.thing_uses (consumable_id, thing_id, created_by)
  select p_consumable_id, w.id, auth.uid() from unnest(v_wanted) w(id)
  on conflict do nothing;
end;
$$;

revoke execute on function home.set_thing_uses(uuid, uuid[]) from public, anon;
grant execute on function home.set_thing_uses(uuid, uuid[]) to authenticated;

-- Both directions on the record itself, so neither page needs a second read:
-- a consumable says what it is used with, an appliance what it uses. Appended,
-- which is all `create or replace view` can do, and **security_invoker
-- restated**: a replace without it resets the option and the view stops
-- asking RLS anything (`20260921100000`). The joined rows are read through
-- `home.things`' own policy for the same reason.
create or replace view home.things_with_details with (security_invoker = true) as
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
    t.project_item_id,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'room', a.room, 'kind', a.kind)
                 ORDER BY a.name)
           FROM home.thing_uses u
           JOIN home.things a ON a.id = u.thing_id
          WHERE u.consumable_id = t.id), '[]'::jsonb) AS used_with,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'room', c.room, 'make', c.make)
                 ORDER BY c.name)
           FROM home.thing_uses u
           JOIN home.things c ON c.id = u.consumable_id
          WHERE u.thing_id = t.id), '[]'::jsonb) AS uses
   FROM home.things t
     JOIN home.properties p ON p.id = t.property_id
     LEFT JOIN home.projects project ON project.id = t.project_id;
