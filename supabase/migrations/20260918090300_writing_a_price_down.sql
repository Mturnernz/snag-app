-- Writing a price down, and who is owed what.

-- ---------------------------------------------------------------- suppliers
--
-- "ReliaBuilder — committed $176,755, paid $84,000, outstanding $92,755."
--
-- Grouped on the trimmed, lower-cased name and displayed with the spelling used
-- most recently, because the supplier field stays free text: a supplier list
-- somebody has to fill in before they can record a quote is setup, and this app
-- does not do setup. `home.rename_supplier` below is the other half — a rollup
-- nobody can correct is a rollup nobody trusts.
--
-- Quotes with nobody named group under one unnamed row rather than being
-- dropped. Money owed to somebody you did not write down is still money owed.

create view home.project_supplier_totals
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
  count(*) filter (where kind = 'quote' and status = 'tbc') as tbc_count
from (
  select
    home.quote_reach(q.id)                    as reach,
    lower(btrim(coalesce(q.supplier, '')))    as supplier_key,
    q.supplier,
    q.created_at,
    q.kind,
    q.status,
    q.supersedes_line_id,
    q.effective_amount,
    q.paid_total
  from home.project_quotes_with_totals q
) s
group by reach, supplier_key;

grant select on home.project_supplier_totals to authenticated;

-- ---------------------------------------------------------------- the writes

drop function if exists home.create_quote(uuid, text, text, numeric, boolean, home.project_quote_kind, date, text, boolean, text[], text[]);
drop function if exists home.update_quote(uuid, text, text, numeric, boolean, home.project_quote_kind, date, text, text[], text[], text[]);
drop function if exists home.set_quote_chosen(uuid, boolean);

-- Exactly one of the three levels, said in words rather than left to the check
-- constraint, which would surface as `project_quotes_one_owner` and mean nothing.
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
  p_document_paths text[] default '{}'
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
    -- Across the join a foreign key cannot see, so it is checked here: a line
    -- from somebody else's renovation would put this money in two projects.
    if home.line_project(p_supersedes_line_id) is distinct from v_project then
      raise exception 'That line belongs to a different job';
    end if;
  end if;

  -- Cleared first, because `project_quotes_one_accepted` is a plain unique index
  -- rather than a deferred constraint.
  if v_status = 'accepted' and v_kind = 'quote' and p_item_id is not null then
    update home.project_quotes set status = 'tbc', updated_at = now()
     where item_id = p_item_id and kind = 'quote' and status = 'accepted';
  end if;

  insert into home.project_quotes (
    item_id, element_id, project_id, supplier, detail, amount, amount_incl_gst,
    kind, status, basis, dated, notes, supersedes_line_id,
    photo_paths, document_paths, created_by
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
    auth.uid()
  )
  returning * into v_quote;

  return v_quote;
end;
$$;

grant execute on function home.create_quote(
  uuid, uuid, uuid, text, text, numeric, boolean, home.project_quote_kind,
  home.project_quote_status, home.project_quote_basis, date, text, uuid, text[], text[]
) to authenticated;

-- A correction. Deliberately cannot carry `status`: choosing stays on
-- `set_quote_status` for the reason `set_part_bought` is its own function —
-- alone, it cannot have its sibling-clearing skipped by a caller passing a
-- status among eight other fields.
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
  p_clear text[] default '{}'
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
    updated_at      = now()
  where id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$$;

grant execute on function home.update_quote(
  uuid, text, text, numeric, boolean, home.project_quote_kind, home.project_quote_basis,
  date, text, uuid, text[], text[], text[]
) to authenticated;

create function home.set_quote_status(p_quote_id uuid, p_status home.project_quote_status)
returns home.project_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote home.project_quotes;
  v_item uuid;
  v_kind home.project_quote_kind;
  v_status home.project_quote_status := coalesce(p_status, 'tbc');
begin
  perform home.require_project_member(home.quote_project(p_quote_id));

  select item_id, kind into v_item, v_kind
  from home.project_quotes where id = p_quote_id;

  if v_kind is null then
    raise exception 'No such quote';
  end if;

  if v_status = 'accepted' and v_kind = 'quote' and v_item is not null then
    update home.project_quotes set status = 'tbc', updated_at = now()
     where item_id = v_item and kind = 'quote' and status = 'accepted' and id <> p_quote_id;
  end if;

  update home.project_quotes set status = v_status, updated_at = now()
   where id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$$;

grant execute on function home.set_quote_status(uuid, home.project_quote_status) to authenticated;

notify pgrst, 'reload schema';
