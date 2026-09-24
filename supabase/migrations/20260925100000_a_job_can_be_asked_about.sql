-- A job can be asked about, and SnagHQ can answer it.
--
-- The assessment loop in 20260915140000 is deliberately outside the app: a
-- briefed PDF goes out, somebody answers it, the answer is pasted back in. This
-- is the same loop with a person at SnagHQ on the other end. A household asks a
-- question about one job, an employee reads that job in the portal on
-- www.snaghq.co.nz/staff, and the answer lands in `home.snag_advice` — the same
-- row, and the same card on the job's page, that a pasted assessment fills.
--
-- Four decisions are written into the shapes below, and each is the one to
-- hold on to.
--
-- **Staff see the job that was asked about, and nothing else in the house.**
-- There is no policy anywhere in this migration that lets a staff member read
-- `home.snags`, `home.comments` or any other household table. Everything the
-- portal shows comes through `staff_request_page`, which refuses unless the
-- request is open, and which returns that one snag, its notes, its linked
-- items and the place's suburb and town — never a street, never the rest of
-- the list. The photographs are the one read that cannot go through a
-- function, because Storage signs them; `staff_can_read_file` answers yes for
-- a file only while it belongs to a job with an open request.
--
-- **Access ends on its own.** A request is open while it waits on SnagHQ, and
-- for fourteen days after SnagHQ last replied — long enough for a follow-up,
-- not long enough for an employee to be able to read a household's job a year
-- after answering it. `support_is_open` is a date comparison rather than a
-- job, so nothing has to run for access to lapse. The household can end it
-- sooner by closing the request, and a new question re-opens nothing: it is a
-- new request.
--
-- **Staff never write to the job.** Not its status, its notes, its parts or its
-- dates. They write their own messages and the `snag_advice` row, and the
-- advice row has always been a suggestion — its parts are offers accepted one
-- tap at a time through `update_snag`, which is the human act that starts a
-- job (see 20260915140000's header). An answer from SnagHQ that marked a job
-- 'doing' would be SnagHQ deciding the household had started work.
--
-- **Every open is written down.** `support_access_log` records who opened,
-- claimed, noted, replied to and closed each request. The household sees the
-- first of those as *Seen by SnagHQ*; staff see all of it on the request.
--
-- The one email a reply sends is not in here: it is sent by the portal's
-- server action, after `staff_reply` returns, and `staff_mark_emailed` records
-- that it was accepted. A reply whose email failed is a reply that exists and
-- says it was not emailed, rather than one that claims to have been.
--
-- Grants are by name. The platform's default privileges hand new tables and
-- functions to anon and authenticated, so everything internal is revoked from
-- both explicitly, not merely from public.

-- ---------------------------------------------------------------- staff

-- Who works at SnagHQ. Inserted by the operator in SQL; there is deliberately
-- no screen that adds a row, because the one thing a staff list must not be is
-- something a signed-in caller can write to.
--
-- No foreign key to auth.users, for the reason `profiles` lost its own in
-- 20260915091000: a staff row is named on every message and log entry that
-- employee wrote, and a login going away must not take the record of who
-- answered with it. Somebody leaving is `active = false`.
create table home.staff (
  user_id uuid primary key,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  -- Stored lowered, and matched against the token's own email: a staff row is
  -- a statement about a particular Google Workspace account, not about an id
  -- somebody could arrive at another way.
  email text not null unique
    check (email = lower(btrim(email)) and email like '%@snaghq.co.nz'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table home.staff enable row level security;
revoke all on table home.staff from anon, authenticated;

-- True only for an active staff row whose email is the caller's, on an account
-- that signs in with Google. The provider check is the difference between
-- "somebody at snaghq.co.nz" and "somebody who once made an email-and-password
-- account with a snaghq.co.nz address": the portal is Google Workspace SSO, and
-- a staff account is one Google vouches for.
--
-- EXECUTE-able by `authenticated` because a storage policy calls it through
-- `staff_can_read_file`, and a policy expression runs as the calling role —
-- 20260911093000's lesson. It is also what the portal calls to decide whether
-- to show the queue or "this account isn't on the staff list".
create function home.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from home.staff st
    where st.user_id = auth.uid()
      and st.active
      and st.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google'
  );
$$;

revoke all on function home.is_staff() from public, anon;
grant execute on function home.is_staff() to authenticated;

create function home.require_staff()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not home.is_staff() then
    raise exception 'This is for SnagHQ staff' using errcode = '42501';
  end if;
end;
$$;

revoke all on function home.require_staff() from public, anon, authenticated;

-- ---------------------------------------------------------------- requests

create type home.support_status as enum ('waiting', 'replied', 'closed');

create table home.support_requests (
  id uuid primary key default gen_random_uuid(),
  snag_id uuid not null references home.snags(id) on delete cascade,
  -- Both carried, as `snag_advice` carries its household: the read policy asks
  -- the property, and the household delete cascade reaches the row without a
  -- join back through snags.
  household_id uuid not null references home.households(id) on delete cascade,
  property_id uuid not null references home.properties(id) on delete cascade,
  asked_by uuid not null references home.profiles(id),
  question text not null check (length(btrim(question)) between 1 and 2000),

  status home.support_status not null default 'waiting',
  assigned_to uuid references home.staff(user_id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- When the ball last landed in SnagHQ's court: the question, or the first
  -- follow-up after a reply. The queue sorts on it, oldest first, because a
  -- household that asked on Monday and followed up on Thursday has been
  -- waiting since Thursday, not since Monday.
  waiting_since timestamptz not null default now(),
  first_seen_at timestamptz,
  last_staff_reply_at timestamptz,

  closed_at timestamptz,
  -- 'expired' is a request that lapsed after fourteen days of nobody replying
  -- to SnagHQ, closed when the household next asks about the same job.
  closed_by text check (closed_by in ('customer', 'staff', 'expired')),
  close_reason text check (close_reason in ('resolved', 'no_reply', 'not_for_us', 'duplicate')),

  check ((status = 'closed') = (closed_at is not null)),
  check ((status = 'closed') = (closed_by is not null)),
  check (close_reason is null or closed_by = 'staff')
);

-- One open question per job. Two would be two threads about one photograph,
-- and an employee answering the older one while the household reads the newer.
create unique index support_requests_one_open_per_snag
  on home.support_requests (snag_id) where status <> 'closed';
create index on home.support_requests (status, waiting_since);
create index on home.support_requests (property_id);
create index on home.support_requests (assigned_to) where status <> 'closed';

alter table home.support_requests enable row level security;

-- Everybody on the place can see a question about a job on that place — the
-- same rule as the job itself. Staff read through functions, never this.
create policy "members read questions about their jobs"
  on home.support_requests for select
  using (home.is_property_member(property_id));

grant select on home.support_requests to authenticated;

-- Open is a status and a date. Stable, not immutable: it reads now().
create function home.support_is_open(
  p_status home.support_status,
  p_last_staff_reply_at timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status <> 'closed'
    and not (
      p_status = 'replied'
      and p_last_staff_reply_at is not null
      and p_last_staff_reply_at < now() - interval '14 days'
    );
$$;

revoke all on function home.support_is_open(home.support_status, timestamptz) from public, anon, authenticated;

-- Called only from inside SECURITY DEFINER functions, like `snag_property`.
create function home.staff_can_see_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select home.is_staff() and exists (
    select 1 from home.support_requests r
    where r.id = p_request_id
      and home.support_is_open(r.status, r.last_staff_reply_at)
  );
$$;

revoke all on function home.staff_can_see_request(uuid) from public, anon, authenticated;

create function home.require_staff_request(p_request_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform home.require_staff();
  if not home.staff_can_see_request(p_request_id) then
    raise exception 'That question has closed, so the job is no longer shared with SnagHQ';
  end if;
end;
$$;

revoke all on function home.require_staff_request(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- messages

create table home.support_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references home.support_requests(id) on delete cascade,
  staff_id uuid references home.staff(user_id),
  profile_id uuid references home.profiles(id),
  -- A snapshot, written by the function that inserts the row. A household
  -- cannot read `home.staff` and should not be able to, and a name that
  -- changes later should not rewrite who said what.
  author_name text not null check (length(btrim(author_name)) between 1 and 80),
  body text check (body is null or length(btrim(body)) between 1 and 4000),
  -- Staff-only. The household's policy below never returns one.
  internal boolean not null default false,
  -- This reply carried an assessment, now on the job's advice card.
  with_advice boolean not null default false,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),

  check ((staff_id is null) <> (profile_id is null)),
  check (not internal or staff_id is not null),
  check (not with_advice or (staff_id is not null and not internal)),
  check (body is not null or with_advice),
  check (emailed_at is null or (staff_id is not null and not internal))
);

create index on home.support_messages (request_id, created_at);

alter table home.support_messages enable row level security;

create policy "members read the replies to their questions"
  on home.support_messages for select using (
    not internal
    and exists (
      select 1 from home.support_requests r
      where r.id = home.support_messages.request_id
        and home.is_property_member(r.property_id)
    )
  );

grant select on home.support_messages to authenticated;

-- ---------------------------------------------------------------- the log

create table home.support_access_log (
  id bigint generated always as identity primary key,
  request_id uuid not null references home.support_requests(id) on delete cascade,
  staff_id uuid not null references home.staff(user_id),
  action text not null check (action in (
    'opened', 'claimed', 'assigned', 'released', 'noted', 'replied', 'emailed', 'closed'
  )),
  at timestamptz not null default now()
);

create index on home.support_access_log (request_id, at);

alter table home.support_access_log enable row level security;
revoke all on table home.support_access_log from anon, authenticated;

create function home.log_support(p_request_id uuid, p_action text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into home.support_access_log (request_id, staff_id, action)
  values (p_request_id, auth.uid(), p_action);
$$;

revoke all on function home.log_support(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- photographs

-- The one staff read that cannot go through a function: Storage signs the URL,
-- and asks `storage.objects`' policies whether the caller may. So this answers
-- yes for exactly the files on a job with an open request — the photographs
-- the household shared by asking — and for nothing else in their folder.
--
-- plpgsql so the staff check is guaranteed to run first: this sits on every
-- read of the bucket, customers' included, and for them it has to cost one
-- primary-key lookup and nothing more.
create function home.staff_can_read_file(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not home.is_staff() then
    return false;
  end if;
  return exists (
    select 1
    from home.support_requests r
    join home.snags s on s.id = r.snag_id
    where home.support_is_open(r.status, r.last_staff_reply_at)
      and p_object_name = any (s.photo_paths)
  );
end;
$$;

revoke all on function home.staff_can_read_file(text) from public, anon;
grant execute on function home.staff_can_read_file(text) to authenticated;

-- Select only. Staff never upload to, replace in or delete from a household's
-- folder; the four member policies from 20260911093000 are untouched.
create policy "snaghq staff read photos on jobs they were asked about"
  on storage.objects for select to authenticated
  using (bucket_id = 'home-photos' and home.staff_can_read_file(name));

-- ---------------------------------------------------------------- the advice row

-- An answer from SnagHQ is written by a staff member, who has no profile. So
-- the row carries one author or the other, never both and never neither.
alter table home.snag_advice alter column created_by drop not null;
alter table home.snag_advice add column staff_id uuid references home.staff(user_id);
alter table home.snag_advice add constraint snag_advice_one_author
  check ((created_by is null) <> (staff_id is null));

-- The paste path replaces the whole row, so it now has to clear `staff_id` on
-- the way past — or a household pasting their own assessment over SnagHQ's
-- would carry both authors and fail the check above. Same signature, same
-- grant; only the conflict clause changed.
create or replace function home.record_snag_advice(
  p_snag_id uuid,
  p_diagnosis text,
  p_verdict home.advice_verdict,
  p_source text,
  p_reason text default null,
  p_steps text[] default '{}',
  p_parts jsonb default '[]',
  p_trade text default null,
  p_tradies jsonb default '[]',
  p_need_to_see text default null
)
returns home.snag_advice
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_advice home.snag_advice;
  v_household uuid;
begin
  perform home.require_property_member(home.snag_property(p_snag_id));

  select household_id into v_household from home.snags where id = p_snag_id;

  insert into home.snag_advice (
    snag_id, household_id, diagnosis, verdict, reason, steps,
    need_to_see, parts, trade, tradies, source, created_by
  )
  values (
    p_snag_id, v_household, btrim(p_diagnosis), p_verdict,
    nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_steps, '{}'),
    nullif(btrim(coalesce(p_need_to_see, '')), ''), coalesce(p_parts, '[]'),
    nullif(btrim(coalesce(p_trade, '')), ''), coalesce(p_tradies, '[]'),
    btrim(p_source), auth.uid()
  )
  on conflict (snag_id) do update set
    diagnosis   = excluded.diagnosis,
    verdict     = excluded.verdict,
    reason      = excluded.reason,
    steps       = excluded.steps,
    need_to_see = excluded.need_to_see,
    parts       = excluded.parts,
    trade       = excluded.trade,
    tradies     = excluded.tradies,
    source      = excluded.source,
    created_by  = excluded.created_by,
    staff_id    = null,
    created_at  = now()
  returning * into v_advice;

  return v_advice;
end;
$$;

-- ---------------------------------------------------------------- the household's half

create function home.create_support_request(p_snag_id uuid, p_question text)
returns home.support_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snag home.snags;
  v_request home.support_requests;
  v_question text := btrim(coalesce(p_question, ''));
begin
  perform home.require_property_member(home.snag_property(p_snag_id));

  if v_question = '' then
    raise exception 'Say what you want to know';
  end if;
  if length(v_question) > 2000 then
    raise exception 'That question is too long — keep it under 2000 characters';
  end if;

  select * into v_snag from home.snags where id = p_snag_id;

  -- A request that lapsed is closed here rather than by a job, so the one-open
  -- index lets the new question in.
  update home.support_requests
  set status = 'closed', closed_at = now(), closed_by = 'expired', updated_at = now()
  where snag_id = p_snag_id
    and status <> 'closed'
    and not home.support_is_open(status, last_staff_reply_at);

  if exists (
    select 1 from home.support_requests
    where snag_id = p_snag_id and status <> 'closed'
  ) then
    raise exception 'SnagHQ already has a question about this job — add to that one';
  end if;

  insert into home.support_requests (
    snag_id, household_id, property_id, asked_by, question
  )
  values (
    p_snag_id, v_snag.household_id, v_snag.property_id, auth.uid(), v_question
  )
  returning * into v_request;

  return v_request;
end;
$$;

revoke all on function home.create_support_request(uuid, text) from public, anon;
grant execute on function home.create_support_request(uuid, text) to authenticated;

-- A follow-up puts the question back in SnagHQ's court. Refused once access
-- has lapsed: a new question is a new request, asked from the job, so the
-- household sees the sentence about what is shared again before sharing it.
create function home.add_support_message(p_request_id uuid, p_body text)
returns home.support_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request home.support_requests;
  v_message home.support_messages;
  v_body text := btrim(coalesce(p_body, ''));
  v_name text;
begin
  select * into v_request from home.support_requests where id = p_request_id;
  if v_request.id is null or not home.is_property_member(v_request.property_id) then
    raise exception 'You are not linked to that place';
  end if;
  if not home.support_is_open(v_request.status, v_request.last_staff_reply_at) then
    raise exception 'This question has closed — ask again from the job';
  end if;
  if v_body = '' then
    raise exception 'Write something to send';
  end if;
  if length(v_body) > 4000 then
    raise exception 'That is too long — keep it under 4000 characters';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), 'You')
    into v_name from home.profiles p where p.id = auth.uid();

  insert into home.support_messages (request_id, profile_id, author_name, body)
  values (p_request_id, auth.uid(), left(coalesce(v_name, 'You'), 80), v_body)
  returning * into v_message;

  update home.support_requests
  set status = 'waiting',
      waiting_since = case when status = 'waiting' then waiting_since else now() end,
      updated_at = now()
  where id = p_request_id;

  return v_message;
end;
$$;

revoke all on function home.add_support_message(uuid, text) from public, anon;
grant execute on function home.add_support_message(uuid, text) to authenticated;

-- Closing ends staff access immediately. Closing twice is a no-op rather than
-- an error: two people in one house can both press it.
create function home.close_support_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request home.support_requests;
begin
  select * into v_request from home.support_requests where id = p_request_id;
  if v_request.id is null or not home.is_property_member(v_request.property_id) then
    raise exception 'You are not linked to that place';
  end if;

  update home.support_requests
  set status = 'closed', closed_at = now(), closed_by = 'customer', updated_at = now()
  where id = p_request_id and status <> 'closed';
end;
$$;

revoke all on function home.close_support_request(uuid) from public, anon;
grant execute on function home.close_support_request(uuid) to authenticated;

-- ---------------------------------------------------------------- the staff half

-- The whole queue in one request — the pool is ten connections, and a portal
-- that fetched a thumbnail's worth of job per row would be the project page's
-- congestion collapse (see CLAUDE.md, *What a press costs*) one site over.
--
-- A closed or lapsed request carries its question, dates and reference and
-- nothing about the job: access has ended, and a queue that went on showing
-- the job's words and photograph would be access that hadn't.
create function home.staff_queue(p_tab text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_rows jsonb;
  v_counts jsonb;
begin
  perform home.require_staff();

  if p_tab not in ('unclaimed', 'mine', 'open', 'closed') then
    raise exception 'Unknown queue tab: %', p_tab;
  end if;

  with q as (
    select r.*,
           home.support_is_open(r.status, r.last_staff_reply_at) as is_open
    from home.support_requests r
  )
  select coalesce(jsonb_agg(row_json order by sort_open desc, sort_waiting, sort_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      -- Waiting on SnagHQ first, oldest wait first; then waiting on the
      -- household; closed newest first.
      (q.is_open and q.status = 'waiting') as sort_open,
      case when q.is_open then q.waiting_since end as sort_waiting,
      coalesce(q.closed_at, q.last_staff_reply_at, q.created_at) as sort_at,
      jsonb_build_object(
        'id', q.id,
        'status', q.status,
        'open', q.is_open,
        'question', q.question,
        'reference', s.reference,
        'created_at', q.created_at,
        'waiting_since', q.waiting_since,
        'first_seen_at', q.first_seen_at,
        'last_staff_reply_at', q.last_staff_reply_at,
        'closed_at', q.closed_at,
        'closed_by', case when q.status <> 'closed' and not q.is_open then 'expired' else q.closed_by end,
        'close_reason', q.close_reason,
        'assigned_to', q.assigned_to,
        'assigned_name', st.display_name,
        'job', case when q.is_open then jsonb_build_object(
          'description', s.description,
          'room', s.room,
          'photo_path', s.photo_paths[1],
          'photo_count', coalesce(array_length(s.photo_paths, 1), 0),
          'suburb', p.suburb,
          'town', p.town
        ) end
      ) as row_json
    from q
    join home.snags s on s.id = q.snag_id
    join home.properties p on p.id = q.property_id
    left join home.staff st on st.user_id = q.assigned_to
    where case p_tab
      when 'unclaimed' then q.is_open and q.assigned_to is null
      when 'mine'      then q.is_open and q.assigned_to = v_me
      when 'open'      then q.is_open
      when 'closed'    then not q.is_open
        and coalesce(q.closed_at, q.last_staff_reply_at + interval '14 days') > now() - interval '30 days'
    end
  ) x;

  with q as (
    select r.*, home.support_is_open(r.status, r.last_staff_reply_at) as is_open
    from home.support_requests r
  )
  select jsonb_build_object(
    'unclaimed', count(*) filter (where is_open and assigned_to is null),
    'mine', count(*) filter (where is_open and assigned_to = v_me),
    'open', count(*) filter (where is_open),
    'waiting', count(*) filter (where is_open and status = 'waiting'),
    'oldest_waiting_since', min(waiting_since) filter (where is_open and status = 'waiting')
  )
  into v_counts
  from q;

  return jsonb_build_object(
    'rows', v_rows,
    'counts', v_counts,
    'me', (select jsonb_build_object('user_id', st.user_id, 'display_name', st.display_name)
           from home.staff st where st.user_id = v_me)
  );
end;
$$;

revoke all on function home.staff_queue(text) from public, anon;
grant execute on function home.staff_queue(text) to authenticated;

-- One request, and everything the job page shows — the snag, its notes, what
-- it is linked to, the advice already on it, the thread, the log and who can
-- be assigned. Opening it is logged, at most once per half hour per person:
-- the page re-reads after every action, and a log that said "opened" forty
-- times in an afternoon would bury the entries that mean something.
create function home.staff_request_page(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request home.support_requests;
  v_result jsonb;
begin
  perform home.require_staff_request(p_request_id);

  select * into v_request from home.support_requests where id = p_request_id;

  if not exists (
    select 1 from home.support_access_log l
    where l.request_id = p_request_id
      and l.staff_id = auth.uid()
      and l.action = 'opened'
      and l.at > now() - interval '30 minutes'
  ) then
    perform home.log_support(p_request_id, 'opened');
  end if;

  update home.support_requests
  set first_seen_at = now()
  where id = p_request_id and first_seen_at is null
  returning * into v_request;

  if v_request.id is null then
    select * into v_request from home.support_requests where id = p_request_id;
  end if;

  select jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_request.id,
      'snag_id', v_request.snag_id,
      'status', v_request.status,
      'question', v_request.question,
      'created_at', v_request.created_at,
      'waiting_since', v_request.waiting_since,
      'first_seen_at', v_request.first_seen_at,
      'last_staff_reply_at', v_request.last_staff_reply_at,
      'assigned_to', v_request.assigned_to,
      'asked_by_name', (select pr.display_name from home.profiles pr where pr.id = v_request.asked_by)
    ),
    'job', (
      select jsonb_build_object(
        'id', s.id,
        'reference', s.reference,
        'description', s.description,
        'room', s.room,
        'photo_paths', to_jsonb(s.photo_paths),
        'status', s.status,
        'parts', to_jsonb(s.parts),
        'bought', to_jsonb(s.bought),
        'due_at', s.due_at,
        'repeat_days', s.repeat_days,
        'created_at', s.created_at,
        'done_at', s.done_at,
        'last_done_at', s.last_done_at,
        'reporter_name', s.reporter_name,
        'property_name', s.property_name,
        'linked_things', s.linked_things
      )
      from home.snags_with_details s
      where s.id = v_request.snag_id
    ),
    'place', (
      select jsonb_build_object('name', p.name, 'suburb', p.suburb, 'town', p.town)
      from home.properties p where p.id = v_request.property_id
    ),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'body', c.body,
        'created_at', c.created_at,
        'author_name', pr.display_name
      ) order by c.created_at)
      from home.comments c
      left join home.profiles pr on pr.id = c.author_id
      where c.snag_id = v_request.snag_id
    ), '[]'::jsonb),
    'advice', (
      select to_jsonb(a) - 'household_id' - 'created_by'
      from home.snag_advice a where a.snag_id = v_request.snag_id
    ),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'from_staff', m.staff_id is not null,
        'author_name', m.author_name,
        'body', m.body,
        'internal', m.internal,
        'with_advice', m.with_advice,
        'emailed_at', m.emailed_at,
        'created_at', m.created_at
      ) order by m.created_at)
      from home.support_messages m
      where m.request_id = p_request_id
    ), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object(
        'action', l.action,
        'at', l.at,
        'staff_name', st.display_name
      ) order by l.at desc)
      from home.support_access_log l
      join home.staff st on st.user_id = l.staff_id
      where l.request_id = p_request_id
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', st.user_id, 'display_name', st.display_name)
                       order by st.display_name)
      from home.staff st where st.active
    ), '[]'::jsonb),
    'me', auth.uid()
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function home.staff_request_page(uuid) from public, anon;
grant execute on function home.staff_request_page(uuid) to authenticated;

-- Claim (yourself), assign (a colleague) or release (null).
create function home.staff_assign(p_request_id uuid, p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_staff_request(p_request_id);

  if p_staff_id is not null and not exists (
    select 1 from home.staff where user_id = p_staff_id and active
  ) then
    raise exception 'That person is not on the SnagHQ staff list';
  end if;

  update home.support_requests
  set assigned_to = p_staff_id, updated_at = now()
  where id = p_request_id;

  perform home.log_support(
    p_request_id,
    case
      when p_staff_id is null then 'released'
      when p_staff_id = auth.uid() then 'claimed'
      else 'assigned'
    end
  );
end;
$$;

revoke all on function home.staff_assign(uuid, uuid) from public, anon;
grant execute on function home.staff_assign(uuid, uuid) to authenticated;

create function home.staff_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select st.display_name from home.staff st where st.user_id = auth.uid();
$$;

revoke all on function home.staff_name() from public, anon, authenticated;

create function home.staff_add_note(p_request_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  perform home.require_staff_request(p_request_id);
  if v_body = '' then
    raise exception 'Write something to note';
  end if;
  if length(v_body) > 4000 then
    raise exception 'That note is too long — keep it under 4000 characters';
  end if;

  insert into home.support_messages (request_id, staff_id, author_name, body, internal)
  values (p_request_id, auth.uid(), home.staff_name(), v_body, true)
  returning id into v_id;

  perform home.log_support(p_request_id, 'noted');
  return v_id;
end;
$$;

revoke all on function home.staff_add_note(uuid, text) from public, anon;
grant execute on function home.staff_add_note(uuid, text) to authenticated;

-- A reply, with or without an assessment. The assessment is `snag_advice`'s
-- own shape, camelCase inside the jsonb exactly as the paste path writes it,
-- so the job's advice card reads both without knowing which it is holding.
--
-- **A tradesman without a source is refused**, not dropped: `parseTradies`
-- drops one silently because a pasted answer is a stranger's, but this one is
-- being typed by an employee who can fix it — and the rule that a name nobody
-- can follow must never reach a household is the same rule either way.
--
-- Replying claims the request for whoever replied if nobody had it, since the
-- person who answered is who the follow-up belongs to.
create function home.staff_reply(p_request_id uuid, p_body text, p_advice jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request home.support_requests;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_diagnosis text;
  v_verdict home.advice_verdict;
  v_tradie jsonb;
  v_part jsonb;
  v_steps text[];
  v_id uuid;
begin
  perform home.require_staff_request(p_request_id);
  select * into v_request from home.support_requests where id = p_request_id;

  if v_body is null and p_advice is null then
    raise exception 'Write a reply or an assessment';
  end if;
  if v_body is not null and length(v_body) > 4000 then
    raise exception 'That reply is too long — keep it under 4000 characters';
  end if;

  if p_advice is not null then
    v_diagnosis := btrim(coalesce(p_advice ->> 'diagnosis', ''));
    if v_diagnosis = '' then
      raise exception 'Say what you think is wrong';
    end if;
    if length(v_diagnosis) > 600 then
      raise exception 'Keep what is wrong under 600 characters';
    end if;
    if coalesce(p_advice ->> 'verdict', '') not in ('diy', 'trade', 'unclear') then
      raise exception 'Say whether they can do it themselves';
    end if;
    v_verdict := (p_advice ->> 'verdict')::home.advice_verdict;

    if jsonb_typeof(coalesce(p_advice -> 'parts', '[]')) <> 'array'
       or jsonb_typeof(coalesce(p_advice -> 'tradies', '[]')) <> 'array'
       or jsonb_typeof(coalesce(p_advice -> 'steps', '[]')) <> 'array' then
      raise exception 'That assessment is not in the right shape';
    end if;

    for v_part in select * from jsonb_array_elements(coalesce(p_advice -> 'parts', '[]')) loop
      if btrim(coalesce(v_part ->> 'item', '')) = '' then
        raise exception 'Every part needs to say what it is';
      end if;
    end loop;

    for v_tradie in select * from jsonb_array_elements(coalesce(p_advice -> 'tradies', '[]')) loop
      if btrim(coalesce(v_tradie ->> 'name', '')) = '' then
        raise exception 'Every tradesman needs a name';
      end if;
      if btrim(coalesce(v_tradie ->> 'source', '')) = '' then
        raise exception 'Say where you found %', btrim(v_tradie ->> 'name');
      end if;
    end loop;

    select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}')
      into v_steps
      from jsonb_array_elements_text(coalesce(p_advice -> 'steps', '[]')) x;

    insert into home.snag_advice (
      snag_id, household_id, diagnosis, verdict, reason, steps,
      need_to_see, parts, trade, tradies, source, staff_id
    )
    values (
      v_request.snag_id, v_request.household_id, v_diagnosis, v_verdict,
      left(nullif(btrim(coalesce(p_advice ->> 'reason', '')), ''), 400),
      v_steps,
      left(nullif(btrim(coalesce(p_advice ->> 'needToSee', '')), ''), 300),
      coalesce(p_advice -> 'parts', '[]'),
      left(nullif(btrim(coalesce(p_advice ->> 'trade', '')), ''), 40),
      coalesce(p_advice -> 'tradies', '[]'),
      'SnagHQ · ' || to_char(now() at time zone 'Pacific/Auckland', 'FMDD Mon'),
      auth.uid()
    )
    on conflict (snag_id) do update set
      diagnosis   = excluded.diagnosis,
      verdict     = excluded.verdict,
      reason      = excluded.reason,
      steps       = excluded.steps,
      need_to_see = excluded.need_to_see,
      parts       = excluded.parts,
      trade       = excluded.trade,
      tradies     = excluded.tradies,
      source      = excluded.source,
      created_by  = null,
      staff_id    = excluded.staff_id,
      created_at  = now();
  end if;

  insert into home.support_messages (request_id, staff_id, author_name, body, with_advice)
  values (p_request_id, auth.uid(), home.staff_name(), v_body, p_advice is not null)
  returning id into v_id;

  update home.support_requests
  set status = 'replied',
      last_staff_reply_at = now(),
      assigned_to = coalesce(assigned_to, auth.uid()),
      updated_at = now()
  where id = p_request_id;

  perform home.log_support(p_request_id, 'replied');
  return v_id;
end;
$$;

revoke all on function home.staff_reply(uuid, text, jsonb) from public, anon;
grant execute on function home.staff_reply(uuid, text, jsonb) to authenticated;

-- Where the one email goes, and what it can say. Only the portal's server
-- action calls this, and the address is never drawn on a screen: an employee
-- answering a question about a tap has no need to know who asked beyond a
-- first name.
create function home.staff_reply_email_target(p_request_id uuid)
returns table (
  email text,
  snag_id uuid,
  reference text,
  description text,
  room text,
  asked_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform home.require_staff_request(p_request_id);

  return query
  select u.email::text, s.id, s.reference, s.description, s.room, pr.display_name
  from home.support_requests r
  join home.snags s on s.id = r.snag_id
  join home.profiles pr on pr.id = r.asked_by
  join auth.users u on u.id = r.asked_by
  where r.id = p_request_id
    and pr.deleted_at is null;
end;
$$;

revoke all on function home.staff_reply_email_target(uuid) from public, anon;
grant execute on function home.staff_reply_email_target(uuid) to authenticated;

create function home.staff_mark_emailed(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  select m.request_id into v_request_id
  from home.support_messages m
  where m.id = p_message_id and m.staff_id is not null and not m.internal;

  if v_request_id is null then
    raise exception 'That is not a reply that can be emailed';
  end if;

  perform home.require_staff_request(v_request_id);

  update home.support_messages set emailed_at = now() where id = p_message_id;
  perform home.log_support(v_request_id, 'emailed');
end;
$$;

revoke all on function home.staff_mark_emailed(uuid) from public, anon;
grant execute on function home.staff_mark_emailed(uuid) to authenticated;

create function home.staff_close_request(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_staff_request(p_request_id);

  if coalesce(p_reason, '') not in ('resolved', 'no_reply', 'not_for_us', 'duplicate') then
    raise exception 'Say why it is being closed';
  end if;

  update home.support_requests
  set status = 'closed', closed_at = now(), closed_by = 'staff',
      close_reason = p_reason, updated_at = now()
  where id = p_request_id;

  perform home.log_support(p_request_id, 'closed');
end;
$$;

revoke all on function home.staff_close_request(uuid, text) from public, anon;
grant execute on function home.staff_close_request(uuid, text) to authenticated;
