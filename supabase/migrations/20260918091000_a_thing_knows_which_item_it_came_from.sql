-- A thing knows which item it came from.
--
-- `things.project_id` already says a record came out of a renovation, and
-- `projects_with_totals.thing_count` already counts them. What neither could say
-- is *which* items have been handed over — so a handover list had no way to stop
-- offering the dishwasher it put in the house record last week.
--
-- Not unique: a tiled bathroom leaves a tile record and a grout record from one
-- line item, and a run of joinery leaves three. `on delete set null` for the
-- standing reason both of this project's other joins have it: deleting the
-- record of the renovation must not delete the washing machine.

alter table home.things
  add column project_item_id uuid references home.project_items(id) on delete set null;

create index on home.things (project_item_id);

-- The view names its columns one by one — `20260914140000` rebuilt it that way
-- precisely so an added column is a visible omission in a diff rather than a
-- silent one at runtime, and this is the first column added since.
--
-- `create or replace view` can only APPEND, and only to the exact list already
-- there, so the whole of the current definition is restated here with the new
-- column last. Reordering it, or leaving one out, fails the migration rather
-- than degrading quietly — which is the behaviour worth having.
create or replace view home.things_with_details
with (security_invoker = true)
as
select
  t.id,
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
  p.name                as property_name,
  project.name          as project_name,
  project.finished_on   as project_finished_on,
  (select count(*) from home.snags s where s.thing_id = t.id)             as snag_count,
  (select count(*) from home.snags s where s.thing_id = t.id and s.status <> 'done')
                                                                          as open_snag_count,
  t.project_item_id
from home.things t
join home.properties p         on p.id = t.property_id
left join home.projects project on project.id = t.project_id;

grant select on home.things_with_details to authenticated;

-- Carried in at creation rather than written afterwards: a create-then-update is
-- two chances to write half of it, which is the same argument `p_document_paths`
-- and `p_project_id` were added for.
create or replace function home.create_thing(
  p_property_id uuid,
  p_kind home.thing_kind,
  p_name text default null,
  p_room text default null,
  p_photo_paths text[] default '{}',
  p_document_paths text[] default '{}',
  p_make text default null,
  p_model text default null,
  p_serial text default null,
  p_consumables text[] default null,
  p_installed_at date default null,
  p_warranty_until date default null,
  p_service_days integer default null,
  p_spec jsonb default null,
  p_notes text default null,
  p_project_id uuid default null,
  p_project_item_id uuid default null
)
returns home.things
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_thing home.things;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_model text := nullif(btrim(coalesce(p_model, '')), '');
  v_photos text[] := coalesce(p_photo_paths, '{}');
  v_project uuid := p_project_id;
begin
  select pr.household_id into v_household_id
  from home.properties pr where pr.id = p_property_id;

  if v_household_id is null then
    raise exception 'No such property';
  end if;

  perform home.require_property_member(p_property_id);

  if v_name is null and v_model is null and coalesce(array_length(v_photos, 1), 0) = 0 then
    raise exception 'Give it a name, a model, or a photo';
  end if;

  -- The item answers which project it belongs to, so a handover cannot file the
  -- record against one renovation and the item against another.
  if p_project_item_id is not null then
    v_project := coalesce(v_project, home.item_project(p_project_item_id));
  end if;

  insert into home.things (
    household_id, property_id, kind, name, room, make, model, serial, consumables,
    installed_at, warranty_until, service_days, spec, notes,
    photo_paths, document_paths, project_id, project_item_id, created_by, updated_by
  )
  values (
    v_household_id, p_property_id, p_kind, v_name,
    nullif(btrim(coalesce(p_room, '')), ''),
    nullif(btrim(coalesce(p_make, '')), ''),
    v_model,
    nullif(btrim(coalesce(p_serial, '')), ''),
    coalesce(p_consumables, '{}'),
    p_installed_at, p_warranty_until, p_service_days,
    coalesce(p_spec, '{}'::jsonb),
    nullif(btrim(coalesce(p_notes, '')), ''),
    v_photos, coalesce(p_document_paths, '{}'),
    v_project, p_project_item_id,
    auth.uid(), auth.uid()
  )
  returning * into v_thing;

  return v_thing;
end;
$$;

grant execute on function home.create_thing(
  uuid, home.thing_kind, text, text, text[], text[], text, text, text, text[],
  date, date, integer, jsonb, text, uuid, uuid
) to authenticated;

notify pgrst, 'reload schema';
