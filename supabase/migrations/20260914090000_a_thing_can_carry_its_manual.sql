-- A thing can carry its manual
--
-- The house record already holds what a thing *is* — make, model, serial, the
-- photograph of its plate. What it could not hold is the paperwork: the manual
-- that says which filter, the receipt that proves the warranty. Those are the
-- answers somebody wants in a shop or on the phone to a repairer, and until now
-- they lived in a drawer.
--
-- Documents go in `home-photos`, beside the photos, rather than in a bucket of
-- their own. The bucket's name is then a small lie, but the alternative is four
-- more storage policies, another EXECUTE grant on another folder helper and a
-- second signing path in the client — all to hold the same bytes under the same
-- `<household_id>/<file>` layout that `home.can_use_photo_folder` already
-- answers for. `20260912160000` made the same call for photos and said so; this
-- follows it. The one thing that genuinely had to change is the bucket's mime
-- allow-list, which is images-only, and which refuses a PDF in Storage itself
-- before RLS is ever consulted.

alter table home.things
  add column document_paths text[] not null default '{}';

comment on column home.things.document_paths is
  'Storage paths in home-photos, laid out <household_id>/docs/<file>. The original filename is kept in the key because it is what the list shows.';

-- Images only until now, so `application/pdf` was rejected by Storage before it
-- reached a policy — a 400 with nothing in the logs about permissions.
update storage.buckets
set allowed_mime_types = allowed_mime_types || array['application/pdf']
where id = 'home-photos'
  and not (allowed_mime_types @> array['application/pdf']);

-- Dropped and recreated rather than replaced, because adding a parameter
-- changes the signature and `create or replace` would leave both resolvable.
-- The full argument list has to be spelled out, and the grant re-issued after,
-- because a drop takes the grant with it.
drop function home.update_thing(
  uuid, home.thing_kind, text, text, text[], text, text, text, text[],
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

  -- Worked out and checked BEFORE the write, not after it. A check constraint
  -- is evaluated as the row is written, so a guard sitting after the UPDATE
  -- never runs: `things_has_something` raises first and surfaces its own name,
  -- which means nothing at all to whoever just cleared the last field.
  --
  -- Documents deliberately do not count towards it. A manual with no make, no
  -- model and no name is a PDF nobody can search for, and the constraint exists
  -- to keep exactly that out of the record.
  if v_photos = '{}' and v_name is null and v_model is null then
    raise exception 'Leave it a photo, a name or a model number — otherwise there is no way back to it';
  end if;

  update home.things t set
    kind           = coalesce(p_kind, t.kind),
    name           = v_name,
    model          = v_model,
    photo_paths    = v_photos,
    -- Like photo_paths and consumables: an array is emptied by passing '{}',
    -- not by naming it in p_clear, so it stays out of that vocabulary.
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
    consumables    = coalesce(p_consumables, t.consumables),
    spec           = v_spec,
    updated_at     = now(),
    updated_by     = auth.uid()
  where t.id = p_thing_id
  returning * into v_thing;

  return v_thing;
end;
$$;

-- Granted by name, with the full argument list. A sweep that grants needs both
-- lists; this lists what it grants.
grant execute on function home.update_thing(
  uuid, home.thing_kind, text, text, text[], text[], text, text, text, text[],
  date, date, integer, jsonb, text, text[]
) to authenticated;
