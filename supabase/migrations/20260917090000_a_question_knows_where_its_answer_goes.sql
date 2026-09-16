-- A question knows where its answer goes.
--
-- An open question about a project ("what did the geotech engineer cost", "what
-- was the Kitchen Mania total") is an ordinary snag, on the ordinary list, in
-- its room. A project does not get a to-do list of its own — one place work
-- lives, or neither is trustworthy.
--
-- What it gains is a binding: the snag says which project item its answer
-- belongs to, written at the moment the question is written rather than sorted
-- out at the moment it is answered. Whoever writes the question knows the
-- destination for free; three months later nobody does.
--
-- Resolution is most-specific-first, and both levels already exist:
--   project_item_id -> the item (and, by join, its element and project)
--   project_id      -> the whole job
-- So one nullable column is the whole schema change. It mirrors thing_id
-- exactly, on delete set null included: delete the item and the question falls
-- back to the project rather than becoming an orphan.
--
-- It is deliberately NOT in update_snag, and therefore cannot reach v_started.
-- Pointing a question at an item is the tail of capture, the same gesture as
-- tagging a room — it is not a decision to start work. create_snag takes it
-- instead, for the reason 20260914150000 gave due_at and repeat_days to
-- create_snag: a create-then-update is two chances to write half of it.

-- 1. The binding ------------------------------------------------------------

alter table home.snags
  add column project_item_id uuid references home.project_items(id) on delete set null;

create index snags_project_item_id_idx
  on home.snags(project_item_id) where project_item_id is not null;

comment on column home.snags.project_item_id is
  'Which project item this snag''s answer belongs to. Set at creation, never by update_snag, so it can never start a job.';

-- 2. The view, by name ------------------------------------------------------
-- Appended at the end: create or replace view can only add columns there, and
-- dropping the view to place it beside project_id would take the grant with it.

create or replace view home.snags_with_details as
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
    coalesce((
      select array_agg(t.i order by t.ordinality)
      from unnest(s.parts) with ordinality t(i, ordinality)
      where exists (select 1 from home.bought_parts b where b.snag_id = s.id and b.item = t.i)
    ), '{}'::text[]) as bought,
    exists (
      select 1 from unnest(s.parts) i(i)
      where not exists (select 1 from home.bought_parts b where b.snag_id = s.id and b.item = i.i)
    ) as needs_parts,
    p.name as property_name,
    reporter.display_name as reporter_name,
    assignee.display_name as assignee_name,
    thing.name as thing_name,
    thing.make as thing_make,
    thing.model as thing_model,
    project.name as project_name,
    (select count(*) from home.comments c where c.snag_id = s.id) as comment_count,
    s.project_item_id,
    item.name as project_item_name,
    element.name as project_element_name
  from home.snags s
  join home.properties p on p.id = s.property_id
  join home.profiles reporter on reporter.id = s.reporter_id
  left join home.profiles assignee on assignee.id = s.assignee_id
  left join home.things thing on thing.id = s.thing_id
  left join home.projects project on project.id = s.project_id
  left join home.project_items item on item.id = s.project_item_id
  left join home.project_elements element on element.id = item.element_id;

-- 3. create_snag carries the binding ----------------------------------------
-- Adding a parameter makes an OVERLOAD, not a replacement, and two create_snags
-- whose argument lists differ by one defaulted uuid are ambiguous to PostgREST:
-- every existing call — the compose bar included — would start answering
-- "function is not unique". The old signature goes first, deliberately.

drop function if exists home.create_snag(
  uuid, text, text, text[], home.snag_priority, uuid, timestamptz, integer, uuid);

create or replace function home.create_snag(
  p_property_id uuid,
  p_room text default null,
  p_description text default null,
  p_photo_paths text[] default '{}',
  p_priority home.snag_priority default null,
  p_thing_id uuid default null,
  p_due_at timestamptz default null,
  p_repeat_days integer default null,
  p_project_id uuid default null,
  p_project_item_id uuid default null
) returns home.snags
language plpgsql security definer set search_path to '' as $$
declare
  v_household_id uuid; v_snag home.snags;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_photos text[] := coalesce(p_photo_paths, '{}');
  v_item_project uuid;
begin
  select pr.household_id into v_household_id from home.properties pr where pr.id = p_property_id;
  if v_household_id is null then raise exception 'No such property'; end if;
  perform home.require_property_member(p_property_id);
  if v_photos = '{}' and v_description is null then
    raise exception 'Add a photo or a few words — otherwise there is nothing to go on';
  end if;
  if p_thing_id is not null and home.thing_property(p_thing_id) is distinct from p_property_id then
    raise exception 'That is not something at this place';
  end if;
  if p_project_id is not null and home.project_property(p_project_id) is distinct from p_property_id then
    raise exception 'That is not a project at this place';
  end if;
  if p_project_item_id is not null then
    v_item_project := home.item_project(p_project_item_id);
    if v_item_project is null then
      raise exception 'No such item';
    end if;
    if home.project_property(v_item_project) is distinct from p_property_id then
      raise exception 'That is not part of a job at this place';
    end if;
    -- A bound question always names the job it is about, so the snag still
    -- shows up on the project's own punch list.
    if p_project_id is not null and p_project_id is distinct from v_item_project then
      raise exception 'That item belongs to a different job';
    end if;
    p_project_id := coalesce(p_project_id, v_item_project);
  end if;
  if p_repeat_days is not null and p_repeat_days <= 0 then
    raise exception 'A cycle has to be a number of days';
  end if;
  if p_repeat_days is not null and p_due_at is null then
    raise exception 'A job that comes round needs a first date';
  end if;
  insert into home.snags (
    household_id, property_id, room, description, photo_paths, priority,
    thing_id, project_id, project_item_id, due_at, repeat_days, reporter_id, updated_by)
  values (
    v_household_id, p_property_id, nullif(btrim(coalesce(p_room, '')), ''),
    v_description, v_photos, p_priority,
    p_thing_id, p_project_id, p_project_item_id, p_due_at, p_repeat_days, auth.uid(), auth.uid())
  returning * into v_snag;
  return v_snag;
end;
$$;

-- 4. Answering one ----------------------------------------------------------
-- The tick can carry the answer. It can never invent it: there is deliberately
-- no path here that reads a figure out of an attachment — a scraped total has a
-- source nobody can check, and it will be wrong about GST, about provisional
-- sums, and about which of three revisions it read. A person types what they
-- read, and this puts it where it belongs.
--
-- It adds a quote through create_quote rather than inserting one, so there
-- stays one way to price something; and it finishes through set_snag_status
-- rather than touching status itself, so there stays one way to complete a
-- snag. `chosen` is never passed: choosing stays on set_quote_chosen, which is
-- its own function precisely so it cannot be smuggled in beside eight other
-- fields.

create or replace function home.answer_project_snag(
  p_snag_id uuid,
  p_amount numeric default null,
  p_amount_incl_gst boolean default true,
  p_kind home.project_quote_kind default 'invoice',
  p_supplier text default null,
  p_detail text default null,
  p_dated date default null,
  p_document_paths text[] default '{}'
) returns home.snags
language plpgsql security definer set search_path to '' as $$
declare
  v_snag home.snags;
  v_docs text[] := coalesce(p_document_paths, '{}');
begin
  select * into v_snag from home.snags where id = p_snag_id;
  if v_snag.id is null then raise exception 'No such snag'; end if;
  perform home.require_property_member(v_snag.property_id);

  if p_amount is not null then
    if v_snag.project_item_id is null then
      raise exception 'This question is not pointed at anything to price';
    end if;
    -- The paperwork rides on the quote it belongs to.
    perform home.create_quote(
      p_item_id          => v_snag.project_item_id,
      p_supplier         => p_supplier,
      p_detail           => p_detail,
      p_amount           => p_amount,
      p_amount_incl_gst  => coalesce(p_amount_incl_gst, true),
      p_kind             => coalesce(p_kind, 'invoice'),
      p_dated            => p_dated,
      p_document_paths   => v_docs);

  elsif v_docs <> '{}' then
    -- No figure, just paperwork: it lands at the level the question was bound
    -- to — the item if there is one, otherwise the job as a whole.
    if v_snag.project_item_id is not null then
      update home.project_items i
        set document_paths = i.document_paths || v_docs,
            updated_at = now()
      where i.id = v_snag.project_item_id;
    elsif v_snag.project_id is not null then
      update home.projects pj
        set document_paths = pj.document_paths || v_docs,
            updated_at = now(),
            updated_by = auth.uid()
      where pj.id = v_snag.project_id;
    else
      raise exception 'This question is not pointed at anywhere to file that';
    end if;
  end if;

  -- One way to finish a snag.
  return home.set_snag_status(p_snag_id, 'done');
end;
$$;

-- 5. Granted by name, never by sweep ----------------------------------------

grant execute on function home.answer_project_snag(
  uuid, numeric, boolean, home.project_quote_kind, text, text, date, text[]
) to authenticated;

grant execute on function home.create_snag(
  uuid, text, text, text[], home.snag_priority, uuid, timestamptz, integer, uuid, uuid
) to authenticated;

notify pgrst, 'reload schema';
