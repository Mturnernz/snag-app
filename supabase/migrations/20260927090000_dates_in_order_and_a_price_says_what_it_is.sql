-- ============================================================================
-- A project cannot finish before it started, and a price's kind is changed by
-- a function that knows what the change does to the money.
-- ============================================================================
--
-- -------------------------------------------------------- dates in order
--
-- Nothing kept `started_on` and `finished_on` in order. The status sheet filled
-- an empty start with today whenever a project was marked Complete and never
-- looked at the finish, so a roof finished in June 2024 and recorded in
-- September 2026 was one tap from starting two years after it finished. The
-- client now moves whichever date was not just changed (`orderProjectDates`);
-- this is the floor under it.
--
-- A trigger rather than a restatement of `create_project` and `update_project`:
-- both write the row, and one guard before either reaches it says the same
-- thing in the same words whichever door was used. It raises in words because
-- a check constraint surfaces as its name, which means nothing to anybody —
-- and the constraint is added as well, underneath, so the invariant is a
-- property of the table rather than of a trigger somebody might one day drop.
--
-- Measured before this was written: no live project breaks it.
--
-- A name longer than the column allows is said in words here too. Renaming a
-- project from its title is new, and `projects_name_check` is the one other
-- constraint a person can now reach by typing.

create function home.projects_say_why()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.started_on is not null and new.finished_on is not null
     and new.finished_on < new.started_on then
    raise exception 'A project can''t finish before it started';
  end if;
  if length(btrim(new.name)) > 80 then
    raise exception 'Keep the name to 80 characters or fewer';
  end if;
  return new;
end;
$$;

revoke execute on function home.projects_say_why() from public, anon, authenticated;

create trigger projects_say_why
  before insert or update of started_on, finished_on, name on home.projects
  for each row execute function home.projects_say_why();

alter table home.projects
  add constraint projects_finish_after_start
  check (started_on is null or finished_on is null or finished_on >= started_on);

-- -------------------------------------------------------- a price's kind
--
-- `update_quote` has taken `p_kind` since the first migration and checked
-- nothing about it, so a bill with payments could be turned into a quote and
-- its payments would silently stop counting as Paid, and a contract with
-- progress claims against it could become a bill that claims were never
-- allowed to be against. Nothing in the app ever sent it, which is the only
-- reason neither happened.
--
-- Changing what a paper is moves money between Undecided, Agreed and Invoiced,
-- so it is its own function for the reason `set_quote_status` and
-- `set_item_excluded` are theirs: the only write here that changes what a total
-- says must not be reachable from a form carrying eight other fields. And it
-- refuses, in words that name the fix, every change that would leave a row the
-- rest of the schema says cannot exist:
--
--   to a quote — refused while it has payments (a quote cannot be paid), while
--   it is a claim against a contract or pays a stage of a schedule (only a bill
--   can), or while it sits inside another bill or holds bills inside it.
--
--   to an invoice — refused while claims are against it, it is broken into
--   lines or sets money aside for things still to be chosen, it has a payment
--   schedule, or it answers one of a builder's set-asides (only a quote can do
--   any of those).
--
-- Either way the status goes back to `tbc`. A bill that becomes a quote has not
-- been agreed to because it was once a bill, and it lands in Undecided with
-- *Have you agreed to go ahead?* waiting for the answer; a turned-down quote
-- that turns out to be a bill counts again, because a bill counts unless it is
-- declined. It also keeps `project_quotes_one_accepted` true without having to
-- clear a sibling. A quote carries no due date, so one becoming a quote loses
-- it; its number stays, since a quote has a number too.

create function home.set_quote_kind(p_quote_id uuid, p_kind home.project_quote_kind)
returns home.project_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote home.project_quotes;
  v_count integer;
begin
  select * into v_quote from home.project_quotes where id = p_quote_id;

  if v_quote.id is null then
    raise exception 'No such quote';
  end if;

  perform home.require_project_member(home.quote_project(p_quote_id));

  if p_kind is null or p_kind not in ('quote', 'invoice') then
    raise exception 'Say whether it''s a quote or an invoice';
  end if;

  if p_kind = v_quote.kind then
    return v_quote;
  end if;

  if p_kind = 'quote' then
    select count(*) into v_count from home.project_payments where quote_id = p_quote_id;
    if v_count > 0 then
      raise exception '% recorded against it, and a quote can''t be paid — remove %',
        case when v_count = 1 then 'A payment is' else v_count || ' payments are' end,
        case when v_count = 1 then 'it first' else 'them first' end;
    end if;
    if v_quote.against_quote_id is not null then
      raise exception 'It''s a progress bill against an agreed price, and only an invoice can be one';
    end if;
    if v_quote.settles_milestone_id is not null then
      raise exception 'It pays a stage of a payment schedule, and only an invoice can';
    end if;
    if v_quote.billed_through_id is not null and v_quote.supersedes_line_id is null then
      raise exception 'It''s inside another bill — take it out of that bill first';
    end if;
    select count(*) into v_count from home.project_quotes
     where billed_through_id = p_quote_id and kind = 'invoice' and supersedes_line_id is null;
    if v_count > 0 then
      raise exception '% inside it — take % out first',
        case when v_count = 1 then 'A bill is' else v_count || ' bills are' end,
        case when v_count = 1 then 'it' else 'them' end;
    end if;
  else
    select count(*) into v_count from home.project_quotes where against_quote_id = p_quote_id;
    if v_count > 0 then
      raise exception '% billed against it, and a bill can only be claimed against a quote',
        case when v_count = 1 then 'A progress bill is' else v_count || ' progress bills are' end;
    end if;
    if exists (select 1 from home.project_quote_lines where quote_id = p_quote_id and is_allowance) then
      raise exception 'It sets money aside for things you''ll choose, and only a quote can';
    end if;
    if exists (select 1 from home.project_quote_lines where quote_id = p_quote_id) then
      raise exception 'It''s broken down into lines, and only a quote can be — remove them first';
    end if;
    select count(*) into v_count from home.project_milestones where quote_id = p_quote_id;
    if v_count > 0 then
      raise exception 'It has a payment schedule, and only a quote can';
    end if;
    if v_quote.supersedes_line_id is not null then
      raise exception 'It''s the choice for one of a builder''s set-asides, and only a quote can be';
    end if;
  end if;

  update home.project_quotes set
    kind       = p_kind,
    status     = 'tbc',
    due_on     = case when p_kind = 'quote' then null else due_on end,
    updated_at = now()
  where id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$$;

revoke execute on function home.set_quote_kind(uuid, home.project_quote_kind) from public, anon;
grant execute on function home.set_quote_kind(uuid, home.project_quote_kind) to authenticated;

-- `update_quote` keeps its signature — the client names every argument, and a
-- positional gap is a different function — but it no longer changes the kind.
-- Passing one that differs is refused rather than ignored, so a caller that
-- tries finds out rather than believing it worked.

create or replace function home.update_quote(
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
  p_settles_milestone_id uuid default null,
  p_invoice_number text default null
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

  if p_kind is not null
     and p_kind is distinct from (select kind from home.project_quotes where id = p_quote_id) then
    raise exception 'Change whether it''s a quote or an invoice from its own pill';
  end if;

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
    invoice_number  = case when 'invoice_number' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_invoice_number, '')), ''), invoice_number) end,
    updated_at      = now()
  where id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$$;

notify pgrst, 'reload schema';
