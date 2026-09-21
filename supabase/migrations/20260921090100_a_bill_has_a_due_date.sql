-- A bill has a due date, and a contract has a schedule.
--
-- `project_quotes.dated` is the date **on** the paper. Nothing anywhere held the
-- date the money has to leave, which is the one fact about a bill that is about
-- *today* rather than about a position. Everything else on the project page is a
-- standing figure; "$43,987.50 to ReliaBuilder, due 20 October" is a task.
--
-- **And the builder's 25% at each milestone was unrepresentable.** The live job
-- carries it as free text — *"INV-0208 — claim 2, 25%"* — where nothing can read
-- it, so the app knows about the claim that has arrived and nothing about the
-- three that are coming. A householder who cannot see that $87,975 more is due
-- before Christmas is a householder who finds out in November.
--
-- Three rules keep this from becoming a second scheduler:
--
--   1. **A schedule is optional and absent by default.** A tile shop takes
--      payment and that is that. It is offered on a contract, never asked for.
--   2. **A milestone is not a bill.** It is what somebody said would be claimed.
--      The claim is the invoice that arrives, which `settles_milestone_id`
--      points back with — so the page can say "claim 2 of 4" and, more usefully,
--      "milestone 3 hasn't been claimed yet".
--   3. **Nothing sends anything.** Same rule as everywhere else in this product.
--      A due date is a fact on a row that the page sorts by and the Schedule tab
--      can draw; it is not a reminder, and it never speaks first.

alter table home.project_quotes
  -- When the money has to leave. On an invoice this is the payment term; on a
  -- quote it is usually null, though a quote that expires uses it too.
  add column due_on date,
  -- Who is actually billing us. Null — the ordinary case — means this supplier
  -- invoices the household direct. Set, it names the head contract this price is
  -- passed through, so the cabinetmaker's $12,000 is owed to the builder rather
  -- than to the cabinetmaker. The total is the same either way; *who is owed* is
  -- completely different, and the supplier rollup was silently wrong about it.
  add column billed_through_id uuid references home.project_quotes(id) on delete set null;

create index on home.project_quotes (due_on);
create index on home.project_quotes (billed_through_id);

-- ---------------------------------------------------------------- milestones

create table home.project_milestones (
  id uuid primary key default gen_random_uuid(),
  -- The commitment it breaks up — a contract or a fee agreement.
  quote_id uuid not null references home.project_quotes(id) on delete cascade,

  name text not null check (length(btrim(name)) between 1 and 120),
  -- A percentage of the commitment, or a flat amount. One or the other, never
  -- both: two ways to say the same number is two numbers that can disagree, and
  -- this one is multiplied by a six-figure contract.
  percent numeric(5, 2) check (percent is null or percent between 0 and 100),
  amount numeric(12, 2) check (amount is null or amount between 0 and 99999999),
  amount_incl_gst boolean not null default true,
  due_on date,
  sort_order int not null default 0,

  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_milestones_one_way check (
    (percent is not null) <> (amount is not null)
  )
);

create index on home.project_milestones (quote_id, sort_order);

alter table home.project_milestones enable row level security;

create policy "members read their milestones"
  on home.project_milestones for select using (
    exists (
      select 1 from home.project_quotes q
      where q.id = home.project_milestones.quote_id
    )
  );

grant select on home.project_milestones to authenticated;

alter table home.project_quotes
  add column settles_milestone_id uuid references home.project_milestones(id) on delete set null;

create index on home.project_quotes (settles_milestone_id);

create function home.milestone_project(p_milestone_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select home.quote_project(m.quote_id)
  from home.project_milestones m where m.id = p_milestone_id;
$$;

revoke execute on function home.milestone_project(uuid) from public, anon, authenticated;

create function home.add_milestone(
  p_quote_id uuid,
  p_name text,
  p_percent numeric default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default true,
  p_due_on date default null
)
returns home.project_milestones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row home.project_milestones;
  v_project uuid := home.quote_project(p_quote_id);
  v_next int;
begin
  if v_project is null then
    raise exception 'No such price';
  end if;

  perform home.require_project_member(v_project);

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Name the milestone — what has to happen for this to be claimed?';
  end if;

  -- Said in words rather than left to `project_milestones_one_way`, which would
  -- surface as a constraint name and mean nothing to anybody.
  if (p_percent is not null) = (p_amount is not null) then
    raise exception 'Give a percentage or an amount, not both';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next
  from home.project_milestones where quote_id = p_quote_id;

  insert into home.project_milestones (
    quote_id, name, percent, amount, amount_incl_gst, due_on, sort_order, created_by
  )
  values (
    p_quote_id, btrim(p_name), p_percent, p_amount,
    coalesce(p_amount_incl_gst, true), p_due_on, v_next, auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function home.add_milestone(uuid, text, numeric, numeric, boolean, date)
  to authenticated;

create function home.update_milestone(
  p_milestone_id uuid,
  p_name text default null,
  p_percent numeric default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default null,
  p_due_on date default null,
  p_clear text[] default '{}'
)
returns home.project_milestones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row home.project_milestones;
  v_clear text[] := coalesce(p_clear, '{}');
  v_project uuid := home.milestone_project(p_milestone_id);
begin
  if v_project is null then
    raise exception 'No such milestone';
  end if;

  perform home.require_project_member(v_project);

  -- Switching from a percentage to an amount means clearing the other, and the
  -- check constraint would otherwise refuse with a name nobody can act on.
  update home.project_milestones set
    name            = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    percent         = case when 'percent' = any(v_clear) then null
                           when p_amount is not null and p_percent is null then null
                           else coalesce(p_percent, percent) end,
    amount          = case when 'amount' = any(v_clear) then null
                           when p_percent is not null and p_amount is null then null
                           else coalesce(p_amount, amount) end,
    amount_incl_gst = coalesce(p_amount_incl_gst, amount_incl_gst),
    due_on          = case when 'due_on' = any(v_clear) then null
                           else coalesce(p_due_on, due_on) end,
    updated_at      = now()
  where id = p_milestone_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function home.update_milestone(uuid, text, numeric, numeric, boolean, date, text[])
  to authenticated;

create function home.delete_milestone(p_milestone_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := home.milestone_project(p_milestone_id);
begin
  if v_project is null then
    raise exception 'No such milestone';
  end if;

  perform home.require_project_member(v_project);

  delete from home.project_milestones where id = p_milestone_id;
end;
$$;

grant execute on function home.delete_milestone(uuid) to authenticated;

-- ---------------------------------------------------------------- the writes
--
-- Recreated rather than replaced, because the signature grows. Dropped by the
-- exact argument list, as `20260918090300` did.

drop function if exists home.create_quote(uuid, uuid, uuid, text, text, numeric, boolean, home.project_quote_kind, home.project_quote_status, home.project_quote_basis, date, text, uuid, text[], text[]);
drop function if exists home.update_quote(uuid, text, text, numeric, boolean, home.project_quote_kind, home.project_quote_basis, date, text, uuid, text[], text[], text[]);

create function home.create_quote(
  p_item_id uuid default null,
  p_element_id uuid default null,
  p_project_id uuid default null,
  p_supplier text default null,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default true,
  p_kind home.project_quote_kind default 'quote',
  p_status home.project_quote_status default 'tbc',
  p_basis home.project_quote_basis default 'fixed',
  p_dated date default null,
  p_notes text default null,
  p_supersedes_line_id uuid default null,
  p_photo_paths text[] default '{}',
  p_document_paths text[] default '{}',
  p_due_on date default null,
  p_billed_through_id uuid default null,
  p_settles_milestone_id uuid default null
)
returns home.project_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote home.project_quotes;
  v_project uuid;
  v_levels int := (p_item_id is not null)::int + (p_element_id is not null)::int
                + (p_project_id is not null)::int;
  v_kind home.project_quote_kind := coalesce(p_kind, 'quote');
  v_status home.project_quote_status := coalesce(p_status, 'tbc');
begin
  if v_levels <> 1 then
    raise exception 'Say what this price is for — one job, one part of it, or the whole thing';
  end if;

  v_project := coalesce(
    p_project_id,
    home.element_project(p_element_id),
    home.item_project(p_item_id)
  );

  if v_project is null then
    raise exception 'No such project';
  end if;

  perform home.require_project_member(v_project);

  if p_supersedes_line_id is not null then
    if v_kind <> 'quote' then
      raise exception 'Only a quote can answer an allowance';
    end if;
    if home.line_project(p_supersedes_line_id) is distinct from v_project then
      raise exception 'That line belongs to a different job';
    end if;
  end if;

  -- Across joins no foreign key can police: a head contract or a milestone from
  -- somebody else's renovation would put this money in two jobs at once.
  -- No self-reference check here: the row does not exist yet, so it cannot name
  -- itself. `update_quote` has one, where it can.
  if p_billed_through_id is not null
     and home.quote_project(p_billed_through_id) is distinct from v_project then
    raise exception 'That contract belongs to a different job';
  end if;

  if p_settles_milestone_id is not null then
    if v_kind <> 'invoice' then
      raise exception 'Only a bill can settle a milestone';
    end if;
    if home.milestone_project(p_settles_milestone_id) is distinct from v_project then
      raise exception 'That milestone belongs to a different job';
    end if;
  end if;

  if v_status = 'accepted' and v_kind = 'quote' and p_item_id is not null then
    update home.project_quotes set status = 'tbc', updated_at = now()
     where item_id = p_item_id and kind = 'quote' and status = 'accepted';
  end if;

  insert into home.project_quotes (
    item_id, element_id, project_id, supplier, detail, amount, amount_incl_gst,
    kind, status, basis, dated, notes, supersedes_line_id,
    photo_paths, document_paths, created_by,
    due_on, billed_through_id, settles_milestone_id
  )
  values (
    p_item_id, p_element_id, p_project_id,
    nullif(btrim(coalesce(p_supplier, '')), ''),
    nullif(btrim(coalesce(p_detail, '')), ''),
    p_amount, coalesce(p_amount_incl_gst, true),
    v_kind, v_status, coalesce(p_basis, 'fixed'), p_dated,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_supersedes_line_id,
    coalesce(p_photo_paths, '{}'), coalesce(p_document_paths, '{}'),
    auth.uid(),
    p_due_on, p_billed_through_id, p_settles_milestone_id
  )
  returning * into v_quote;

  return v_quote;
end;
$$;

grant execute on function home.create_quote(
  uuid, uuid, uuid, text, text, numeric, boolean, home.project_quote_kind,
  home.project_quote_status, home.project_quote_basis, date, text, uuid, text[], text[],
  date, uuid, uuid
) to authenticated;

create function home.update_quote(
  p_quote_id uuid,
  p_supplier text default null,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default null,
  p_kind home.project_quote_kind default null,
  p_basis home.project_quote_basis default null,
  p_dated date default null,
  p_notes text default null,
  p_supersedes_line_id uuid default null,
  p_photo_paths text[] default null,
  p_document_paths text[] default null,
  p_clear text[] default '{}',
  p_due_on date default null,
  p_billed_through_id uuid default null,
  p_settles_milestone_id uuid default null
)
returns home.project_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote home.project_quotes;
  v_clear text[] := coalesce(p_clear, '{}');
  v_project uuid := home.quote_project(p_quote_id);
begin
  if v_project is null then
    raise exception 'No such quote';
  end if;

  perform home.require_project_member(v_project);

  if p_supersedes_line_id is not null
     and home.line_project(p_supersedes_line_id) is distinct from v_project then
    raise exception 'That line belongs to a different job';
  end if;

  if p_billed_through_id is not null then
    if p_billed_through_id = p_quote_id then
      raise exception 'A price cannot be billed through itself';
    end if;
    if home.quote_project(p_billed_through_id) is distinct from v_project then
      raise exception 'That contract belongs to a different job';
    end if;
  end if;

  if p_settles_milestone_id is not null
     and home.milestone_project(p_settles_milestone_id) is distinct from v_project then
    raise exception 'That milestone belongs to a different job';
  end if;

  update home.project_quotes set
    supplier        = case when 'supplier' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_supplier, '')), ''), supplier) end,
    detail          = case when 'detail' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_detail, '')), ''), detail) end,
    amount          = case when 'amount' = any(v_clear) then null
                           else coalesce(p_amount, amount) end,
    amount_incl_gst = coalesce(p_amount_incl_gst, amount_incl_gst),
    kind            = coalesce(p_kind, kind),
    basis           = coalesce(p_basis, basis),
    dated           = case when 'dated' = any(v_clear) then null
                           else coalesce(p_dated, dated) end,
    notes           = case when 'notes' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes) end,
    supersedes_line_id = case when 'supersedes_line_id' = any(v_clear) then null
                           else coalesce(p_supersedes_line_id, supersedes_line_id) end,
    photo_paths     = coalesce(p_photo_paths, photo_paths),
    document_paths  = coalesce(p_document_paths, document_paths),
    due_on          = case when 'due_on' = any(v_clear) then null
                           else coalesce(p_due_on, due_on) end,
    billed_through_id = case when 'billed_through_id' = any(v_clear) then null
                           else coalesce(p_billed_through_id, billed_through_id) end,
    settles_milestone_id = case when 'settles_milestone_id' = any(v_clear) then null
                           else coalesce(p_settles_milestone_id, settles_milestone_id) end,
    updated_at      = now()
  where id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$$;

grant execute on function home.update_quote(
  uuid, text, text, numeric, boolean, home.project_quote_kind, home.project_quote_basis,
  date, text, uuid, text[], text[], text[], date, uuid, uuid
) to authenticated;

notify pgrst, 'reload schema';
