-- Martins Bay becomes a household of its own (see 20261005120000).
--
-- It was the second place in 32 Le Roy's household. It moves out whole: the
-- place, its rooms, its jobs and things and everything hanging off them, and
-- its people — Mike, who owns it, and Leonie, a member. Alyssa was never on it
-- and is not in it. Leonie, left on no place of 32 Le Roy, leaves that
-- household, which is what ends her reach into its storage folder.
--
-- Data only, for one household on the live project, so it is guarded: it does
-- nothing unless the bach is still in the house's household, which also makes
-- it a no-op on a local stack and safe to run twice.
--
-- **The files move first, outside SQL.** A stored path starts with its
-- household's id and storage's policies read that folder, so the bach's 11
-- files are copied to the new household's folder before this runs (storage
-- cannot be written from SQL), this rewrites the paths, and the old copies are
-- removed afterwards. Nothing ever points at a file that is not there.

do $$
declare
  v_house     constant uuid := 'c172fb8b-0f4a-47d6-842b-d4bd14e6d5a4';
  v_bay_place constant uuid := 'fad9c431-0b87-40e4-a5c9-77f3acc5ea3f';
  v_bay       constant uuid := 'e185356d-bfc6-4c54-8996-2dfbd8c156c9';
  v_from      constant text := 'c172fb8b-0f4a-47d6-842b-d4bd14e6d5a4/';
  v_to        constant text := 'e185356d-bfc6-4c54-8996-2dfbd8c156c9/';
  v_paths text[];
begin
  if not exists (
    select 1 from home.properties where id = v_bay_place and household_id = v_house
  ) then
    return;
  end if;

  -- Every file the bach's rows hold, read before anything moves.
  select coalesce(array_agg(distinct f.path), '{}') into v_paths
  from (
    select unnest(photo_paths) as path from home.snags where property_id = v_bay_place
    union all select unnest(photo_paths) from home.things where property_id = v_bay_place
    union all select unnest(document_paths) from home.things where property_id = v_bay_place
  ) f
  where f.path like v_from || '%';

  -- The household, named for its place, as setup names a new one.
  insert into home.households (id, name, created_at)
  select v_bay, p.name, p.created_at from home.properties p where p.id = v_bay_place;

  -- Its people are the place's people, in the place's roles, joined when they
  -- came onto the place.
  insert into home.household_members (household_id, profile_id, role, created_at)
  select v_bay, m.profile_id, m.role, m.created_at
  from home.property_members m
  where m.property_id = v_bay_place;

  update home.properties set household_id = v_bay where id = v_bay_place;

  update home.snags set household_id = v_bay where property_id = v_bay_place;
  update home.things set household_id = v_bay where property_id = v_bay_place;
  update home.projects set household_id = v_bay where property_id = v_bay_place;
  update home.support_requests set household_id = v_bay where property_id = v_bay_place;
  update home.snag_advice a set household_id = v_bay
  from home.snags s where s.id = a.snag_id and s.property_id = v_bay_place;
  update home.bought_parts b set household_id = v_bay
  from home.snags s where s.id = b.snag_id and s.property_id = v_bay_place;

  -- The paths, in order, with only the folder changed.
  update home.snags s set photo_paths = array(
    select case when x like v_from || '%' then v_to || substr(x, length(v_from) + 1) else x end
    from unnest(s.photo_paths) with ordinality u(x, i) order by i
  )
  where s.property_id = v_bay_place;

  update home.things t set
    photo_paths = array(
      select case when x like v_from || '%' then v_to || substr(x, length(v_from) + 1) else x end
      from unnest(t.photo_paths) with ordinality u(x, i) order by i
    ),
    document_paths = array(
      select case when x like v_from || '%' then v_to || substr(x, length(v_from) + 1) else x end
      from unnest(t.document_paths) with ordinality u(x, i) order by i
    )
  where t.property_id = v_bay_place;

  -- Keyed by path, so they follow their files.
  update home.label_readings
  set household_id = v_bay, photo_path = v_to || substr(photo_path, length(v_from) + 1)
  where photo_path = any(v_paths);

  update home.file_tags
  set household_id = v_bay, path = v_to || substr(path, length(v_from) + 1)
  where path = any(v_paths);

  -- What the makers say is kept per household; the bach keeps what it had
  -- found for its own things rather than looking them up again.
  insert into home.product_lookups
    (household_id, product_key, make, model, status, result, reason, created_by, created_at, finished_at)
  select v_bay, l.product_key, l.make, l.model, l.status, l.result, l.reason,
         l.created_by, l.created_at, l.finished_at
  from home.product_lookups l
  where l.household_id = v_house
    and l.product_key in (
      select home.product_key(t.make, t.model) from home.things t
      where t.property_id = v_bay_place and t.make is not null and t.model is not null
    )
  on conflict (household_id, product_key) do nothing;

  -- Invitations naming the bach were into the house's household. The live
  -- link has been used; the other expired in September.
  delete from home.invitations
  where household_id = v_house and v_bay_place = any(property_ids);

  -- Anybody now on no place of the house has left it — leave_household_as's
  -- rule. That is Leonie.
  delete from home.household_members hm
  where hm.household_id = v_house
    and not exists (
      select 1 from home.property_members m
      join home.properties p on p.id = m.property_id
      where p.household_id = v_house and m.profile_id = hm.profile_id
    );
end;
$$;
