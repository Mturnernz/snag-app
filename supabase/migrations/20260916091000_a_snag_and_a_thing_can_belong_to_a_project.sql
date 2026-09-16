-- A snag can belong to a project, and so can a thing.
--
-- Two joins, both using mechanisms that already exist, and both following the
-- rule `thing_id` set in `20260912160000`: **pointing at something is not doing
-- something.**
--
-- **`snags.project_id` — the punch list, in the app's own word.** The defects
-- list at the end of a renovation is literally a snag list; it is where the
-- word comes from. So a project does not get a to-do list of its own: it gets a
-- filter over `home.snags`, and those snags sit on the List tab in their rooms
-- with everything else. One place work lives, or neither is trustworthy — the
-- Schedule tab's rule, applied to a different noun.
--
-- `v_started` is untouched. Saying which renovation a dripping cistern belongs
-- to is the tail of capture, the same gesture as tagging the room, so it must
-- not move the job to 'doing'. The retired *Start it* button emptied the status
-- from one end; a project link that started twelve jobs at once would empty it
-- from the other.
--
-- **`things.project_id` — what the project left behind**, and the reason to
-- keep the record at all. Three years after the laundry, nobody asks what it
-- cost; they ask what the model number of the machine is and whether it is
-- still under warranty. That answer is a thing, reached from the project, with
-- the invoice attached to the quote that bought it.
--
-- Both are `on delete set null`, never cascade, for the reason the thing link
-- already is: deleting the renovation must not delete the washing machine, and
-- what was wrong with the cistern is still what was wrong.
--
-- Both views are dropped and rebuilt rather than replaced, because `create or
-- replace view` can only *append* columns and `project_name` belongs beside the
-- other joined names. Dropping takes the grant with it, so both are re-issued.

-- ---------------------------------------------------------------- the columns

alter table home.snags
  add column project_id uuid references home.projects(id) on delete set null;

create index on home.snags (project_id);

alter table home.things
  add column project_id uuid references home.projects(id) on delete set null;

create index on home.things (project_id);

-- ---------------------------------------------------------------- the views

drop view home.snags_with_details;

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
  s.project_id,
  s.reporter_id,
  s.created_at,
  s.updated_at,
  s.updated_by,
  s.last_done_at,
  s.done_at,
  coalesce(
    (select array_agg(i order by ordinality)
     from unnest(s.parts) with ordinality as t(i, ordinality)
     where exists (
       select 1 from home.bought_parts b
       where b.snag_id = s.id and b.item = t.i
     )),
    '{}'
  )                                             as bought,
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
  project.name                                  as project_name,
  (select count(*) from home.comments c where c.snag_id = s.id) as comment_count
from home.snags s
join home.properties p       on p.id = s.property_id
join home.profiles reporter  on reporter.id = s.reporter_id
left join home.profiles assignee on assignee.id = s.assignee_id
left join home.things thing      on thing.id = s.thing_id
left join home.projects project  on project.id = s.project_id;

grant select on home.snags_with_details to authenticated;

drop view home.things_with_details;

create view home.things_with_details
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
  p.name as property_name,
  -- What the House record says about where this came from: the project's name,
  -- and when it finished. `finished_on` rather than `installed_at`, because the
  -- two answer different questions and the thing's own column stays the
  -- household's answer rather than the project's.
  project.name        as project_name,
  project.finished_on as project_finished_on,
  (select count(*) from home.snags s where s.thing_id = t.id) as snag_count,
  (select count(*) from home.snags s where s.thing_id = t.id and s.status <> 'done')
    as open_snag_count
from home.things t
join home.properties p on p.id = t.property_id
left join home.projects project on project.id = t.project_id;

grant select on home.things_with_details to authenticated;

-- A project's own page says how many jobs are hanging off it, and the tab's
-- card says it too — which is the number that actually tells you a renovation
-- is not finished, whatever its status says.
drop view home.projects_with_totals;

create view home.projects_with_totals
with (security_invoker = true)
as
select
  p.id,
  p.household_id,
  p.property_id,
  p.name,
  p.summary,
  p.status,
  p.started_on,
  p.target_on,
  p.finished_on,
  p.budget,
  p.budget_incl_gst,
  p.photo_paths,
  p.document_paths,
  p.created_by,
  p.created_at,
  p.updated_at,
  p.updated_by,
  pr.name                as property_name,
  creator.display_name   as created_by_name,
  t.element_count,
  t.shown_element_count,
  t.item_count,
  t.priced_count,
  t.quoted_count,
  t.chosen_total,
  t.range_low,
  t.range_high,
  t.spent_total,
  f.file_count,
  (select count(*) from home.snags s where s.project_id = p.id)           as snag_count,
  (select count(*) from home.snags s where s.project_id = p.id and s.status <> 'done')
                                                                          as open_snag_count,
  (select count(*) from home.things th where th.project_id = p.id)        as thing_count
from home.projects p
join home.properties pr      on pr.id = p.property_id
join home.profiles creator   on creator.id = p.created_by
cross join lateral (
  select
    count(*)                                        as element_count,
    count(*) filter (where not e.implicit)          as shown_element_count,
    coalesce(sum(e.item_count), 0)                  as item_count,
    coalesce(sum(e.priced_count), 0)                as priced_count,
    coalesce(sum(e.quoted_count), 0)                as quoted_count,
    sum(e.chosen_total)                             as chosen_total,
    sum(e.range_low)                                as range_low,
    sum(e.range_high)                               as range_high,
    sum(e.spent_total)                              as spent_total
  from home.project_elements_with_totals e
  where e.project_id = p.id
) t
cross join lateral (
  select count(*) as file_count
  from home.project_files pf
  where pf.project_id = p.id
) f;

grant select on home.projects_with_totals to authenticated;

-- ---------------------------------------------------------------- the writes
--
-- Dropped and recreated rather than `create or replace`d: adding a parameter
-- changes the signature, and `create or replace` with a different argument list
-- creates a second overload rather than replacing the first. PostgREST calls
-- these by named argument, so two overloads is an ambiguous-function error on
-- every call — a total outage for one extra parameter.

drop function home.create_snag(
  uuid, text, text, text[], home.snag_priority, uuid, timestamptz, integer
);

create function home.create_snag(
  p_property_id uuid,
  p_room text default null,
  p_description text default null,
  p_photo_paths text[] default '{}',
  p_priority home.snag_priority default null,
  p_thing_id uuid default null,
  p_due_at timestamptz default null,
  p_repeat_days integer default null,
  p_project_id uuid default null
)
returns home.snags
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_snag home.snags;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_photos text[] := coalesce(p_photo_paths, '{}');
begin
  select pr.household_id into v_household_id
  from home.properties pr where pr.id = p_property_id;

  if v_household_id is null then
    raise exception 'No such property';
  end if;

  perform home.require_property_member(p_property_id);

  if v_photos = '{}' and v_description is null then
    raise exception 'Add a photo or a few words — otherwise there is nothing to go on';
  end if;

  if p_thing_id is not null and home.thing_property(p_thing_id) is distinct from p_property_id then
    raise exception 'That is not something at this place';
  end if;

  -- A project at another place would be a snag filed against a renovation
  -- whoever can see the snag cannot open. Same check, same reason.
  if p_project_id is not null
     and home.project_property(p_project_id) is distinct from p_property_id then
    raise exception 'That is not a project at this place';
  end if;

  if p_repeat_days is not null and p_repeat_days <= 0 then
    raise exception 'A cycle has to be a number of days';
  end if;
  if p_repeat_days is not null and p_due_at is null then
    raise exception 'A job that comes round needs a first date';
  end if;

  insert into home.snags (
    household_id, property_id, room, description, photo_paths, priority,
    thing_id, project_id, due_at, repeat_days, reporter_id, updated_by
  )
  values (
    v_household_id, p_property_id,
    nullif(btrim(coalesce(p_room, '')), ''),
    v_description, v_photos, p_priority,
    p_thing_id, p_project_id, p_due_at, p_repeat_days, auth.uid(), auth.uid()
  )
  returning * into v_snag;

  return v_snag;
end;
$$;

grant execute on function home.create_snag(
  uuid, text, text, text[], home.snag_priority, uuid, timestamptz, integer, uuid
) to authenticated;

drop function home.update_snag(
  uuid, text, text, home.snag_priority, timestamptz, integer, uuid, text[], text[], uuid, text[]
);

create function home.update_snag(
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
  p_project_id uuid default null,
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

  if p_project_id is not null
     and home.project_property(p_project_id) is distinct from home.snag_property(p_snag_id) then
    raise exception 'That is not a project at this place';
  end if;

  -- Unchanged, and that is the point: `project_id` is not in this list. Saying
  -- which renovation a job belongs to is the tail of capture, the same gesture
  -- as tagging the room — not a decision to do the work.
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
    project_id   = case when 'project_id'  = any(v_clear) then null else coalesce(p_project_id, s.project_id) end,
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

grant execute on function home.update_snag(
  uuid, text, text, home.snag_priority, timestamptz, integer, uuid,
  text[], text[], uuid, uuid, text[]
) to authenticated;

-- `create_thing` grows one too, so an item promoted to a thing arrives already
-- knowing where it came from — a create followed by an update is two chances to
-- write half of it.
drop function home.create_thing(
  uuid, home.thing_kind, text, text, text[], text[], text, text, text, text[],
  date, date, integer, jsonb, text
);

create function home.create_thing(
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
  p_project_id uuid default null
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
begin
  select pr.household_id into v_household_id
  from home.properties pr where pr.id = p_property_id;

  if v_household_id is null then
    raise exception 'No such property';
  end if;

  perform home.require_property_member(p_property_id);

  if v_photos = '{}' and v_name is null and v_model is null then
    raise exception 'Photograph the label, or give it a name — otherwise there is nothing to find it by';
  end if;

  if p_project_id is not null
     and home.project_property(p_project_id) is distinct from p_property_id then
    raise exception 'That is not a project at this place';
  end if;

  insert into home.things (
    household_id, property_id, kind, name, room, photo_paths, document_paths,
    make, model, serial, consumables,
    installed_at, warranty_until, service_days, spec, notes, project_id,
    created_by, updated_by
  )
  values (
    v_household_id, p_property_id, p_kind, v_name,
    nullif(btrim(coalesce(p_room, '')), ''),
    v_photos, coalesce(p_document_paths, '{}'),
    nullif(btrim(coalesce(p_make, '')), ''),
    v_model,
    nullif(btrim(coalesce(p_serial, '')), ''),
    coalesce(p_consumables, '{}'),
    p_installed_at, p_warranty_until, p_service_days,
    coalesce(p_spec, '{}'::jsonb),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_project_id,
    auth.uid(), auth.uid()
  )
  returning * into v_thing;

  return v_thing;
end;
$$;

grant execute on function home.create_thing(
  uuid, home.thing_kind, text, text, text[], text[], text, text, text, text[],
  date, date, integer, jsonb, text, uuid
) to authenticated;

-- And `update_thing`, so the link can be undone from the thing's own page. The
-- same × the thing link on a snag already carries, for the same reason: a
-- washing machine mis-filed against the wrong renovation must be correctable
-- from the page somebody is looking at.
drop function home.update_thing(
  uuid, home.thing_kind, text, text, text[], text[], text, text, text, text[],
  date, date, integer, jsonb, text, text[]
);

create function home.update_thing(
  p_thing_id uuid,
  p_kind home.thing_kind default null,
  p_name text default null,
  p_room text default null,
  p_photo_paths text[] default null,
  p_document_paths text[] default null,
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
  p_clear text[] default '{}'
)
returns home.things
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thing home.things;
  v_current home.things;
  v_clear text[] := coalesce(p_clear, '{}');
  v_spec jsonb;
  v_key text;
  v_name text;
  v_model text;
  v_photos text[];
begin
  perform home.require_property_member(home.thing_property(p_thing_id));

  select * into v_current from home.things t where t.id = p_thing_id;

  if v_current.id is null then
    raise exception 'No such thing';
  end if;

  if p_project_id is not null
     and home.project_property(p_project_id) is distinct from v_current.property_id then
    raise exception 'That is not a project at this place';
  end if;

  v_spec := v_current.spec;

  if p_spec is not null then
    v_spec := v_spec || p_spec;
  end if;

  foreach v_key in array v_clear loop
    if v_key like 'spec.%' then
      v_spec := v_spec - substring(v_key from 6);
    end if;
  end loop;

  v_name := case when 'name'  = any(v_clear) then null
                 else coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_current.name) end;
  v_model := case when 'model' = any(v_clear) then null
                 else coalesce(nullif(btrim(coalesce(p_model, '')), ''), v_current.model) end;
  v_photos := coalesce(p_photo_paths, v_current.photo_paths);

  if v_photos = '{}' and v_name is null and v_model is null then
    raise exception 'Leave it a photo, a name or a model number — otherwise there is no way back to it';
  end if;

  update home.things t set
    kind           = coalesce(p_kind, t.kind),
    name           = v_name,
    model          = v_model,
    photo_paths    = v_photos,
    document_paths = coalesce(p_document_paths, t.document_paths),
    room           = case when 'room'   = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_room, '')), ''), t.room) end,
    make           = case when 'make'   = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_make, '')), ''), t.make) end,
    serial         = case when 'serial' = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_serial, '')), ''), t.serial) end,
    notes          = case when 'notes'  = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_notes, '')), ''), t.notes) end,
    installed_at   = case when 'installed_at'   = any(v_clear) then null
                          else coalesce(p_installed_at, t.installed_at) end,
    warranty_until = case when 'warranty_until' = any(v_clear) then null
                          else coalesce(p_warranty_until, t.warranty_until) end,
    service_days   = case when 'service_days'   = any(v_clear) then null
                          else coalesce(p_service_days, t.service_days) end,
    project_id     = case when 'project_id'     = any(v_clear) then null
                          else coalesce(p_project_id, t.project_id) end,
    consumables    = coalesce(p_consumables, t.consumables),
    spec           = v_spec,
    updated_at     = now(),
    updated_by     = auth.uid()
  where t.id = p_thing_id
  returning * into v_thing;

  return v_thing;
end;
$$;

grant execute on function home.update_thing(
  uuid, home.thing_kind, text, text, text[], text[], text, text, text, text[],
  date, date, integer, jsonb, text, uuid, text[]
) to authenticated;

notify pgrst, 'reload schema';
