-- A thing can change its kind.
--
-- `create_thing` has to be given one, because `kind` is not null — and capture
-- must not stop to ask, because stopping to ask is the thing the whole
-- arrangement exists to avoid. So the client files everything as `appliance`
-- and the amend row offers Paint as a tap, one second later, editing something
-- already safely saved. Without this the guess is permanent, and a photo of a
-- paint tin lid is filed as an appliance forever.
--
-- Left out of the first migration by an oversight that the screen found
-- immediately: the amend row had a Paint chip it could not wire up.
--
-- Dropped and recreated rather than replaced, because adding a parameter
-- changes the signature and `create or replace` would leave both resolvable.

drop function home.update_thing(
  uuid, text, text, text[], text, text, text, text[],
  date, date, integer, jsonb, text, text[]
);

create function home.update_thing(
  p_thing_id uuid,
  p_kind home.thing_kind default null,
  p_name text default null,
  p_room text default null,
  p_photo_paths text[] default null,
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
  if v_photos = '{}' and v_name is null and v_model is null then
    raise exception 'Leave it a photo, a name or a model number — otherwise there is no way back to it';
  end if;

  update home.things t set
    -- Not clearable: every thing is of some kind, and an unkinded row has
    -- nowhere to sit under "By kind".
    kind           = coalesce(p_kind, t.kind),
    name           = v_name,
    model          = v_model,
    photo_paths    = v_photos,
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

grant execute on function home.update_thing(
  uuid, home.thing_kind, text, text, text[], text, text, text, text[],
  date, date, integer, jsonb, text, text[]
) to authenticated;
