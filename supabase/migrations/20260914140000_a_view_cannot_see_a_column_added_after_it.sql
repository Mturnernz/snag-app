-- The paperwork was saved and then invisible, and a view is why.
--
-- `20260914090000` added `home.things.document_paths` and taught `update_thing`
-- to write it. It worked: a PDF uploaded, the path landed on the row, the toast
-- said "Document added". Reopening the appliance showed nothing, and reopening
-- it a week later still showed nothing.
--
-- **A view created with `select t.*` freezes its column list at creation.**
-- `things_with_details` was written in `20260912160000`, two days before the
-- column existed, so the star had already been expanded into fifteen named
-- columns and `document_paths` was not one of them. Every read in the app goes
-- through that view. The write succeeded, the read silently dropped the column,
-- and `mapThing` defaulted it to `[]` — so nothing anywhere had an error to
-- report.
--
-- Two things follow, and the second is the one worth keeping:
--
-- 1. The view is recreated with `document_paths` in it.
-- 2. **The columns are written out one by one.** `t.*` in a view is a footgun
--    with a two-day fuse: it reads as "everything" and means "everything as at
--    the moment somebody typed it". Named columns make the next added column a
--    visible omission in a diff rather than a silent one at runtime — the same
--    argument as granting by name rather than by sweep.
--
-- `create or replace view` cannot do this: it may only append columns, and
-- `document_paths` belongs beside `photo_paths` rather than after the counts.
-- So the view is dropped and rebuilt, which takes the grant with it — it is
-- re-issued below.

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
  t.created_by,
  t.created_at,
  t.updated_at,
  t.updated_by,
  p.name as property_name,
  (select count(*) from home.snags s where s.thing_id = t.id) as snag_count,
  (select count(*) from home.snags s where s.thing_id = t.id and s.status <> 'done')
    as open_snag_count
from home.things t
join home.properties p on p.id = t.property_id;

grant select on home.things_with_details to authenticated;

-- ---------------------------------------------------------------- create_thing
--
-- The walkthrough now offers an invoice or a certificate at the same step as the
-- rating plate, so the paperwork has to be able to arrive with the row rather
-- than as a second write. A create followed by an update is two chances to end
-- up with a file in the bucket that nothing points at — which is exactly the
-- orphan this schema has already produced once.
--
-- Adding a parameter means drop and recreate: `create or replace` would leave
-- both signatures resolvable, and a fourteen-argument call would still bind to
-- the old one. The drop takes the grant with it, so it is re-issued with the
-- full type list.
--
-- Documents deliberately do NOT satisfy `things_has_something`. A PDF with no
-- name, no model and no photograph is a file in a bucket, not a record of
-- anything — you cannot find it in a shop by a thing you have to open to read.

drop function if exists home.create_thing(
  uuid, home.thing_kind, text, text, text[], text, text, text, text[],
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
  p_notes text default null
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

  -- Said in words rather than left to the check constraint, which would
  -- surface as `things_has_something` and mean nothing to anyone.
  if v_photos = '{}' and v_name is null and v_model is null then
    raise exception 'Photograph the label, or give it a name — otherwise there is nothing to find it by';
  end if;

  insert into home.things (
    household_id, property_id, kind, name, room, photo_paths, document_paths,
    make, model, serial, consumables,
    installed_at, warranty_until, service_days, spec, notes,
    created_by, updated_by
  )
  values (
    v_household_id, p_property_id, p_kind, v_name,
    nullif(btrim(coalesce(p_room, '')), ''),
    v_photos,
    coalesce(p_document_paths, '{}'),
    nullif(btrim(coalesce(p_make, '')), ''),
    v_model,
    nullif(btrim(coalesce(p_serial, '')), ''),
    coalesce(p_consumables, '{}'),
    p_installed_at, p_warranty_until, p_service_days,
    coalesce(p_spec, '{}'::jsonb),
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(), auth.uid()
  )
  returning * into v_thing;

  return v_thing;
end;
$$;

grant execute on function home.create_thing(
  uuid, home.thing_kind, text, text, text[], text[], text, text, text, text[],
  date, date, integer, jsonb, text
) to authenticated;
