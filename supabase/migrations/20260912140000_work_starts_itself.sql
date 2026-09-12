-- Effort goes, parts becomes a list, and a job starts itself.
--
-- **Nobody moves a job to "doing" by hand.** They didn't — the button sat
-- there being ignored while people commented on things and assigned them to
-- each other, and the list kept saying every one of them was untouched. Doing
-- something about a snag is the evidence that it has been started; asking for
-- a second, ceremonial declaration of it was asking for a lie.
--
-- So `add_comment` starts it, and so does `update_snag` — but only when a
-- *triage* field moves. Room, description and priority are the tail of
-- capture, not the head of the job: the amend row sets those seconds after the
-- photo, and marking a snag "doing" because somebody tagged it Bathroom would
-- make the status meaningless in the other direction.
--
-- Effort is gone entirely, with the Weekend tab it fed. "How long will it
-- take?" is a guess made before the job is understood, and it was the only
-- question in the app whose answer nobody could check.
--
-- Parts stops being a yes/no and becomes the list itself — the thing you'd
-- actually read standing in the aisle. `needs_parts` stays as the derived flag
-- the list filters on, so it can never disagree with the list it describes.

drop view home.snags_with_details;

-- The function signature names the enum, so it has to go before the type does.
drop function home.update_snag(
  uuid, text, text, home.snag_priority, home.snag_effort,
  boolean, timestamptz, integer, uuid, text[], text[]
);

alter table home.snags drop column effort;
drop type home.snag_effort;

alter table home.snags add column parts text[] not null default '{}';

create view home.snags_with_details
with (security_invoker = true)
as
select
  s.*,
  p.name                                        as property_name,
  reporter.display_name                         as reporter_name,
  assignee.display_name                         as assignee_name,
  (select count(*) from home.comments c where c.snag_id = s.id) as comment_count
from home.snags s
join home.properties p       on p.id = s.property_id
join home.profiles reporter  on reporter.id = s.reporter_id
left join home.profiles assignee on assignee.id = s.assignee_id;

grant select on home.snags_with_details to authenticated;

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

  -- Deciding to work on something is what starts it, and these are the fields
  -- that say so. Deliberately not room/description/priority.
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
    photo_paths  = coalesce(p_photo_paths, s.photo_paths),
    parts        = coalesce(p_parts, s.parts),
    -- Derived, never set by hand, so the flag and the list cannot disagree.
    needs_parts  = coalesce(p_parts, s.parts) <> '{}',
    status       = case when s.status = 'open' and v_started then 'doing' else s.status end,
    updated_at   = now(),
    updated_by   = auth.uid()
  where s.id = p_snag_id
  returning * into v_snag;

  if v_snag.id is null then
    raise exception 'No such snag';
  end if;

  return v_snag;
end;
$$;

grant execute on function home.update_snag(
  uuid, text, text, home.snag_priority, timestamptz, integer, uuid, text[], text[], text[]
) to authenticated;

-- A note about a job is somebody dealing with it.
create or replace function home.add_comment(p_snag_id uuid, p_body text)
returns home.comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment home.comments;
begin
  perform home.require_property_member(home.snag_property(p_snag_id));

  insert into home.comments (snag_id, author_id, body)
  values (p_snag_id, auth.uid(), btrim(p_body))
  returning * into v_comment;

  update home.snags set status = 'doing', updated_at = now(), updated_by = auth.uid()
  where id = p_snag_id and status = 'open';

  return v_comment;
end;
$$;
