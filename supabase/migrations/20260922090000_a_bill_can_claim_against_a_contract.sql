-- A bill can say which contract it is claiming against.
--
-- ReliaBuilder quote $176,755 and then invoice it in four claims. Until now the
-- app had no way to say that a claim *draws down* a contract, so the person
-- recording it had two bad options and took both in turn: record the contract
-- as an invoice (then the page says the whole thing has been billed and *still
-- to be billed* reads $0), or record each claim as a **payment** against that
-- invoice (then the money is right and the bill is fiction). The live job has
-- one of each — $87,975 of payments against a $43,987.50 bill on one project,
-- and a $176,755 "invoice" carrying two payments on the other.
--
-- `against_quote_id` is the missing sentence: *this bill is claim 2 of that
-- contract.* It is the same idiom the schema already uses twice —
-- `settles_milestone_id` for a claim against a milestone, `supersedes_line_id`
-- for a price answering an allowance inside a quote.
--
-- ------------------------------------------------- summed from one place, still
--
-- A contract and its claims must not both reach Committed. Today that is
-- already true *when they sit on the same scope*, because
-- `coalesce(accepted_total, invoiced_total)` lets the accepted quote win and
-- drops the invoices. Put the contract on an item and a claim on the job and
-- both count: $176,755 + $43,987.50, with nothing on screen to say so.
--
-- **So the rule is enforced where the row is made rather than patched in five
-- views.** `create_quote` refuses a claim that does not sit exactly where its
-- contract sits. That makes the double-count *unrepresentable* — the same
-- discipline `add_payment` uses to refuse a payment against anything but an
-- invoice — and it means not one rollup expression has to change. The views
-- stay as they are, and they stay right.
--
-- Four more refusals, each naming a way a claim could lie:
--
--   * only a **bill** can be a claim; a quote claiming against a quote is a
--     variation, and that is a separate price.
--   * it can only claim against a **quote**; a bill against a bill is the
--     sibling-row shape `add_payment` already refuses.
--   * the contract has to be in **this job**.
--   * `on delete set null`, never cascade: deleting the contract must not take
--     the claims with it. The money still went out, and what it was against is
--     the part that has been lost, not the payment.
--
-- ---------------------------------------------------------------- mechanics
--
-- `create_quote` is **dropped and recreated** rather than replaced: a replace
-- with a different argument count leaves a second overload behind, and
-- PostgREST resolving a named-argument call against two candidates is an error
-- rather than a choice. The body is otherwise unchanged, and the grant is
-- re-issued because a drop takes it.
--
-- `project_quotes_with_totals` appends `against_quote_id` and `claimed_total`
-- — what has been claimed so far — so *Who we're paying* can say "$88,780 of
-- this contract still to claim" without a second read. It restates
-- `with (security_invoker = true)`, because a replace with no clause **resets**
-- the option rather than keeping it.

alter table home.project_quotes
  add column against_quote_id uuid references home.project_quotes(id) on delete set null;

create index on home.project_quotes (against_quote_id);

drop function home.create_quote(uuid, uuid, uuid, text, text, numeric, boolean,
  home.project_quote_kind, home.project_quote_status, home.project_quote_basis,
  date, text, uuid, text[], text[], date, uuid, uuid);

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
  p_settles_milestone_id uuid default null,
  p_against_quote_id uuid default null
)
returns home.project_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote home.project_quotes;
  v_against home.project_quotes;
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

  -- A claim against a contract. The scope check is the load-bearing one: it is
  -- what keeps the contract and its claims out of Committed twice, and it is
  -- cheaper and more durable than teaching five rollup views to subtract.
  if p_against_quote_id is not null then
    if v_kind <> 'invoice' then
      raise exception 'Only a bill can be a claim against a contract';
    end if;

    select * into v_against from home.project_quotes where id = p_against_quote_id;

    if v_against.id is null then
      raise exception 'No such contract';
    end if;
    if v_against.kind <> 'quote' then
      raise exception 'A claim has to be against a quote, not another bill';
    end if;
    if home.quote_project(p_against_quote_id) is distinct from v_project then
      raise exception 'That contract belongs to a different job';
    end if;
    if v_against.item_id is distinct from p_item_id
       or v_against.element_id is distinct from p_element_id
       or v_against.project_id is distinct from p_project_id then
      raise exception 'A claim has to sit where its contract sits';
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
    due_on, billed_through_id, settles_milestone_id, against_quote_id
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
    p_due_on, p_billed_through_id, p_settles_milestone_id, p_against_quote_id
  )
  returning * into v_quote;

  return v_quote;
end;
$$;

grant execute on function home.create_quote(
  uuid, uuid, uuid, text, text, numeric, boolean,
  home.project_quote_kind, home.project_quote_status, home.project_quote_basis,
  date, text, uuid, text[], text[], date, uuid, uuid, uuid
) to authenticated;

create or replace view home.project_quotes_with_totals
with (security_invoker = true)
as
select
  q.id,
  q.item_id,
  q.element_id,
  q.project_id,
  q.supersedes_line_id,
  q.billed_through_id,
  q.settles_milestone_id,
  q.supplier,
  q.detail,
  q.amount,
  q.amount_incl_gst,
  q.kind,
  q.status,
  q.basis,
  q.dated,
  q.due_on,
  q.notes,
  q.photo_paths,
  q.document_paths,
  q.created_by,
  q.created_at,
  q.updated_at,
  home.incl_gst(q.amount, q.amount_incl_gst) as amount_incl,
  lt.line_count,
  lt.lines_total,
  lt.build_up,
  lt.allowance_open,
  lt.additional_open,
  case
    when q.basis = 'fixed' or lt.build_up is null
      then home.incl_gst(q.amount, q.amount_incl_gst)
    else lt.build_up
  end
  - coalesce(lt.allowance_left, 0)
  + coalesce(lt.allowance_absorbed, 0)
  + coalesce(lt.attendance_total, 0)
  + coalesce(lt.additional_in, 0)                             as effective_amount,
  pay.paid_total,
  case when q.kind = 'invoice' and q.status <> 'declined'
       then greatest(
              coalesce(home.incl_gst(q.amount, q.amount_incl_gst), 0)
                - coalesce(pay.paid_total, 0), 0)
  end                                                         as unpaid,
  -- Was `home.quote_reach(q.id)`: a four-table join run once per row, against
  -- the one column the client filters on.
  q.reach_project_id,
  -- Whether the item this price belongs to has been excluded from the price
  -- build. False for anything not attached to an item.
  coalesce(pi.excluded, false)                                as item_excluded,
  -- Appended, because a replace can only append.
  q.against_quote_id,
  cl.claimed_total
from home.project_quotes q
left join home.project_items pi on pi.id = q.item_id
cross join lateral (
  select
    count(*)                                                   as line_count,
    sum(home.incl_gst(l.amount, l.amount_incl_gst))             as lines_total,
    sum(
      case when l.additional then null
           else coalesce(sup.amt, home.incl_gst(l.amount, l.amount_incl_gst)) end
    )                                                          as build_up,
    coalesce(sum(
      case when l.is_allowance and not l.additional and sup.amt is null
           then home.incl_gst(l.amount, l.amount_incl_gst) end
    ), 0)                                                      as allowance_open,
    coalesce(sum(
      case when l.is_allowance and l.additional and sup.amt is null
           then home.incl_gst(l.amount, l.amount_incl_gst) end
    ), 0)                                                      as additional_open,
    coalesce(sum(
      case when l.is_allowance and not l.additional
                and sup.amt is not null and sup.direct
           then coalesce(sup.allowed_in_build_up,
                         home.incl_gst(l.amount, l.amount_incl_gst)) end
    ), 0)                                                      as allowance_left,
    coalesce(sum(
      case when l.is_allowance and not l.additional
                and sup.amt is not null and not sup.direct and q.basis = 'fixed'
           then sup.amt - home.incl_gst(l.amount, l.amount_incl_gst) end
    ), 0)                                                      as allowance_absorbed,
    coalesce(sum(
      case when l.is_allowance and sup.amt is not null and sup.direct
                and l.attendance_pct is not null
           then round(sup.amt * l.attendance_pct / 100, 2) end
    ), 0)                                                      as attendance_total,
    coalesce(sum(
      case when l.additional and sup.amt is not null and not sup.direct
           then sup.amt end
    ), 0)                                                      as additional_in
  from home.project_quote_lines l
  left join lateral (
    select
      sum(home.incl_gst(s.amount, s.amount_incl_gst)) as amt,
      bool_and(s.billed_through_id is distinct from q.id) as direct,
      case when q.basis = 'fixed' then null
           else sum(home.incl_gst(s.amount, s.amount_incl_gst)) end
                                                      as allowed_in_build_up
    from home.project_quotes s
    where s.supersedes_line_id = l.id and s.status = 'accepted'
  ) sup on true
  where l.quote_id = q.id
) lt
cross join lateral (
  select sum(home.incl_gst(pm.amount, pm.amount_incl_gst)) as paid_total
  from home.project_payments pm where pm.quote_id = q.id
) pay
-- What has been claimed against this contract so far. Read off the table
-- rather than this view, which cannot reference itself — a claim is a plain
-- invoice with no build-up of its own, so its gross figure is its amount.
cross join lateral (
  select sum(home.incl_gst(c.amount, c.amount_incl_gst)) as claimed_total
  from home.project_quotes c
  where c.against_quote_id = q.id
    and c.kind = 'invoice' and c.status <> 'declined'
) cl;
notify pgrst, 'reload schema';
