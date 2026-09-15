-- A list can be briefed, and the answer can come back.
--
-- The PDF extract is already the copy that goes to somebody who was not there.
-- This adds the other half of that journey: the file can carry the question as
-- well as the evidence, and what comes back lands against the jobs it was asked
-- about rather than being read once and retyped.
--
-- Nothing here calls anything. There is no key, no queue and no edge function:
-- a briefed PDF goes out of the app, an answer is pasted back in, and this
-- migration is the two columns that make the question answerable and the one
-- table that holds the reply.
--
-- Three decisions are written into the shapes below.
--
-- **A place says its suburb and its town, and not its street.** The only
-- question the location answers is "near here", for finding a tradesman in the
-- right part of the country — and it rides out of the app in every briefed
-- extract, which is a file that gets forwarded. A street number would add
-- precision nobody needs and hand it to everybody who receives the PDF.
--
-- **One row of advice per snag, replaced rather than stacked.** Re-assessing a
-- job supersedes the last answer; the PDF is the history, and a second answer
-- from a month later is not a thing anybody wants to compare — they want the
-- current one. `on conflict` therefore overwrites, and `created_at` moves with
-- it so the source line under the advice is never older than the advice.
--
-- **Recording advice does not touch the snag.** This is the one to hold on to.
-- `home.update_snag` moves a snag to 'doing' the moment parts, a due date, an
-- assignee or a repeat changes (20260912140000), and an assessment answers all
-- of those at once. Writing them through that function would mark every open
-- job in the house as being worked on the moment a reply was pasted — the
-- retired *Start it* failure, at twelve times the scale, and from the other
-- direction. So advice is a suggestion until somebody accepts it: the parts it
-- proposes go onto the shopping list one tap at a time, through `update_snag`,
-- where the tap is the human act that starts the job. Nothing in this migration
-- writes to home.snags at all.

-- ---------------------------------------------------------------- where it is

alter table home.properties add column suburb text
  check (suburb is null or length(btrim(suburb)) between 1 and 80);
alter table home.properties add column town text
  check (town is null or length(btrim(town)) between 1 and 80);

-- Empty in, null out: a place entered wrongly has to be un-enterable without
-- deleting the property, and '' is what a cleared text field sends.
create function home.set_property_location(
  p_property_id uuid,
  p_suburb text,
  p_town text
)
returns home.properties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property home.properties;
begin
  if not home.is_property_member(p_property_id) then
    raise exception 'You are not linked to that place';
  end if;

  update home.properties
  set suburb = nullif(btrim(p_suburb), ''),
      town   = nullif(btrim(p_town), '')
  where id = p_property_id
  returning * into v_property;

  return v_property;
end;
$$;

grant execute on function home.set_property_location(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- the answer

-- `unclear` is a first-class answer rather than a failure: a photograph of a
-- damp patch cannot say what the pipe behind the wall is doing, and an
-- assessment that guesses confidently is worse than one that says what it would
-- need to see.
create type home.advice_verdict as enum ('diy', 'trade', 'unclear');

create table home.snag_advice (
  snag_id uuid primary key references home.snags(id) on delete cascade,
  -- Carried so the storage-style membership checks and the household delete
  -- cascade both reach it without a join back through snags.
  household_id uuid not null references home.households(id) on delete cascade,

  diagnosis text not null check (length(btrim(diagnosis)) between 1 and 600),
  verdict home.advice_verdict not null,
  reason text check (reason is null or length(reason) <= 400),
  steps text[] not null default '{}',
  need_to_see text check (need_to_see is null or length(need_to_see) <= 300),

  -- jsonb for the same reason `things.spec` is: the small tail of a record, not
  -- its body. A part is an item, a shop and a price as *text*; a tradesman is a
  -- name, a number, a link, the page it was found on and two costs. Neither is
  -- read by anything but the screen that shows it, and neither is ever filtered
  -- or aggregated — so five columns and a child table each would buy nothing
  -- and cost two more places to get the property check wrong.
  --
  -- **Money stays text.** "180-260" is quoted back exactly as it arrived with
  -- the date beside it, because parsing it into a number would be the app
  -- asserting a precision the answer never had.
  parts jsonb not null default '[]' check (jsonb_typeof(parts) = 'array'),
  trade text check (trade is null or length(btrim(trade)) between 1 and 40),
  tradies jsonb not null default '[]' check (jsonb_typeof(tradies) = 'array'),

  -- Where it came from, in words, because nothing in this schema can check it:
  -- "Pasted 15 Sep". Rendered beside the advice for the same reason the
  -- invitation card says Snag doesn't email anybody — a claim the screen cannot
  -- verify has to read as a claim.
  source text not null check (length(btrim(source)) between 1 and 120),
  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now()
);

create index on home.snag_advice (household_id);

alter table home.snag_advice enable row level security;

-- The same shape as the comments policy, and deliberately not through
-- `home.snag_property`: that helper is only ever called from inside SECURITY
-- DEFINER functions and stays revoked from `authenticated`, and a policy
-- expression is evaluated as the *calling* role. Using it here would raise
-- `42501 permission denied for function snag_property` on every read rather
-- than returning no rows — which is the failure 20260911093000 exists for.
create policy "members read advice on their snags"
  on home.snag_advice for select using (
    exists (
      select 1 from home.snags s
      where s.id = home.snag_advice.snag_id
        and home.is_property_member(s.property_id)
    )
  );

grant select on home.snag_advice to authenticated;

create function home.record_snag_advice(
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
    created_at  = now()
  returning * into v_advice;

  return v_advice;
end;
$$;

grant execute on function home.record_snag_advice(
  uuid, text, home.advice_verdict, text, text, text[], jsonb, text, jsonb, text
) to authenticated;

-- Taking it off again. A wrong answer has to be removable without deleting the
-- job it is wrong about, and there is no other way back: the row is a primary
-- key on the snag, so a second paste replaces it and nothing else touches it.
create function home.delete_snag_advice(p_snag_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_property_member(home.snag_property(p_snag_id));
  delete from home.snag_advice where snag_id = p_snag_id;
end;
$$;

grant execute on function home.delete_snag_advice(uuid) to authenticated;
