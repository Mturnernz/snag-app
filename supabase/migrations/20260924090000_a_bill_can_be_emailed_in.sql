-- A bill can be emailed in, and it waits to be understood like any other.
--
-- `20260922100000` built the waiting room — `home.invoice_reviews`, a card per
-- bill somebody has seen and not yet ruled on — and nothing ever put a card in
-- it. This is the door: every project gets an address of its own, a forwarded
-- invoice lands as a pending review on that project, and the person opening the
-- project answers it. Nothing here reaches a figure. A pending review is not
-- money, and approving still goes through `create_quote`, the one door.
--
-- ------------------------------------------------ one address per project
--
-- `projects.inbox_token` is the local part of `<token>@bills.snaghq.co.nz`. One
-- per project rather than one per household, because the link between a bill
-- and its job is then a fact the address carries rather than a guess somebody
-- has to check — and a guessed job is the one field on the card most likely to
-- be approved without being read. Minted on first ask and never before, so a
-- project nobody has emailed has no address to leak.
--
-- The token is sixteen hex digits from a v4 UUID, and it is **not** the whole
-- security model: `inbox_for` below also requires the sender to be somebody on
-- that place. A token that leaks lets nobody else put a card on the project;
-- `rotate_project_inbox` exists so it can still be changed when it does.
--
-- ------------------------------------------------ the sender is a member
--
-- Only the addresses people sign in with are accepted. Forwarding is the
-- gesture: the bill arrives in somebody's own inbox, they forward it to the
-- job. Accepting mail from anyone who holds the address would turn a leaked
-- address into a way to put cards in front of somebody that look exactly like
-- their builder's — and the only defence would be reading every one, which is
-- the judgement this feature exists to make cheaper, not more expensive.
--
-- ------------------------------------------------ written by the function
--
-- The webhook arrives with no user session, so the edge function writes with the
-- service role through two functions nobody else can execute. They keep the
-- rules `create_invoice_review` keeps — a trimmed string is null, the paid flag
-- never travels without its sentence — and add the two an unattended writer
-- needs: one card per email however often the webhook is retried, and a daily
-- ceiling per household, because the key reading the invoice is the operator's.

alter table home.projects add column inbox_token text unique;

alter table home.invoice_reviews
  add column photo_paths text[] not null default '{}',
  add column document_paths text[] not null default '{}';

-- One card per email per job. The unique index `20260922100000` made includes
-- `invoice_number`, and a null there makes two rows distinct — so a retried
-- webhook for an invoice nobody could number would file it twice.
create unique index invoice_reviews_one_per_email
  on home.invoice_reviews (project_id, source_ref)
  where source_ref is not null;

-- ------------------------------------------------------------------ the address

create function home.project_inbox_token(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  perform home.require_project_member(p_project_id);

  select inbox_token into v_token from home.projects where id = p_project_id;
  if v_token is null then
    v_token := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
    update home.projects set inbox_token = v_token where id = p_project_id;
  end if;
  return v_token;
end;
$$;

revoke execute on function home.project_inbox_token(uuid) from public, anon;
grant execute on function home.project_inbox_token(uuid) to authenticated;

-- A new address, and the old one stops working. Its own function, because the
-- act that breaks an address somebody may have saved in their contacts must not
-- be reachable from the one that merely shows it.
create function home.rotate_project_inbox(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
begin
  perform home.require_project_member(p_project_id);
  update home.projects set inbox_token = v_token where id = p_project_id;
  return v_token;
end;
$$;

revoke execute on function home.rotate_project_inbox(uuid) from public, anon;
grant execute on function home.rotate_project_inbox(uuid) to authenticated;

-- --------------------------------------------------------- the function's side

-- Which job an address belongs to, and whether this sender may file on it.
-- Returns no row for an unknown token and a null `sender_id` for a sender who
-- is not on that place, so the function can log the two apart without either
-- ever reaching the card.
create function home.inbox_for(p_token text, p_from text)
returns table (project_id uuid, household_id uuid, sender_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.household_id,
    (select pm.profile_id
       from home.property_members pm
       join auth.users u on u.id = pm.profile_id
      where pm.property_id = p.property_id
        and lower(u.email) = lower(btrim(p_from))
      limit 1)
  from home.projects p
  where p.inbox_token = lower(btrim(p_token));
$$;

revoke execute on function home.inbox_for(text, text) from public, anon, authenticated;
grant execute on function home.inbox_for(text, text) to service_role;

create function home.file_emailed_bill(
  p_project_id uuid,
  p_sender_id uuid,
  p_source_ref text,
  p_source_subject text default null,
  p_source_from text default null,
  p_source_at timestamptz default null,
  p_supplier text default null,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default true,
  p_invoice_number text default null,
  p_dated date default null,
  p_due_on date default null,
  p_paid boolean default false,
  p_paid_on date default null,
  p_paid_evidence text default null,
  p_inferred text[] default '{}',
  p_photo_paths text[] default '{}',
  p_document_paths text[] default '{}'
)
returns home.invoice_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review home.invoice_reviews;
  v_household uuid;
  v_today integer;
begin
  if p_source_ref is null or btrim(p_source_ref) = '' then
    raise exception 'An emailed bill needs the email it came from';
  end if;

  select household_id into v_household from home.projects where id = p_project_id;
  if v_household is null then
    raise exception 'No such project';
  end if;

  -- The same email twice is the same card.
  select * into v_review from home.invoice_reviews
  where project_id = p_project_id and source_ref = p_source_ref;
  if v_review.id is not null then
    return v_review;
  end if;

  -- Fifty emailed bills a household a day. A renovation does not produce that
  -- many; a mail loop does.
  select count(*) into v_today
  from home.invoice_reviews r
  join home.projects p on p.id = r.project_id
  where p.household_id = v_household
    and r.source_ref is not null
    and r.created_at >= current_date;
  if v_today >= 50 then
    raise exception 'Too many emailed bills today';
  end if;

  insert into home.invoice_reviews (
    project_id, supplier, detail, amount, amount_incl_gst, invoice_number,
    dated, due_on, paid, paid_on, paid_evidence,
    source_ref, source_subject, source_from, source_at, inferred,
    photo_paths, document_paths, created_by
  )
  values (
    p_project_id,
    nullif(btrim(coalesce(p_supplier, '')), ''),
    nullif(btrim(coalesce(p_detail, '')), ''),
    p_amount,
    coalesce(p_amount_incl_gst, true),
    nullif(btrim(coalesce(p_invoice_number, '')), ''),
    p_dated, p_due_on,
    -- The paid inference never travels without the sentence it came from.
    coalesce(p_paid, false) and nullif(btrim(coalesce(p_paid_evidence, '')), '') is not null,
    case when coalesce(p_paid, false) then p_paid_on end,
    nullif(btrim(coalesce(p_paid_evidence, '')), ''),
    btrim(p_source_ref),
    nullif(btrim(coalesce(p_source_subject, '')), ''),
    nullif(btrim(coalesce(p_source_from, '')), ''),
    coalesce(p_source_at, now()),
    coalesce(p_inferred, '{}'),
    coalesce(p_photo_paths, '{}'),
    coalesce(p_document_paths, '{}'),
    p_sender_id
  )
  returning * into v_review;

  return v_review;
end;
$$;

revoke execute on function home.file_emailed_bill(uuid, uuid, text, text, text, timestamptz,
  text, text, numeric, boolean, text, date, date, boolean, date, text, text[], text[], text[])
  from public, anon, authenticated;
grant execute on function home.file_emailed_bill(uuid, uuid, text, text, text, timestamptz,
  text, text, numeric, boolean, text, date, date, boolean, date, text, text[], text[], text[])
  to service_role;

-- ------------------------------------------ approving carries the paperwork

-- Unchanged except for the last two arguments to `create_quote`: the invoice
-- that was emailed in becomes the bill's own paperwork, so it rolls up into the
-- project's files exactly as one attached by hand would.
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
    p_notes => v_review.invoice_number,
    p_photo_paths => v_review.photo_paths,
    p_document_paths => v_review.document_paths
  );

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
