-- A payment carries its own paperwork, and can be corrected
--
-- `home.project_payments` has always been the right row: money out, hanging off
-- the invoice it settles, so a deposit and a balance are two payments against
-- one bill and the double-count is unrepresentable. What it could not do was
-- hold the thing somebody is actually looking at when they record one.
--
-- A $15,000 quote gets invoiced in lots. The deposit goes out, then a progress
-- claim, then the balance — each with an invoice number on a piece of paper and
-- often a PDF of it. Until now the only way a payment existed at all was the
-- item sheet's *Paid* chip, which writes one payment for the whole outstanding
-- balance and knows nothing about any of that. So a part-paid bill had two
-- states in the app — all or nothing — and the three transfers that actually
-- happened lived in somebody's inbox.
--
-- Two columns and one function. Nothing about what a payment *means* changes:
-- it still settles an invoice and `add_payment` still refuses anything else in
-- words, because a payment against a price nobody has been billed for is the
-- sibling-row shape this table exists to end.

-- ------------------------------------------------------------ the paperwork
--
-- Same bucket, same layout, same four storage policies: `home-photos` under
-- `<household_id>/docs/`, reached through `HOUSEHOLD_FILES_BUCKET` and
-- `getFileUrl`. No second bucket, and not one storage policy changes.

alter table home.project_payments
  add column if not exists photo_paths text[] not null default '{}',
  add column if not exists document_paths text[] not null default '{}';

-- --------------------------------------------------------------- recording
--
-- The signature grows two arrays, so the old one is dropped rather than left
-- beside it: two functions with one name is two places a caller can land, and
-- the one that silently drops the attachments would be the one nothing tells
-- you about.

drop function if exists home.add_payment(uuid, numeric, boolean, date, text, text);

create function home.add_payment(
  p_quote_id uuid,
  p_amount numeric,
  p_amount_incl_gst boolean default true,
  p_paid_on date default null,
  p_reference text default null,
  p_notes text default null,
  p_photo_paths text[] default null,
  p_document_paths text[] default null
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
    quote_id, amount, amount_incl_gst, paid_on, reference, notes,
    photo_paths, document_paths, created_by
  )
  values (
    p_quote_id, p_amount, coalesce(p_amount_incl_gst, true), p_paid_on,
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(p_photo_paths, '{}'),
    coalesce(p_document_paths, '{}'),
    auth.uid()
  )
  returning * into v_payment;

  return v_payment;
end;
$$;

grant execute on function home.add_payment(
  uuid, numeric, boolean, date, text, text, text[], text[]
) to authenticated;

-- -------------------------------------------------------------- correcting
--
-- A transposed invoice number, a date read off the wrong statement line, a PDF
-- that arrived a week after the transfer. Without this the only fix is delete
-- and retype, which throws the attachments away with the typo.
--
-- `p_clear` is the schema's own convention, and it is here for the reason it is
-- everywhere else: null means *not touched*, so an emptied box needs some other
-- way to say *set it to nothing*. The amount is deliberately **not** clearable
-- — a payment with no figure is not a correction, it is a row that should not
-- exist, and `delete_payment` is how that is said.

create function home.update_payment(
  p_payment_id uuid,
  p_amount numeric default null,
  p_amount_incl_gst boolean default null,
  p_paid_on date default null,
  p_reference text default null,
  p_notes text default null,
  p_photo_paths text[] default null,
  p_document_paths text[] default null,
  p_clear text[] default '{}'
)
returns home.project_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment home.project_payments;
begin
  perform home.require_project_member(home.payment_project(p_payment_id));

  update home.project_payments set
    amount = coalesce(p_amount, amount),
    amount_incl_gst = coalesce(p_amount_incl_gst, amount_incl_gst),
    paid_on = case
      when 'paid_on' = any(p_clear) then null
      else coalesce(p_paid_on, paid_on)
    end,
    reference = case
      when 'reference' = any(p_clear) then null
      else coalesce(nullif(btrim(coalesce(p_reference, '')), ''), reference)
    end,
    notes = case
      when 'notes' = any(p_clear) then null
      else coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes)
    end,
    photo_paths = coalesce(p_photo_paths, photo_paths),
    document_paths = coalesce(p_document_paths, document_paths)
  where id = p_payment_id
  returning * into v_payment;

  if v_payment.id is null then
    raise exception 'No such payment';
  end if;

  return v_payment;
end;
$$;

grant execute on function home.update_payment(
  uuid, numeric, boolean, date, text, text, text[], text[], text[]
) to authenticated;

notify pgrst, 'reload schema';
