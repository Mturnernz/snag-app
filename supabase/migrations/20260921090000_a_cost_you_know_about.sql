-- A cost you know about, that nobody has quoted.
--
-- The architect says: "you'll need an engineer, and the council will want
-- their share." No vendor, no quote, no invoice — just a number somebody who
-- knows the industry told you to expect.
--
-- Until now there were two places to put that and both were wrong. An **item
-- with no price** contributes nought to every figure on the page, so a cost the
-- household knows about is recorded as zero — which is what happened on the
-- live job with *Geotech engineer*, sitting there at `considering` with no
-- amount while everyone's mental arithmetic carried $4,000 for it. Or a **quote
-- nobody gave you**, which is a fabricated commitment against a vendor who has
-- never heard of you, and which would then show up under *who's owed what*.
--
-- So: a third kind of row, and the only one in this feature whose number is
-- allowed to be somebody's estimate.
--
-- **It is never committed and never invoiced.** It feeds Forecast alone, and
-- every figure it touches names it as a guess. That is the same discipline
-- `allowance_open` already carries — with the distinction §3.4 draws and which
-- must not blur: an **allowance** is a written number inside a contract you
-- have signed, so it counts as committed and is flagged as soft; an **expected
-- cost** is not committed at all, because nobody has agreed to anything.
--
-- **It is replaced, not added to.** The moment a real quote or invoice arrives,
-- `settled_by` points at it and the expected cost stops counting — otherwise
-- the forecast double-counts as the job firms up, which is the failure the
-- allowance rule already names one level down. It is kept rather than deleted
-- because "we thought the engineer would be $4,000 and it was $5,600" is the
-- sentence that makes the next renovation's guesses better, and it is the only
-- place this app can learn that.

create table home.project_expected_costs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references home.projects(id) on delete cascade,
  -- Optionally against a part, so a forecast can be read per room. Null is the
  -- ordinary case: council fees belong to the job, not to the bathroom.
  element_id uuid references home.project_elements(id) on delete set null,

  name text not null check (length(btrim(name)) between 1 and 120),
  -- Nullable, deliberately. "There will be council costs" with no figure yet is
  -- still worth recording: it appears on the page as a named gap rather than
  -- being silently absent, and the forecast says how many such gaps it holds.
  amount numeric(12, 2) check (amount is null or amount between 0 and 99999999),
  amount_incl_gst boolean not null default true,
  -- Who it will probably come from, if that is known. Free text and usually
  -- empty — it is a hint, not a supplier, and it deliberately does not appear
  -- in the supplier rollup, because you cannot owe money to a guess.
  likely_supplier text check (likely_supplier is null or length(btrim(likely_supplier)) <= 120),
  note text check (note is null or length(btrim(note)) <= 2000),

  -- The real thing, once it exists. On delete set null rather than cascade: if
  -- somebody removes the engineer's invoice, the expectation of an engineer
  -- comes back rather than vanishing with it.
  settled_by uuid references home.project_quotes(id) on delete set null,

  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on home.project_expected_costs (project_id);
create index on home.project_expected_costs (element_id);
create index on home.project_expected_costs (settled_by);

alter table home.project_expected_costs enable row level security;

create policy "members read their expected costs"
  on home.project_expected_costs for select using (
    exists (
      select 1 from home.projects p
      where p.id = home.project_expected_costs.project_id
    )
  );

grant select on home.project_expected_costs to authenticated;

-- ---------------------------------------------------------------- the writes

create function home.expected_cost_project(p_expected_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select project_id from home.project_expected_costs where id = p_expected_id;
$$;

revoke execute on function home.expected_cost_project(uuid) from public, anon, authenticated;

create function home.create_expected_cost(
  p_project_id uuid,
  p_name text,
  p_amount numeric default null,
  p_amount_incl_gst boolean default true,
  p_element_id uuid default null,
  p_likely_supplier text default null,
  p_note text default null
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
    project_id, element_id, name, amount, amount_incl_gst, likely_supplier, note, created_by
  )
  values (
    p_project_id, p_element_id, btrim(p_name), p_amount,
    coalesce(p_amount_incl_gst, true),
    nullif(btrim(coalesce(p_likely_supplier, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function home.create_expected_cost(uuid, text, numeric, boolean, uuid, text, text)
  to authenticated;

-- `p_clear` names the columns being emptied, the same convention `update_snag`
-- and `update_thing` use: an emptied amount is somebody saying they no longer
-- have a figure, which is different from not having touched the field.
create function home.update_expected_cost(
  p_expected_id uuid,
  p_name text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default null,
  p_element_id uuid default null,
  p_likely_supplier text default null,
  p_note text default null,
  p_settled_by uuid default null,
  p_clear text[] default '{}'
)
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

  if p_element_id is not null
     and home.element_project(p_element_id) is distinct from v_project then
    raise exception 'That part belongs to a different job';
  end if;

  -- The row it is settled by has to be in this job, or a forecast here would be
  -- cancelled by a price somewhere else.
  if p_settled_by is not null
     and home.quote_project(p_settled_by) is distinct from v_project then
    raise exception 'That price belongs to a different job';
  end if;

  update home.project_expected_costs set
    name            = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    amount          = case when 'amount' = any(p_clear) then null
                           else coalesce(p_amount, amount) end,
    amount_incl_gst = coalesce(p_amount_incl_gst, amount_incl_gst),
    element_id      = case when 'element_id' = any(p_clear) then null
                           else coalesce(p_element_id, element_id) end,
    likely_supplier = case when 'likely_supplier' = any(p_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_likely_supplier, '')), ''), likely_supplier) end,
    note            = case when 'note' = any(p_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_note, '')), ''), note) end,
    settled_by      = case when 'settled_by' = any(p_clear) then null
                           else coalesce(p_settled_by, settled_by) end,
    updated_at      = now()
  where id = p_expected_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function home.update_expected_cost(
  uuid, text, numeric, boolean, uuid, text, text, uuid, text[]
) to authenticated;

create function home.delete_expected_cost(p_expected_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project uuid := home.expected_cost_project(p_expected_id);
begin
  if v_project is null then
    raise exception 'No such expected cost';
  end if;

  perform home.require_project_member(v_project);

  delete from home.project_expected_costs where id = p_expected_id;
end;
$$;

grant execute on function home.delete_expected_cost(uuid) to authenticated;

notify pgrst, 'reload schema';
