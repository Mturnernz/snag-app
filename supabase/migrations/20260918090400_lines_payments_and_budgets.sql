-- The rest of the writes: a quote's lines, a bill's payments, a part's budget,
-- and a way to correct a supplier's name across a job.

-- ---------------------------------------------------------------- lines

create function home.add_quote_line(
  p_quote_id uuid,
  p_name text,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default true,
  p_is_allowance boolean default false
)
returns home.project_quote_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line home.project_quote_lines;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_next integer;
begin
  perform home.require_project_member(home.quote_project(p_quote_id));

  if v_name is null then
    raise exception 'Give the line a name — what the quote calls it';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next
  from home.project_quote_lines where quote_id = p_quote_id;

  insert into home.project_quote_lines (
    quote_id, name, detail, amount, amount_incl_gst, is_allowance, sort_order, created_by
  )
  values (
    p_quote_id, v_name,
    nullif(btrim(coalesce(p_detail, '')), ''),
    p_amount, coalesce(p_amount_incl_gst, true),
    coalesce(p_is_allowance, false), v_next, auth.uid()
  )
  returning * into v_line;

  return v_line;
end;
$$;

grant execute on function home.add_quote_line(uuid, text, text, numeric, boolean, boolean)
  to authenticated;

create function home.update_quote_line(
  p_line_id uuid,
  p_name text default null,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default null,
  p_is_allowance boolean default null,
  p_clear text[] default '{}'
)
returns home.project_quote_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line home.project_quote_lines;
  v_clear text[] := coalesce(p_clear, '{}');
begin
  perform home.require_project_member(home.line_project(p_line_id));

  update home.project_quote_lines set
    name            = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    detail          = case when 'detail' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_detail, '')), ''), detail) end,
    amount          = case when 'amount' = any(v_clear) then null
                           else coalesce(p_amount, amount) end,
    amount_incl_gst = coalesce(p_amount_incl_gst, amount_incl_gst),
    is_allowance    = coalesce(p_is_allowance, is_allowance),
    updated_at      = now()
  where id = p_line_id
  returning * into v_line;

  if v_line.id is null then
    raise exception 'No such line';
  end if;

  return v_line;
end;
$$;

grant execute on function home.update_quote_line(uuid, text, text, numeric, boolean, boolean, text[])
  to authenticated;

-- The quotes got for this line come unlinked rather than going with it, by the
-- `on delete set null` on `supersedes_line_id`: they start summing on their own
-- account, which is what the line ceasing to exist actually means.
create function home.delete_quote_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_project_member(home.line_project(p_line_id));
  delete from home.project_quote_lines where id = p_line_id;
end;
$$;

grant execute on function home.delete_quote_line(uuid) to authenticated;

-- ---------------------------------------------------------------- payments

create function home.add_payment(
  p_quote_id uuid,
  p_amount numeric,
  p_amount_incl_gst boolean default true,
  p_paid_on date default null,
  p_reference text default null,
  p_notes text default null
)
returns home.project_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment home.project_payments;
  v_kind home.project_quote_kind;
begin
  perform home.require_project_member(home.quote_project(p_quote_id));

  select kind into v_kind from home.project_quotes where id = p_quote_id;

  if v_kind is null then
    raise exception 'No such bill';
  end if;

  -- Said in words. A payment against a quote is the sibling-row shape this
  -- table exists to end: it would be money recorded as gone out against a price
  -- nobody has been billed for.
  if v_kind <> 'invoice' then
    raise exception 'Record the invoice first — a payment settles a bill, not a price';
  end if;

  if p_amount is null then
    raise exception 'How much was paid?';
  end if;

  insert into home.project_payments (
    quote_id, amount, amount_incl_gst, paid_on, reference, notes, created_by
  )
  values (
    p_quote_id, p_amount, coalesce(p_amount_incl_gst, true), p_paid_on,
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

grant execute on function home.add_payment(uuid, numeric, boolean, date, text, text)
  to authenticated;

create function home.delete_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_project_member(home.payment_project(p_payment_id));
  delete from home.project_payments where id = p_payment_id;
end;
$$;

grant execute on function home.delete_payment(uuid) to authenticated;

-- ---------------------------------------------------------------- budgets

drop function if exists home.update_element(uuid, text, text, text, text[], text[], text[]);

create function home.update_element(
  p_element_id uuid,
  p_name text default null,
  p_room text default null,
  p_notes text default null,
  p_budget numeric default null,
  p_budget_incl_gst boolean default null,
  p_photo_paths text[] default null,
  p_document_paths text[] default null,
  p_clear text[] default '{}'
)
returns home.project_elements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_element home.project_elements;
  v_clear text[] := coalesce(p_clear, '{}');
begin
  perform home.require_project_member(home.element_project(p_element_id));

  update home.project_elements set
    name            = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    room            = case when 'room' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_room, '')), ''), room) end,
    notes           = case when 'notes' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes) end,
    budget          = case when 'budget' = any(v_clear) then null
                           else coalesce(p_budget, budget) end,
    budget_incl_gst = coalesce(p_budget_incl_gst, budget_incl_gst),
    photo_paths     = coalesce(p_photo_paths, photo_paths),
    document_paths  = coalesce(p_document_paths, document_paths),
    updated_at      = now()
  where id = p_element_id
  returning * into v_element;

  if v_element.id is null then
    raise exception 'No such part of the job';
  end if;

  return v_element;
end;
$$;

grant execute on function home.update_element(
  uuid, text, text, text, numeric, boolean, text[], text[], text[]
) to authenticated;

-- ---------------------------------------------------------------- one name
--
-- A typo noticed at $176,755 is otherwise fixable only quote by quote, and a
-- rollup nobody can correct is a rollup nobody trusts. Matched case-insensitively
-- on the trimmed name, which is how the rollup groups.
create function home.rename_supplier(p_project_id uuid, p_from text, p_to text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text := lower(btrim(coalesce(p_from, '')));
  v_to text := nullif(btrim(coalesce(p_to, '')), '');
  v_count integer;
begin
  perform home.require_project_member(p_project_id);

  if v_to is null then
    raise exception 'What should they be called?';
  end if;

  update home.project_quotes q set supplier = v_to, updated_at = now()
   where lower(btrim(coalesce(q.supplier, ''))) = v_from
     and home.quote_project(q.id) = p_project_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function home.rename_supplier(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
