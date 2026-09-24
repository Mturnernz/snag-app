-- An answered GST basis, or a rewritten description, is no longer a guess.
--
-- `update_invoice_review` shrinks `inferred` by the fields somebody has just
-- answered, and it did not list `amount_incl_gst` or `detail` — the two an
-- emailed bill most often has guessed. So somebody who opened the card, looked
-- at the invoice and pressed *incl* went on seeing "guessed" beside the figure
-- they had just confirmed, which is the card saying the opposite of what its
-- reader told it. Unchanged otherwise.

create or replace function home.update_invoice_review(
  p_review_id uuid,
  p_supplier text default null,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default null,
  p_invoice_number text default null,
  p_dated date default null,
  p_due_on date default null,
  p_paid boolean default null,
  p_paid_on date default null,
  p_category text default null,
  p_element_id uuid default null,
  p_clear text[] default '{}'
)
returns home.invoice_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
  v_clear text[] := coalesce(p_clear, '{}');
  v_answered text[];
  v_inferred text[];
begin
  select * into v_review from home.invoice_reviews where id = p_review_id;

  if v_review.id is null then
    raise exception 'No such invoice';
  end if;

  perform home.require_project_member(v_review.project_id);

  if v_review.state <> 'pending' then
    raise exception 'That one has already been ruled on';
  end if;

  if p_element_id is not null
     and home.element_project(p_element_id) is distinct from v_review.project_id then
    raise exception 'That part belongs to another job';
  end if;

  v_answered := v_clear
    || case when p_supplier is not null then array['supplier'] else '{}' end
    || case when p_detail is not null then array['detail'] else '{}' end
    || case when p_amount is not null then array['amount'] else '{}' end
    || case when p_amount_incl_gst is not null then array['amount_incl_gst'] else '{}' end
    || case when p_invoice_number is not null then array['invoice_number'] else '{}' end
    || case when p_dated is not null then array['dated'] else '{}' end
    || case when p_due_on is not null then array['due_on'] else '{}' end
    || case when p_paid is not null then array['paid'] else '{}' end
    || case when p_category is not null then array['category'] else '{}' end;

  select coalesce(array_agg(f), '{}'::text[]) into v_inferred
  from unnest(v_review.inferred) as f
  where not (f = any(v_answered));

  update home.invoice_reviews set
    supplier = case when 'supplier' = any(v_clear) then null
                    else coalesce(nullif(btrim(coalesce(p_supplier, '')), ''), supplier) end,
    detail = case when 'detail' = any(v_clear) then null
                  else coalesce(nullif(btrim(coalesce(p_detail, '')), ''), detail) end,
    amount = case when 'amount' = any(v_clear) then null
                  else coalesce(p_amount, amount) end,
    amount_incl_gst = coalesce(p_amount_incl_gst, amount_incl_gst),
    invoice_number = case when 'invoice_number' = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_invoice_number, '')), ''), invoice_number) end,
    dated = case when 'dated' = any(v_clear) then null else coalesce(p_dated, dated) end,
    due_on = case when 'due_on' = any(v_clear) then null else coalesce(p_due_on, due_on) end,
    paid = coalesce(p_paid, paid),
    paid_on = case when 'paid_on' = any(v_clear) then null else coalesce(p_paid_on, paid_on) end,
    category = case when 'category' = any(v_clear) then null
                    else coalesce(nullif(btrim(coalesce(p_category, '')), ''), category) end,
    element_id = case when 'element_id' = any(v_clear) then null
                      else coalesce(p_element_id, element_id) end,
    inferred = v_inferred,
    updated_at = now()
  where id = p_review_id
  returning * into v_review;

  return v_review;
end;
$$;

revoke execute on function home.update_invoice_review(uuid, text, text, numeric,
  boolean, text, date, date, boolean, date, text, uuid, text[]) from public, anon;
grant execute on function home.update_invoice_review(uuid, text, text, numeric,
  boolean, text, date, date, boolean, date, text, uuid, text[]) to authenticated;
