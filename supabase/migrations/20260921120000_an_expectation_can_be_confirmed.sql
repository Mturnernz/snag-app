-- An expected cost can be confirmed, and a confirmed one is a commitment.
--
-- `20260921090000` made this row the one place in the feature whose number is
-- allowed to be somebody's estimate, and fenced it hard: **never committed,
-- never invoiced**, Forecast alone, named as a guess everywhere it is summed.
-- The distinction it drew is still the right one — an *allowance* is a written
-- number inside a contract you signed, an *expected cost* is not committed at
-- all, because nobody has agreed to anything.
--
-- **"Because nobody has agreed to anything" is a state, not a property of the
-- row.** That is the whole change. The architect's $4,000 is a guess in week
-- one and an agreed fee in week three, and until now the only way to say the
-- second thing was to invent a quote from a firm that never sent one — which
-- is the fabrication the original migration refused, correctly. So the row
-- gains the missing answer instead:
--
--   * **unconfirmed** — exactly what it has always been. Forecast only,
--     counted in `expected_open`, worded as a guess, owed to nobody.
--   * **confirmed** — somebody has agreed this. It counts in **Committed**, it
--     is owed to `likely_supplier` under *Who we're paying*, and it leaves
--     `expected_open`, so the forecast stops calling it a guess.
--
-- The fence does not move; it gains a gate, and the gate is a deliberate act.
-- A default of `false` means every row that exists today keeps the behaviour it
-- had, and nothing on any page changes until somebody presses the toggle.
--
-- **It still never reaches Invoiced or Paid.** Nobody has billed for it and no
-- money has moved, and `add_payment` still refuses anything but an invoice. A
-- confirmed expectation therefore widens *still to be billed*, which is the
-- true reading: it is agreed work nobody has claimed for yet.
--
-- **And it does not reach Quoted.** That line is what the suppliers have
-- actually said; nobody said this. Quoted sitting below Committed on a job
-- whose costs were agreed rather than quoted is not a contradiction — it is the
-- page saying which of the two this money is.
--
-- ------------------------------------------------- summed from exactly one place
--
-- The rule the money model keeps naming. A confirmed expectation is **added**
-- to a scope's committed figure rather than folded into the accepted-or-invoiced
-- fallback beside it: it is a different kind of row, not another quote at the
-- same scope, and putting it inside the `coalesce` would make one suppress the
-- other. So:
--
--     committed(scope) = coalesce(accepted, invoiced) + confirmed expectations
--
-- A part's confirmed expectations roll into the job through that part's
-- `committed_total`, exactly as its items do; only the ones belonging to the
-- job rather than to a room are added again at the top. And the same figure
-- joins `project_supplier_totals`, because **the supplier rows sum to the
-- project's committed total** is the invariant this whole model is checked
-- against — money in Committed that is owed to nobody would break it on the
-- first confirmed row.
--
-- An expectation with no figure contributes nothing, confirmed or not: nothing
-- is not zero. One with `settled_by` set still drops out everywhere, because a
-- real price has arrived and the expectation has been replaced.
--
-- ---------------------------------------------------------------- mechanics
--
-- `create or replace` can only **append**, so `expected_confirmed` goes last on
-- both rollups and every existing column keeps its place; the expressions
-- behind `committed_derived` and `committed_total` change, which a replace
-- allows. Both restate `with (security_invoker = true)` — a replace with no
-- clause **resets** the option rather than keeping it, which is what
-- `20260917090000` did to `snags_with_details` and handed every row in the
-- table to anybody holding a token.
--
-- The project rollup's project-level expectation lateral moves **above** `d`,
-- because a lateral can only read the FROM items to its left and `d` now has to
-- add it. It references nothing but `p`, so the move changes what the view can
-- see and nothing about what it returns — checked by diffing every row of all
-- five rollups before and after, which came back identical, as it must while
-- `confirmed` is false everywhere.

alter table home.project_expected_costs
  add column confirmed boolean not null default false;

-- Its own function, for the reason `set_part_bought`, `set_quote_status` and
-- `set_item_excluded` are theirs: this is the only write on an expected cost
-- that changes what a total says, and alone it cannot be smuggled in beside
-- eight other fields by a caller updating a name.
create function home.set_expected_cost_confirmed(p_expected_id uuid, p_confirmed boolean)
returns home.project_expected_costs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row home.project_expected_costs;
  v_project uuid := home.expected_cost_project(p_expected_id);
begin
  if v_project is null then
    raise exception 'No such expected cost';
  end if;

  perform home.require_project_member(v_project);

  update home.project_expected_costs
     set confirmed = coalesce(p_confirmed, false), updated_at = now()
   where id = p_expected_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function home.set_expected_cost_confirmed(uuid, boolean) to authenticated;

-- Dropped and recreated rather than replaced: `create or replace function` with
-- a different argument count makes a second overload, and PostgREST resolving a
-- named-argument call against two candidates is an error rather than a choice.
drop function home.create_expected_cost(uuid, text, numeric, boolean, uuid, text, text);

create function home.create_expected_cost(
  p_project_id uuid,
  p_name text,
  p_amount numeric default null,
  p_amount_incl_gst boolean default true,
  p_element_id uuid default null,
  p_likely_supplier text default null,
  p_note text default null,
  -- Answered at the moment the row is made, because there is no total to change
  -- yet — the row is being created. Changing it afterwards goes through
  -- `set_expected_cost_confirmed` and nothing else.
  p_confirmed boolean default false
)
returns home.project_expected_costs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row home.project_expected_costs;
begin
  perform home.require_project_member(p_project_id);

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give it a name — what is the cost for?';
  end if;

  -- A part from another renovation would put this forecast in two jobs.
  if p_element_id is not null
     and home.element_project(p_element_id) is distinct from p_project_id then
    raise exception 'That part belongs to a different job';
  end if;

  insert into home.project_expected_costs (
    project_id, element_id, name, amount, amount_incl_gst, likely_supplier, note,
    confirmed, created_by
  )
  values (
    p_project_id, p_element_id, btrim(p_name), p_amount,
    coalesce(p_amount_incl_gst, true),
    nullif(btrim(coalesce(p_likely_supplier, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_confirmed, false),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function home.create_expected_cost(
  uuid, text, numeric, boolean, uuid, text, text, boolean
) to authenticated;

create or replace view home.project_elements_with_totals
with (security_invoker = true)
as
select
  e.id, e.project_id, e.name, e.room, e.implicit, e.sort_order, e.notes,
  e.budget, e.budget_incl_gst, e.photo_paths, e.document_paths,
  e.created_by, e.created_at, e.updated_at,
  t.item_count, t.priced_count, t.quoted_count,
  -- What the prices say.
  -- A **confirmed** expected cost is committed money at this part, added to
  -- what the prices say rather than folded into their fallback: it is a
  -- different kind of row, not another quote at the same scope.
  home.nsum(home.nsum(t.items_committed, m.accepted_total_or_invoiced),
            x.expected_confirmed)                            as committed_derived,
  home.nsum(t.items_invoiced,  m.invoiced_total)             as invoiced_derived,
  home.nsum(t.items_paid,      m.paid_total)                 as paid_derived,
  -- What somebody typed.
  ov.committed_override,
  ov.invoiced_override,
  ov.paid_override,
  ov.committed_note,
  ov.invoiced_note,
  ov.paid_note,
  -- What the page shows.
  coalesce(ov.committed_override,
           home.nsum(home.nsum(t.items_committed, m.accepted_total_or_invoiced),
                     x.expected_confirmed))                            as committed_total,
  coalesce(ov.invoiced_override,
           home.nsum(t.items_invoiced, m.invoiced_total))              as invoiced_total,
  coalesce(ov.paid_override,
           home.nsum(t.items_paid, m.paid_total))                      as paid_total,
  coalesce(t.items_allowance, 0) + coalesce(m.allowance_open, 0)  as allowance_open,
  coalesce(t.items_additional, 0) + coalesce(m.additional_open, 0) as additional_open,
  coalesce(x.expected_open, 0)                               as expected_open,
  coalesce(x.expected_count, 0)                              as expected_count,
  case
    when e.budget is not null and t.item_count > t.priced_count
      then greatest(
             coalesce(home.incl_gst(e.budget, e.budget_incl_gst), 0)
               - coalesce(coalesce(ov.committed_override,
                   home.nsum(home.nsum(t.items_committed, m.accepted_total_or_invoiced),
                             x.expected_confirmed)), 0),
             0)
    else 0
  end                                                        as budget_gap,
  -- Appended, because a replace can only append. How much of this part's
  -- committed figure came from a confirmed expectation rather than a price.
  x.expected_confirmed                                       as expected_confirmed
from home.project_elements e
cross join lateral (
  select
    count(*)                                            as item_count,
    count(*) filter (where i.committed is not null)     as priced_count,
    count(*) filter (where i.committed is null and i.quote_count > 0) as quoted_count,
    sum(i.committed)                                    as items_committed,
    sum(i.invoiced)                                     as items_invoiced,
    sum(i.paid)                                         as items_paid,
    sum(i.allowance_open)                               as items_allowance,
    sum(i.additional_open)                              as items_additional
  from home.project_items_with_totals i
  -- An excluded item stays on the record and keeps its own price, but stops
  -- counting towards the part it belongs to.
  where i.element_id = e.id and not i.excluded
) t
left join lateral (
  select
    coalesce(sm.accepted_total, sm.invoiced_total) as accepted_total_or_invoiced,
    sm.invoiced_total, sm.paid_total, sm.allowance_open, sm.additional_open
  from home.project_scope_money sm
  where sm.level = 'element' and sm.owner_id = e.id
) m on true
cross join lateral (
  select
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'committed') as committed_override,
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'invoiced')  as invoiced_override,
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'paid')      as paid_override,
    max(o.note) filter (where o.field = 'committed') as committed_note,
    max(o.note) filter (where o.field = 'invoiced')  as invoiced_note,
    max(o.note) filter (where o.field = 'paid')      as paid_note
  from home.project_overrides o
  where o.element_id = e.id
) ov
cross join lateral (
  select
    -- `expected_open` is the *unconfirmed* ones now. A confirmed one has moved
    -- into committed above, so counting it here as well would be the
    -- double-count `settled_by` already exists to prevent.
    sum(home.incl_gst(x.amount, x.amount_incl_gst))
      filter (where not x.confirmed)                as expected_open,
    count(*) filter (where not x.confirmed)         as expected_count,
    sum(home.incl_gst(x.amount, x.amount_incl_gst))
      filter (where x.confirmed)                    as expected_confirmed
  from home.project_expected_costs x
  where x.element_id = e.id and x.settled_by is null
) x;


create or replace view home.projects_with_totals
with (security_invoker = true)
as
select
  p.id, p.household_id, p.property_id, p.name, p.summary, p.status,
  p.started_on, p.target_on, p.finished_on, p.budget, p.budget_incl_gst,
  p.photo_paths, p.document_paths, p.created_by, p.created_at, p.updated_at, p.updated_by,
  pr.name                as property_name,
  creator.display_name   as created_by_name,
  t.element_count, t.shown_element_count, t.item_count, t.priced_count, t.quoted_count,
  -- Derived: the parts' *shown* totals plus this level's own prices. A part's
  -- override rolls up, or the figure contradicts the rows beneath it.
  d.committed_derived,
  d.invoiced_derived,
  d.paid_derived,
  ov.committed_override,
  ov.invoiced_override,
  ov.paid_override,
  ov.forecast_override,
  ov.committed_note,
  ov.invoiced_note,
  ov.paid_note,
  ov.forecast_note,
  coalesce(ov.committed_override, d.committed_derived) as committed_total,
  coalesce(ov.invoiced_override,  d.invoiced_derived)  as invoiced_total,
  coalesce(ov.paid_override,      d.paid_derived)      as paid_total,
  coalesce(t.parts_allowance, 0) + coalesce(m.allowance_open, 0)   as allowance_open,
  coalesce(t.parts_additional, 0) + coalesce(m.additional_open, 0) as additional_open,
  coalesce(t.parts_expected, 0) + coalesce(x.expected_open, 0)     as expected_open,
  coalesce(t.parts_expected_count, 0) + coalesce(x.expected_count, 0) as expected_count,
  coalesce(t.parts_budget_gap, 0)                            as budget_gap,
  -- Forecast builds on the *shown* committed, so overriding committed moves the
  -- forecast with it rather than leaving the two disagreeing on one screen.
  home.nsum(
    coalesce(ov.committed_override, d.committed_derived),
    coalesce(t.parts_additional, 0) + coalesce(m.additional_open, 0)
      + coalesce(t.parts_expected, 0) + coalesce(x.expected_open, 0)
      + coalesce(t.parts_budget_gap, 0)
  )                                                          as forecast_derived,
  coalesce(
    ov.forecast_override,
    home.nsum(
      coalesce(ov.committed_override, d.committed_derived),
      coalesce(t.parts_additional, 0) + coalesce(m.additional_open, 0)
        + coalesce(t.parts_expected, 0) + coalesce(x.expected_open, 0)
        + coalesce(t.parts_budget_gap, 0)
    )
  )                                                          as forecast_total,
  coalesce(t.parts_allowance, 0) + coalesce(m.allowance_open, 0)
    + coalesce(t.parts_additional, 0) + coalesce(m.additional_open, 0)
    + coalesce(t.parts_expected, 0) + coalesce(x.expected_open, 0)
    + coalesce(t.parts_budget_gap, 0)                        as forecast_guess,
  t.parts_budget_total, t.parts_budgeted_count, f.file_count,
  -- How many parts carry an edited figure, so the job can say so without the
  -- reader having to open each one.
  t.parts_edited_count,
  -- Both gaps read the shown figures, for the same reason.
  home.nsum(
    coalesce(ov.committed_override, d.committed_derived),
    - coalesce(ov.invoiced_override, d.invoiced_derived)
  )                                                          as still_to_bill,
  -- `due_to_pay` follows an override the moment one exists, and otherwise stays
  -- the per-bill sum — which carries the dates, and which no total can.
  case
    when ov.invoiced_override is not null or ov.paid_override is not null
      then greatest(
             coalesce(coalesce(ov.invoiced_override, d.invoiced_derived), 0)
               - coalesce(coalesce(ov.paid_override, d.paid_derived), 0), 0)
    else coalesce(b.due_to_pay, 0)
  end                                                        as due_to_pay,
  coalesce(b.overdue_total, 0)                               as overdue_total,
  b.next_due_on,
  coalesce(b.due_count, 0)                                   as due_count,
  (select count(*) from home.snags s where s.project_id = p.id)           as snag_count,
  (select count(*) from home.snags s where s.project_id = p.id and s.status <> 'done')
                                                                          as open_snag_count,
  (select count(*) from home.things th where th.project_id = p.id)        as thing_count,
  (select count(*)
     from home.project_items i
     join home.project_elements e on e.id = i.element_id
    where e.project_id = p.id and i.status = 'installed')                 as installed_count,
  -- Appended, because a replace can only append. How much of Committed is a
  -- confirmed expectation rather than somebody's price — the denominator rule,
  -- applied to the one row type whose figure was never on paper.
  home.nsum(t.parts_expected_confirmed, x.expected_confirmed) as expected_confirmed
from home.projects p
join home.properties pr      on pr.id = p.property_id
join home.profiles creator   on creator.id = p.created_by
cross join lateral (
  select
    count(*)                                        as element_count,
    count(*) filter (where not e.implicit)          as shown_element_count,
    coalesce(sum(e.item_count), 0)                  as item_count,
    coalesce(sum(e.priced_count), 0)                as priced_count,
    coalesce(sum(e.quoted_count), 0)                as quoted_count,
    sum(e.committed_total)                          as parts_committed,
    sum(e.invoiced_total)                           as parts_invoiced,
    sum(e.paid_total)                               as parts_paid,
    sum(e.allowance_open)                           as parts_allowance,
    sum(e.additional_open)                          as parts_additional,
    sum(e.expected_open)                            as parts_expected,
    sum(e.expected_count)                           as parts_expected_count,
    sum(e.budget_gap)                               as parts_budget_gap,
    sum(home.incl_gst(e.budget, e.budget_incl_gst)) as parts_budget_total,
    count(*) filter (where e.budget is not null)    as parts_budgeted_count,
    sum(e.expected_confirmed)                       as parts_expected_confirmed,
    count(*) filter (
      where e.committed_override is not null
         or e.invoiced_override is not null
         or e.paid_override is not null
    )                                               as parts_edited_count
  from home.project_elements_with_totals e
  where e.project_id = p.id
) t
left join lateral (
  select
    coalesce(sm.accepted_total, sm.invoiced_total) as accepted_total_or_invoiced,
    sm.invoiced_total, sm.paid_total, sm.allowance_open, sm.additional_open
  from home.project_scope_money sm
  where sm.level = 'project' and sm.owner_id = p.id
) m on true
-- Above `d`, which adds the confirmed ones to committed: a lateral can only
-- read the FROM items to its left. It references nothing but `p`, so moving it
-- changes what this view can see and nothing about what it returns.
cross join lateral (
  select
    sum(home.incl_gst(x.amount, x.amount_incl_gst))
      filter (where not x.confirmed)                as expected_open,
    count(*) filter (where not x.confirmed)         as expected_count,
    sum(home.incl_gst(x.amount, x.amount_incl_gst))
      filter (where x.confirmed)                    as expected_confirmed
  from home.project_expected_costs x
  where x.project_id = p.id and x.element_id is null and x.settled_by is null
) x
cross join lateral (
  select
    -- The parts' own confirmed expectations are already inside
    -- `parts_committed`, through each element's `committed_total`. What is
    -- added here is only the ones belonging to the job rather than to a room.
    home.nsum(home.nsum(t.parts_committed, m.accepted_total_or_invoiced),
              x.expected_confirmed)                            as committed_derived,
    home.nsum(t.parts_invoiced,  m.invoiced_total)             as invoiced_derived,
    home.nsum(t.parts_paid,      m.paid_total)                 as paid_derived
) d
cross join lateral (
  select
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'committed') as committed_override,
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'invoiced')  as invoiced_override,
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'paid')      as paid_override,
    sum(home.incl_gst(o.amount, o.amount_incl_gst))
      filter (where o.field = 'forecast')  as forecast_override,
    max(o.note) filter (where o.field = 'committed') as committed_note,
    max(o.note) filter (where o.field = 'invoiced')  as invoiced_note,
    max(o.note) filter (where o.field = 'paid')      as paid_note,
    max(o.note) filter (where o.field = 'forecast')  as forecast_note
  from home.project_overrides o
  where o.project_id = p.id and o.element_id is null
) ov
cross join lateral (
  select
    sum(bl.unpaid)                                   as due_to_pay,
    sum(bl.unpaid) filter (where bl.overdue)         as overdue_total,
    count(*) filter (where coalesce(bl.unpaid, 0) > 0) as due_count,
    min(bl.due_on) filter (where coalesce(bl.unpaid, 0) > 0) as next_due_on
  from home.project_bills bl
  where bl.project_id = p.id
) b
cross join lateral (
  select count(*) as file_count from home.project_files pf where pf.project_id = p.id
) f;


-- Who a confirmed expectation is owed to. Without this the supplier rows stop
-- summing to Committed on the first confirmed row, which is the one check this
-- model is held to. An unconfirmed one is still owed to nobody — you cannot owe
-- money to a guess — and one with no figure contributes nothing either way.
create or replace view home.project_supplier_totals
with (security_invoker = true)
as
with scoped as (
  select
    q.reach_project_id                              as project_id,
    coalesce(q.item_id, q.element_id, q.project_id) as scope_id,
    q.supplier,
    q.created_at,
    q.kind,
    q.status,
    -- A direct buy answering an allowance is money owed to *this* supplier, so
    -- it is not a superseding row as far as "who is owed what" is concerned.
    case when q.billed_through_id is null then null else q.supersedes_line_id end
                                                    as supersedes_line_id,
    q.effective_amount,
    q.paid_total,
    q.unpaid,
    q.due_on
  from home.project_quotes_with_totals q
  -- A bill passed through a contract is not money the household owes its
  -- sender, and an excluded item's price is not owed to anybody.
  where q.billed_through_id is null and not q.item_excluded
),
-- Which scopes have somebody's accepted price on them. The fallback belongs to
-- the **scope**, never to the supplier.
settled as (
  select distinct scope_id
  from scoped
  where kind = 'quote' and status = 'accepted' and supersedes_line_id is null
),
contribution as (
  select
    s.project_id,
    lower(btrim(coalesce(s.supplier, ''))) as supplier_key,
    s.supplier,
    s.created_at,
    case
      when s.kind = 'quote' and s.status = 'accepted' and s.supersedes_line_id is null
        then s.effective_amount
      -- Nothing was ever quoted at this scope, so the invoices are the
      -- commitment. A consultant billing time by the month has no quote and
      -- never will.
      when s.kind = 'invoice' and s.status <> 'declined'
           and not exists (select 1 from settled t where t.scope_id = s.scope_id)
        then s.effective_amount
    end                                                       as committed_part,
    case when s.kind = 'invoice' and s.status <> 'declined' then s.effective_amount end
                                                              as invoiced_part,
    case when s.kind = 'invoice' then s.paid_total end        as paid_part,
    -- Everything they have said that has not been declined, accepted prices
    -- included: the line above Committed, broken down by who said it.
    case when s.kind = 'quote' and s.status <> 'declined' then s.effective_amount end
                                                              as quoted_part,
    s.unpaid,
    s.due_on,
    case when s.kind = 'quote' and s.status = 'tbc' then 1 else 0 end as tbc
  from scoped s
  union all
  -- A confirmed expectation. Committed only: nobody quoted it, nobody has
  -- billed for it, and no money has moved — so it is owed, and that is all.
  select
    x.project_id,
    lower(btrim(coalesce(x.likely_supplier, ''))) as supplier_key,
    x.likely_supplier                             as supplier,
    x.created_at,
    home.incl_gst(x.amount, x.amount_incl_gst)    as committed_part,
    null::numeric                                 as invoiced_part,
    null::numeric                                 as paid_part,
    null::numeric                                 as quoted_part,
    null::numeric                                 as unpaid,
    null::date                                    as due_on,
    0                                             as tbc
  from home.project_expected_costs x
  where x.settled_by is null and x.confirmed
)
select
  project_id,
  supplier_key,
  -- Displayed with the spelling used most recently. Grouping is on the
  -- trimmed, lower-cased name, and `home.rename_supplier` is how a typo gets
  -- corrected across a job rather than quote by quote.
  (array_agg(supplier order by created_at desc))[1] as supplier,
  sum(committed_part)                               as committed,
  sum(invoiced_part)                                as invoiced,
  sum(paid_part)                                    as paid,
  sum(unpaid)                                       as unpaid,
  min(due_on) filter (where coalesce(unpaid, 0) > 0) as next_due_on,
  sum(tbc)                                          as tbc_count,
  sum(quoted_part)                                  as quoted
from contribution
group by project_id, supplier_key;

notify pgrst, 'reload schema';
