-- A label reading waits to be checked, rather than making somebody wait for it.
--
-- `read-label` takes five to forty seconds, and the walkthrough used to hold
-- the reading in the sheet's memory: press *Add it* before it landed, or lock
-- the phone, and the reading was gone. Recording a kitchen was a minute of
-- watching a spinner per appliance, which is the one thing a walk-round job
-- cannot afford.
--
-- So the function now finishes the read whatever the phone does
-- (`EdgeRuntime.waitUntil`) and puts what it found **here**. This table is a
-- waiting room, the same shape as `invoice_reviews`: a reading is a suggestion
-- about a record, never the record. Nothing in it reaches `home.things` until a
-- person presses *Use these* on the thing's own page, through `update_thing`
-- like every other edit — the rule the label reader was built on (*nothing it
-- says is saved unseen*) is unchanged, it just no longer requires somebody to
-- stand there while it happens.
--
-- **Keyed by the photograph, not by the thing.** The read starts the moment
-- the photo uploads, which is before the thing exists — the walkthrough only
-- writes on its last step. The photo's storage key is the one identifier both
-- ends already share, and a thing that carries it in `photo_paths` is the
-- thing the reading is about. A thing deleted, or a photo removed, simply
-- stops matching, so a reading about something that is gone is never shown.
--
-- **Per household**, like everything else this schema remembers about a
-- house: either person can use or dismiss it.
--
-- RLS on, a read policy for members, and no write policies: the functions
-- below are the only writers, as everywhere in `home`.

create table home.label_readings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references home.households(id) on delete cascade,
  photo_path text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'read', 'failed', 'used', 'dismissed')),
  -- What the model said, in the shape `readingFromGemini` returns. Null until
  -- it has said something.
  reading jsonb,
  -- Why a failed one failed, so the card can say it in words.
  reason text check (reason is null or reason in ('illegible', 'busy', 'quota', 'error')),
  created_by uuid references home.profiles(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  resolved_at timestamptz
);

create index on home.label_readings (household_id, status);

alter table home.label_readings enable row level security;

create policy "members read their label readings"
  on home.label_readings for select using (home.is_member(household_id));

grant select on home.label_readings to authenticated;

-- ------------------------------------------------------------------ the writes

/*
 * Opens (or re-opens, for a *Try again*) the reading for one photograph and
 * returns its id. Called by `read-label` after the day's read has been claimed,
 * so a household with no key set, or none left today, gets no row at all.
 *
 * The household is the photo's own folder — the storage layout every upload
 * in this app already uses — and the caller must be in it.
 */
create function home.begin_label_reading(p_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(coalesce(p_path, ''), '/', 1);
  v_id uuid;
begin
  if v_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     or position('/' in p_path) = 0 or p_path like '%/docs/%' then
    raise exception 'That is not a photo this app can read';
  end if;
  perform home.require_member(v_folder::uuid);

  insert into home.label_readings (household_id, photo_path, created_by)
  values (v_folder::uuid, p_path, auth.uid())
  on conflict (photo_path) do update
    set status = 'pending', reading = null, reason = null,
        created_at = now(), finished_at = null, resolved_at = null
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function home.begin_label_reading(text) from public, anon;
grant execute on function home.begin_label_reading(text) to authenticated;

/*
 * Records what the read came to. Only a pending reading can finish: one
 * already used or dismissed is somebody's decision, and a late answer must not
 * put a card back in front of them.
 */
create function home.finish_label_reading(
  p_id uuid,
  p_status text,
  p_reading jsonb default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  if p_status not in ('read', 'failed') then
    raise exception 'A reading finishes read or failed';
  end if;
  select household_id into v_household from home.label_readings where id = p_id;
  if v_household is null then
    raise exception 'No such reading';
  end if;
  perform home.require_member(v_household);

  update home.label_readings
     set status = p_status,
         reading = case when p_status = 'read' then p_reading else null end,
         reason = case when p_status = 'failed' then coalesce(p_reason, 'error') else null end,
         finished_at = now()
   where id = p_id and status = 'pending';
end;
$$;

revoke execute on function home.finish_label_reading(uuid, text, jsonb, text) from public, anon;
grant execute on function home.finish_label_reading(uuid, text, jsonb, text) to authenticated;

/*
 * A person's answer: `used` (they took what it said, in the walkthrough or on
 * the card) or `dismissed` (*Not right*). Either one ends the card. Neither
 * touches the thing — using a reading is an `update_thing` the client makes
 * first, like every other edit to a record.
 */
create function home.resolve_label_reading(p_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  if p_outcome not in ('used', 'dismissed') then
    raise exception 'A reading is used or dismissed';
  end if;
  select household_id into v_household from home.label_readings where id = p_id;
  if v_household is null then
    raise exception 'No such reading';
  end if;
  perform home.require_member(v_household);

  update home.label_readings
     set status = p_outcome, resolved_at = now()
   where id = p_id;
end;
$$;

revoke execute on function home.resolve_label_reading(uuid, text) from public, anon;
grant execute on function home.resolve_label_reading(uuid, text) to authenticated;

-- ------------------------------------------------------------------- the read

/*
 * Every reading at this place still waiting on somebody, with the thing it is
 * about. SECURITY INVOKER, so the read policies on both tables decide.
 *
 * A reading still `pending` three minutes on is reported as failed with
 * `error`: the function gives the model forty seconds and a busy retry, so one
 * that has not finished by then never will, and a card reading *still reading*
 * for ever is the worst answer.
 */
create function home.label_readings_to_check(p_property_id uuid)
returns table (
  id uuid,
  thing_id uuid,
  thing_name text,
  photo_path text,
  status text,
  reading jsonb,
  reason text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    lr.id,
    t.id,
    t.name,
    lr.photo_path,
    case when lr.status = 'pending' and lr.created_at < now() - interval '3 minutes'
         then 'failed' else lr.status end,
    lr.reading,
    case when lr.status = 'pending' and lr.created_at < now() - interval '3 minutes'
         then 'error' else lr.reason end,
    lr.created_at
  from home.label_readings lr
  join home.things t on lr.photo_path = any (t.photo_paths)
  where t.property_id = p_property_id
    and lr.status in ('pending', 'read', 'failed')
  order by lr.created_at;
$$;

revoke execute on function home.label_readings_to_check(uuid) from public, anon;
grant execute on function home.label_readings_to_check(uuid) to authenticated;
