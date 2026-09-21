-- A number you can type over, and the app saying so in red.
--
-- Every figure on the project page is **derived in the views, never stored**, and
-- that is not an implementation detail — it is the rule the whole feature rests
-- on. A maintained total and the quotes it describes will disagree the first
-- time somebody edits an amount from the other phone, and the one that people
-- would trust is the wrong one.
--
-- So this does not store a total. It stores an **override**, beside the derived
-- figure, and keeps computing the derived figure exactly as before:
--
--   * `committed_derived` is still what the prices add up to. Nothing about how
--     it is computed has changed, and nothing downstream reads a stored total in
--     its place.
--   * `committed_override` is what somebody typed.
--   * `committed_total` is `coalesce(override, derived)` — what the page shows.
--
-- **The divergence is a fact the schema holds, not a thing the screen forgets.**
-- Both numbers survive, so the page can say *"$200,000 typed · the prices say
-- $163,000 — $37,000 more"* forever, and so an override can be lifted and the
-- truth is still there underneath. A stored total that replaced its own evidence
-- would be unrecoverable; this is a sticky note on the glass.
--
-- Three rules follow, and each one is the difference between an override and a
-- lie:
--
--   1. **The page never contradicts itself.** The gaps and the forecast are
--      computed from the *shown* figures, not the derived ones. Override
--      Committed and leave `still_to_bill` reading off the derived figure, and
--      two numbers one line apart stop adding up — which is precisely the
--      failure overriding is supposed to be honest about.
--   2. **A part's override rolls up.** An element's shown total feeds the
--      project's derived total, or the project figure contradicts the sum of the
--      parts listed directly beneath it.
--   3. **Suppliers are not overridable, deliberately.** *Who we're paying* is a
--      second view over the same rule, and the check worth keeping is that those
--      rows sum to Committed. An override there could not be reconciled with
--      anything — it would be a number owed to a named person that no price
--      supports. Override the total if you must; who you owe stays what the
--      paperwork says.

create type home.project_figure as enum ('forecast', 'committed', 'invoiced', 'paid');

create table home.project_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references home.projects(id) on delete cascade,
  -- Null overrides the project's own figure; set, it overrides that part's.
  element_id uuid references home.project_elements(id) on delete cascade,

  field home.project_figure not null,
  amount numeric(12, 2) not null check (amount between 0 and 99999999),
  -- Every money box in this app carries the pill and there is no household-wide
  -- GST setting. An override is a money box like any other.
  amount_incl_gst boolean not null default true,
  -- Why. Optional, and the one piece of this a reader eight months later will
  -- actually want — "builder confirmed the variation by email, 12 Sept".
  note text check (note is null or length(btrim(note)) <= 2000),

  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One override per figure per level. A second would be two numbers claiming to
-- be the same corrected total, which is the disagreement this table exists to
-- make visible rather than to reproduce.
create unique index project_overrides_one_per_project
  on home.project_overrides (project_id, field) where element_id is null;
create unique index project_overrides_one_per_element
  on home.project_overrides (element_id, field) where element_id is not null;

create index on home.project_overrides (project_id);

alter table home.project_overrides enable row level security;

create policy "members read their overrides"
  on home.project_overrides for select using (
    exists (
      select 1 from home.projects p
      where p.id = home.project_overrides.project_id
    )
  );

grant select on home.project_overrides to authenticated;

-- ---------------------------------------------------------------- the writes

create function home.set_figure(
  p_project_id uuid,
  p_field home.project_figure,
  p_amount numeric,
  p_amount_incl_gst boolean default true,
  p_element_id uuid default null,
  p_note text default null
)
returns home.project_overrides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row home.project_overrides;
begin
  perform home.require_project_member(p_project_id);

  if p_amount is null then
    raise exception 'Give a figure, or clear the edit instead';
  end if;

  if p_element_id is not null then
    if home.element_project(p_element_id) is distinct from p_project_id then
      raise exception 'That part belongs to a different job';
    end if;
    -- A part has no forecast on screen, and an override nothing can display is
    -- an edit that silently does nothing — worse than a refusal, because the
    -- person believes they changed a number.
    if p_field = 'forecast' then
      raise exception 'A part has no forecast of its own — edit the job’s';
    end if;
  end if;

  -- Upsert by hand rather than `on conflict`, because the uniqueness is carried
  -- by two partial indexes and neither is a single inferable conflict target.
  update home.project_overrides set
    amount          = p_amount,
    amount_incl_gst = coalesce(p_amount_incl_gst, true),
    note            = nullif(btrim(coalesce(p_note, '')), ''),
    updated_at      = now()
  where project_id = p_project_id
    and field = p_field
    and element_id is not distinct from p_element_id
  returning * into v_row;

  if found then
    return v_row;
  end if;

  insert into home.project_overrides (
    project_id, element_id, field, amount, amount_incl_gst, note, created_by
  )
  values (
    p_project_id, p_element_id, p_field, p_amount,
    coalesce(p_amount_incl_gst, true),
    nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function home.set_figure(
  uuid, home.project_figure, numeric, boolean, uuid, text
) to authenticated;

-- Lifting an edit is its own function, not `set_figure(null)`. Clearing is the
-- act that puts the derived figure back on screen, and it should not be
-- reachable by accident from a form that happened to be emptied.
create function home.clear_figure(
  p_project_id uuid,
  p_field home.project_figure,
  p_element_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_project_member(p_project_id);

  delete from home.project_overrides
  where project_id = p_project_id
    and field = p_field
    and element_id is not distinct from p_element_id;
end;
$$;

grant execute on function home.clear_figure(uuid, home.project_figure, uuid) to authenticated;

notify pgrst, 'reload schema';
