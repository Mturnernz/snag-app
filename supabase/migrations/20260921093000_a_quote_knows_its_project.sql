-- A quote knows which job it belongs to, without being asked four times.
--
-- `home.quote_reach(id)` answers "which project is this price under" by
-- joining out to the element, or to the item and then its element. That is
-- the right *definition*, and it was the wrong thing to put in a view column
-- that the client then filters on.
--
-- `getProjectContents` reads prices with `.eq('reach_project_id', <project>)`.
-- Because the column was a function call, the planner could not see through
-- it: the filter became `Filter: (home.quote_reach(id) = $1)` over a **seq
-- scan of every quote in the table**, with a four-table join executed once
-- per row. At 19 quotes that is 0.8ms and invisible. It is also O(n) in every
-- price the household has ever recorded, across every renovation, for ever —
-- so it gets slower in exactly the way nobody notices until it is bad.
-- `project_bills` and `project_supplier_totals` filter the same way and paid
-- the same cost.
--
-- So the answer becomes a real column, written once when the row is created
-- and indexed.
--
-- **This is a cache of a join, and the thing that makes it safe is that the
-- join can never change.** The schema's standing rule is that two writers of
-- one fact will disagree — it is why `needs_parts` was pulled out of
-- `update_snag` and derived in the view instead. The distinction here is that
-- a quote's parentage is **write-once**: exactly one of `item_id` /
-- `element_id` / `project_id` is set at insert (the check constraint says so),
-- and no function anywhere re-parents a quote, an item, or an element —
-- `update_quote` does not name those three columns, and there is no
-- move-to-another-element RPC to write. The trigger is therefore the only
-- writer, and it fires on the only two events that could ever change the
-- answer.
--
-- `home.quote_reach(uuid)` stays as the reference definition the backfill and
-- the trigger are checked against. Nothing reads it in a hot path any more.
--
-- **The three views are replaced, not dropped and rebuilt.** Each keeps its
-- column list exactly as it was — same names, same types, same order — so
-- `create or replace view` takes them, and `project_scope_money`,
-- `project_items_with_totals`, `project_elements_with_totals` and
-- `projects_with_totals` are never touched. Rebuilding the whole stack to
-- change one expression is how a money engine acquires a regression nobody
-- was looking for.

-- ------------------------------------------------------- the column

alter table home.project_quotes
  add column reach_project_id uuid references home.projects(id) on delete cascade;

-- Reach computed from the three ids rather than from a row that does not
-- exist yet — `quote_reach` takes a quote id, which a BEFORE INSERT trigger
-- has nothing to hand it.
create function home.quote_reach_for(
  p_project_id uuid,
  p_element_id uuid,
  p_item_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_project_id,
    (select e.project_id from home.project_elements e where e.id = p_element_id),
    (select ie.project_id
       from home.project_items i
       join home.project_elements ie on ie.id = i.element_id
      where i.id = p_item_id)
  );
$$;

revoke execute on function home.quote_reach_for(uuid, uuid, uuid) from public, anon, authenticated;

create function home.quote_reach_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.reach_project_id :=
    home.quote_reach_for(new.project_id, new.element_id, new.item_id);
  return new;
end;
$$;

revoke execute on function home.quote_reach_sync() from public, anon, authenticated;

-- Insert, and the three columns that decide the answer. The update arm is
-- defensive rather than load-bearing: nothing re-parents a quote today, and
-- if anything ever does, the cache follows it rather than going stale.
create trigger quote_reach_sync
  before insert or update of project_id, element_id, item_id
  on home.project_quotes
  for each row execute function home.quote_reach_sync();

update home.project_quotes set reach_project_id = home.quote_reach(id);

-- Every quote resolves to exactly one project or the backfill was wrong, and
-- a migration that fails here is telling the truth about the data.
alter table home.project_quotes alter column reach_project_id set not null;

create index on home.project_quotes (reach_project_id);

-- ------------------------------------------------- the three readers

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
  coalesce(pi.excluded, false)                                as item_excluded
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
) pay;

create or replace view home.project_bills
with (security_invoker = true)
as
select
  q.reach_project_id      as project_id,
  q.id,
  q.supplier,
  q.detail,
  q.dated,
  q.due_on,
  q.billed_through_id,
  q.settles_milestone_id,
  q.amount_incl,
  q.paid_total,
  q.unpaid,
  q.unpaid > 0 and q.due_on is not null and q.due_on < current_date as overdue
from home.project_quotes_with_totals q
where q.kind = 'invoice' and q.status <> 'declined'
  -- A bill passed through a contract is not a bill the household pays.
  and q.billed_through_id is null
  -- Nor is a bill against an item the household has decided against.
  and not q.item_excluded;

create or replace view home.project_supplier_totals
with (security_invoker = true)
as
select
  reach                                             as project_id,
  supplier_key,
  (array_agg(supplier order by created_at desc))[1] as supplier,
  sum(effective_amount) filter (
    where kind = 'quote' and status = 'accepted' and supersedes_line_id is null
  )                                                 as committed,
  sum(effective_amount) filter (where kind = 'invoice' and status <> 'declined')
                                                    as invoiced,
  sum(paid_total)      filter (where kind = 'invoice') as paid,
  sum(unpaid)                                       as unpaid,
  min(due_on) filter (where coalesce(unpaid, 0) > 0) as next_due_on,
  count(*) filter (where kind = 'quote' and status = 'tbc') as tbc_count
from (
  select
    q.reach_project_id                        as reach,
    lower(btrim(coalesce(q.supplier, '')))    as supplier_key,
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
  -- An excluded item's price does not count as owed to anybody.
  where q.billed_through_id is null and not q.item_excluded
) s
group by reach, supplier_key;

notify pgrst, 'reload schema';
