-- Reading a label costs money, so a household gets a day's worth.
--
-- `read-label` sends a photograph to a model on the operator's API key. Nothing
-- but a session stood between that key and anybody holding one: a loop on the
-- web build, or one account signed in somewhere it should not be, is a bill
-- with no ceiling. A walkthrough reads one plate per thing recorded, and a
-- household recording its whole kitchen on a Saturday reads perhaps twenty —
-- so fifty a day is generous to a person and a hard stop to a loop.
--
-- **Counted per household, not per person**, like everything this schema
-- remembers about a house: two people recording the same garage share one
-- allowance, and a second account is not a way round it.
--
-- **The function claims a read before the model is called, and never
-- refunds one.** A refund on failure is a second write that can itself fail,
-- and a read that errored at the model still cost a request. Simpler to count
-- the attempt.
--
-- The table has RLS on and no policies at all: nothing reads it but this
-- function, which is SECURITY DEFINER. It is not a record anybody browses.

create table if not exists home.label_reads (
  household_id uuid not null references home.households(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (household_id, day)
);

alter table home.label_reads enable row level security;
-- Named, because the platform's default privileges grant new tables to both.
revoke all on table home.label_reads from anon, authenticated;

/*
 * Claims one read for this household today. True if it was within the day's
 * allowance, false if the allowance is spent.
 *
 * False rather than a raise, so the caller can word "used up for today"
 * differently from "you are not in this household" — the second is still a
 * raise, through `require_member`, because that one is not a limit, it is a
 * refusal.
 *
 * `current_date` is the server's, which is UTC: the allowance turns over at
 * noon or one in the afternoon in New Zealand. That is fine for a cost
 * ceiling — nobody is counting — and a timezone argument here would be one a
 * caller could choose.
 */
create or replace function home.claim_label_read(p_household_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform home.require_member(p_household_id);

  insert into home.label_reads as lr (household_id, day, count)
  values (p_household_id, current_date, 1)
  on conflict (household_id, day) do update set count = lr.count + 1
  returning lr.count into v_count;

  return v_count <= 50;
end;
$$;

revoke all on function home.claim_label_read(uuid) from public, anon;
grant execute on function home.claim_label_read(uuid) to authenticated;
