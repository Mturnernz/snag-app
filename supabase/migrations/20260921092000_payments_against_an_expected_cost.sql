-- Payments against a cost you knew about, before it ever got a quote.
--
-- The architect was recorded as one expected line — "Geotech engineer", a
-- guess at $4,000 — and stays that way right up until money actually moves.
-- But a household knows more than a single figure while nothing has been
-- quoted or invoiced: an initial payment on account, a second instalment,
-- each with a reference number and possibly a receipt photo. `settled_by`
-- only ever points at one real quote, so it cannot hold that.
--
-- `project_expected_cost_lines` is deliberately thin — the record this
-- feature keeps everywhere else is a household's own words against a price,
-- not a second commitments engine. Kept simple on purpose: free text name,
-- free text reference, a value, and somewhere to put a photo or a document.
-- It is never committed, never invoiced and never counted in the forecast —
-- the parent expected cost still carries the one guessed figure that feeds
-- Forecast, and these lines are the record of what has actually gone out
-- against it, read the way a bank statement is read rather than priced.

create table home.project_expected_cost_lines (
  id uuid primary key default gen_random_uuid(),
  expected_cost_id uuid not null references home.project_expected_costs(id) on delete cascade,

  name text not null check (length(btrim(name)) between 1 and 120),
  reference text check (reference is null or length(btrim(reference)) <= 80),
  amount numeric(12, 2) check (amount is null or amount between 0 and 99999999),
  amount_incl_gst boolean not null default true,

  photo_paths text[] not null default '{}',
  document_paths text[] not null default '{}',

  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on home.project_expected_cost_lines (expected_cost_id);

alter table home.project_expected_cost_lines enable row level security;

create policy "members read expected cost lines"
  on home.project_expected_cost_lines for select using (
    exists (
      select 1 from home.project_expected_costs x
      where x.id = home.project_expected_cost_lines.expected_cost_id
    )
  );

grant select on home.project_expected_cost_lines to authenticated;

-- ---------------------------------------------------------------- the writes

create function home.expected_cost_line_project(p_line_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select x.project_id
  from home.project_expected_cost_lines l
  join home.project_expected_costs x on x.id = l.expected_cost_id
  where l.id = p_line_id;
$$;

revoke execute on function home.expected_cost_line_project(uuid) from public, anon, authenticated;

create function home.add_expected_cost_line(
  p_expected_cost_id uuid,
  p_name text,
  p_reference text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default true,
  p_photo_paths text[] default '{}',
  p_document_paths text[] default '{}'
)
returns home.project_expected_cost_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid;
  v_row home.project_expected_cost_lines;
begin
  select project_id into v_project
  from home.project_expected_costs where id = p_expected_cost_id;

  if v_project is null then
    raise exception 'No such expected cost';
  end if;

  perform home.require_project_member(v_project);

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give it a name — who was it paid to, or what for?';
  end if;

  insert into home.project_expected_cost_lines (
    expected_cost_id, name, reference, amount, amount_incl_gst,
    photo_paths, document_paths, created_by
  )
  values (
    p_expected_cost_id, btrim(p_name),
    nullif(btrim(coalesce(p_reference, '')), ''),
    p_amount, coalesce(p_amount_incl_gst, true),
    coalesce(p_photo_paths, '{}'), coalesce(p_document_paths, '{}'),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function home.add_expected_cost_line(
  uuid, text, text, numeric, boolean, text[], text[]
) to authenticated;

create function home.update_expected_cost_line(
  p_line_id uuid,
  p_name text default null,
  p_reference text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default null,
  p_photo_paths text[] default null,
  p_document_paths text[] default null,
  p_clear text[] default '{}'
)
returns home.project_expected_cost_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := home.expected_cost_line_project(p_line_id);
  v_row home.project_expected_cost_lines;
begin
  if v_project is null then
    raise exception 'No such payment line';
  end if;

  perform home.require_project_member(v_project);

  update home.project_expected_cost_lines set
    name            = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    reference       = case when 'reference' = any(p_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_reference, '')), ''), reference) end,
    amount          = case when 'amount' = any(p_clear) then null
                           else coalesce(p_amount, amount) end,
    amount_incl_gst = coalesce(p_amount_incl_gst, amount_incl_gst),
    photo_paths     = coalesce(p_photo_paths, photo_paths),
    document_paths  = coalesce(p_document_paths, document_paths),
    updated_at      = now()
  where id = p_line_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function home.update_expected_cost_line(
  uuid, text, text, numeric, boolean, text[], text[], text[]
) to authenticated;

create function home.delete_expected_cost_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := home.expected_cost_line_project(p_line_id);
begin
  if v_project is null then
    raise exception 'No such payment line';
  end if;

  perform home.require_project_member(v_project);

  delete from home.project_expected_cost_lines where id = p_line_id;
end;
$$;

grant execute on function home.delete_expected_cost_line(uuid) to authenticated;

notify pgrst, 'reload schema';
