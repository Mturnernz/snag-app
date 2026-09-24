-- A bill knows its invoice number, so the same bill can be spotted twice.
--
-- The invoice number had nowhere to live on a bill. An emailed bill carried it
-- on its review card, and allocating the card copied it into `notes` — free
-- text, where nothing could compare it. A bill typed in through the money
-- sheet folded it into `detail` ("INV-0208 — Claim 2"). So the one field that
-- tells two bills from one supplier apart was the one field nothing read.
--
-- And the same bill did get in twice. The live review table holds INV-15879
-- and 25.010 twice each and 81914 three times: the same bill forwarded again,
-- allocated again, and then found by eye and deleted. Nothing on screen could
-- have said so, because nothing had the number to say it with.
--
-- ------------------------------------------------------------------ the rule
--
-- **A duplicate is warned about, never refused.** The check is the client's,
-- over the page it already holds (`findDuplicateBill`), because the answer is a
-- judgement a person makes with the paper in front of them. Two bills from one
-- supplier for the same amount are usually two progress claims — ReliaBuilder's
-- deposit and claim 2 are both $43,987.50 — and a server that refused the
-- second would be wrong exactly where the money is largest. So there is no
-- unique index here, deliberately: this migration only gives the number a
-- column.
--
-- ------------------------------------------------------------------- the move
--
-- Backfilled from the review cards that were allocated, the only place the
-- number was ever held as a number. Where allocating had copied it into
-- `notes`, `notes` is cleared: it is the same answer moving to its own column,
-- not a second one being dropped. A number folded into `detail` by hand is left
-- where it is — splitting "INV-0208 — Claim 2" on a dash is a guess, and
-- `findDuplicateBill` reads a number out of `detail` as a fallback instead.
--
-- ---------------------------------------------------------------- mechanics
--
-- `create_quote` and `update_quote` are **dropped and recreated**, not
-- replaced: a replace with one more argument leaves the old overload behind,
-- and PostgREST resolving a named-argument call between two candidates is an
-- error. Grants are re-issued because a drop takes them. The bodies are
-- otherwise unchanged.
--
-- `approve_invoice_review` passes the number as a number now, not as a note.
--
-- `project_quotes_with_totals` appends `invoice_number` and restates
-- `with (security_invoker = true)` — a replace with no clause resets it.

alter table home.project_quotes add column invoice_number text;

update home.project_quotes q
   set invoice_number = btrim(r.invoice_number),
       notes = case when btrim(q.notes) = btrim(r.invoice_number) then null else q.notes end
  from home.invoice_reviews r
 where r.quote_id = q.id
   and r.state = 'approved'
   and nullif(btrim(coalesce(r.invoice_number, '')), '') is not null
   and q.invoice_number is null;

drop function home.create_quote(uuid, uuid, uuid, text, text, numeric, boolean,
  home.project_quote_kind, home.project_quote_status, home.project_quote_basis,
  date, text, uuid, text[], text[], date, uuid, uuid, uuid);

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
  p_against_quote_id uuid default null,
  p_invoice_number text default null
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
    due_on, billed_through_id, settles_milestone_id, against_quote_id,
    invoice_number
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
    p_due_on, p_billed_through_id, p_settles_milestone_id, p_against_quote_id,
    nullif(btrim(coalesce(p_invoice_number, '')), '')
  )
  returning * into v_quote;

  return v_quote;
end;
$$;

revoke execute on function home.create_quote(
  uuid, uuid, uuid, text, text, numeric, boolean,
  home.project_quote_kind, home.project_quote_status, home.project_quote_basis,
  date, text, uuid, text[], text[], date, uuid, uuid, uuid, text
) from public, anon;
grant execute on function home.create_quote(
  uuid, uuid, uuid, text, text, numeric, boolean,
  home.project_quote_kind, home.project_quote_status, home.project_quote_basis,
  date, text, uuid, text[], text[], date, uuid, uuid, uuid, text
) to authenticated;

drop function home.update_quote(uuid, text, text, numeric, boolean, home.project_quote_kind,
  home.project_quote_basis, date, text, uuid, text[], text[], text[], date, uuid, uuid);

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
    invoice_number  = case when 'invoice_number' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_invoice_number, '')), ''), invoice_number) end,
    updated_at      = now()
  where id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$$;

revoke execute on function home.update_quote(
  uuid, text, text, numeric, boolean, home.project_quote_kind, home.project_quote_basis,
  date, text, uuid, text[], text[], text[], date, uuid, uuid, text
) from public, anon;
grant execute on function home.update_quote(
  uuid, text, text, numeric, boolean, home.project_quote_kind, home.project_quote_basis,
  date, text, uuid, text[], text[], text[], date, uuid, uuid, text
) to authenticated;

create or replace function home.approve_invoice_review(
  p_review_id uuid,
  p_element_id uuid default null
)
returns home.project_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
  v_quote home.project_quotes;
  v_element uuid;
  v_room_ids uuid[];
  v_room_amounts numeric[];
begin
  select * into v_review from home.invoice_reviews where id = p_review_id;

  if v_review.id is null then
    raise exception 'No such invoice';
  end if;

  perform home.require_project_member(v_review.project_id);

  if v_review.state = 'approved' then
    raise exception 'That one is already on the job';
  end if;

  v_element := coalesce(p_element_id, v_review.element_id);

  if v_element is not null
     and home.element_project(v_element) is distinct from v_review.project_id then
    raise exception 'That part belongs to another job';
  end if;

  if p_element_id is null and cardinality(v_review.room_ids) > 0 then
    select array_agg(r.id order by r.ord),
           case when v_review.room_amounts is null then null
                else array_agg(v_review.room_amounts[r.ord] order by r.ord) end
      into v_room_ids, v_room_amounts
    from unnest(v_review.room_ids) with ordinality as r(id, ord)
    where home.element_project(r.id) = v_review.project_id;
  end if;

  v_quote := home.create_quote(
    p_element_id => v_element,
    p_project_id => case when v_element is null then v_review.project_id end,
    p_supplier => v_review.supplier,
    p_detail => coalesce(v_review.detail, v_review.category),
    p_amount => v_review.amount,
    p_amount_incl_gst => v_review.amount_incl_gst,
    p_kind => 'invoice',
    p_dated => v_review.dated,
    p_due_on => v_review.due_on,
    p_invoice_number => v_review.invoice_number,
    p_photo_paths => v_review.photo_paths,
    p_document_paths => v_review.document_paths
  );

  if v_element is null and cardinality(coalesce(v_room_ids, '{}')) > 0 then
    perform home.set_quote_rooms(v_quote.id, v_room_ids, v_room_amounts);
  end if;

  if v_review.paid and v_review.amount is not null then
    perform home.add_payment(
      p_quote_id => v_quote.id,
      p_amount => v_review.amount,
      p_amount_incl_gst => v_review.amount_incl_gst,
      p_paid_on => v_review.paid_on,
      p_reference => v_review.invoice_number
    );
  end if;

  update home.invoice_reviews set
    state = 'approved',
    element_id = v_element,
    quote_id = v_quote.id,
    decided_at = now(),
    decided_by = auth.uid(),
    updated_at = now()
  where id = p_review_id;

  return v_quote;
end;
$$;

revoke execute on function home.approve_invoice_review(uuid, uuid) from public, anon;
grant execute on function home.approve_invoice_review(uuid, uuid) to authenticated;

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
  cl.claimed_total,
  q.invoice_number
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
