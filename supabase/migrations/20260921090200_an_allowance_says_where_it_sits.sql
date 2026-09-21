-- An allowance says where it sits, and what happens when somebody else prices it.
--
-- `is_allowance` recorded that a line was a placeholder. It could not record the
-- three things that decide what the placeholder is worth, and every one of them
-- is a number-sized lie when guessed:
--
--   1. **Is it inside the quoted total, or on top of it?** A builder who quotes
--      $150,000 "including a $10,000 laundry allowance" and one who quotes
--      $150,000 "and budget another $10,000 for the laundry" have said different
--      things, and the difference is $10,000. Nothing in the schema could tell
--      them apart.
--   2. **What kind of allowance?** A PC sum, a provisional sum and a builder's
--      ballpark behave differently at final account, and a householder reading
--      the contract back in March wants the word the contract used.
--   3. **Does the builder charge attendance or margin on it?** If the
--      cabinetmaker is paid direct, the $10,000 leaves the contract — but a 10%
--      attendance fee usually does not.
--
-- ---------------------------------------------------------------- what resolves
--
-- With `project_quotes.billed_through_id` from the previous migration, an
-- allowance line resolves four ways, and the distinction that matters most is
-- the last one:
--
--   * **Not superseded, inside the total** — contributes what was allowed, and
--     is counted in `allowance_open`. Committed, and flagged as soft. This is
--     what §3.4 means by *an allowance is not an unpriced item*: it is somebody's
--     written number inside a contract you have signed, so it counts.
--   * **Not superseded, additional** — contributes **nothing to committed**. It
--     is a ballpark nobody has agreed to, sitting outside a contract; it is the
--     same shape as an expected cost and it belongs in Forecast, not here.
--     Counted as `additional_open` so the forecast can pick it up and name it.
--   * **Superseded by an accepted quote billed *through* this contract** —
--     contributes what that quote actually came to. The builder is buying it and
--     billing it on, so it stays inside the contract sum.
--   * **Superseded by an accepted quote billed *direct*** — the allowance
--     **leaves** the contract, because the household is paying the sub itself
--     and the sub's own quote is already counted on its own account. What stays
--     behind is the attendance fee, if there is one. Counting both would be
--     §3.1's failure — *a rollup with two paths to sum through is how a total
--     starts disagreeing with itself* — arriving through the only door still
--     open to it.
--
-- A fixed price still does not move on an *unsuperseded* allowance: the builder
-- carries that variance and a real change costs a variation, which is a new
-- quote. But a PC sum being adjusted is not the same event as a fixed price
-- moving, and the schema now knows the difference, so `basis` no longer has to
-- carry both meanings.

create type home.project_allowance_kind as enum ('pc_sum', 'provisional', 'ballpark');

alter table home.project_quote_lines
  -- Null for an ordinary line. Set only where `is_allowance`, which the check
  -- below keeps honest — a kind on a line that is not an allowance is two
  -- columns disagreeing about what the row is.
  add column allowance_kind home.project_allowance_kind,
  -- False: inside the quoted total, the ordinary NZ case. True: on top of it.
  add column additional boolean not null default false,
  -- The margin the head contractor keeps when this is bought direct. Percent of
  -- the actual, never of the allowance — the builder's cut moves with the real
  -- price, which is the whole reason they ask for it.
  add column attendance_pct numeric(5, 2)
    check (attendance_pct is null or attendance_pct between 0 and 100),
  add constraint project_quote_lines_allowance_shape check (
    is_allowance or (allowance_kind is null and not additional and attendance_pct is null)
  );

-- The views that read these columns are rebuilt in the next migration rather
-- than here, and the reason is mechanical: `project_scope_money` is depended on
-- by the item, element and project rollups, so it cannot be dropped without
-- them. The whole stack comes down and goes back up in one place, which is also
-- the place `forecast` arrives — see `20260921090300`.

-- ---------------------------------------------------------------- the writes

drop function if exists home.add_quote_line(uuid, text, text, numeric, boolean, boolean);
drop function if exists home.update_quote_line(uuid, text, text, numeric, boolean, boolean, text[]);

create function home.add_quote_line(
  p_quote_id uuid,
  p_name text,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default true,
  p_is_allowance boolean default false,
  p_allowance_kind home.project_allowance_kind default null,
  p_additional boolean default false,
  p_attendance_pct numeric default null
)
returns home.project_quote_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line home.project_quote_lines;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_allowance boolean := coalesce(p_is_allowance, false);
  v_next integer;
begin
  perform home.require_project_member(home.quote_project(p_quote_id));

  if v_name is null then
    raise exception 'Give the line a name — what the quote calls it';
  end if;

  -- Said in words rather than left to `project_quote_lines_allowance_shape`.
  if not v_allowance
     and (p_allowance_kind is not null or coalesce(p_additional, false)
          or p_attendance_pct is not null) then
    raise exception 'Only an allowance can sit outside the total or carry a margin';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next
  from home.project_quote_lines where quote_id = p_quote_id;

  insert into home.project_quote_lines (
    quote_id, name, detail, amount, amount_incl_gst, is_allowance,
    allowance_kind, additional, attendance_pct, sort_order, created_by
  )
  values (
    p_quote_id, v_name,
    nullif(btrim(coalesce(p_detail, '')), ''),
    p_amount, coalesce(p_amount_incl_gst, true),
    v_allowance,
    case when v_allowance then coalesce(p_allowance_kind, 'ballpark') end,
    v_allowance and coalesce(p_additional, false),
    case when v_allowance then p_attendance_pct end,
    v_next, auth.uid()
  )
  returning * into v_line;

  return v_line;
end;
$$;

grant execute on function home.add_quote_line(
  uuid, text, text, numeric, boolean, boolean, home.project_allowance_kind, boolean, numeric
) to authenticated;

create function home.update_quote_line(
  p_line_id uuid,
  p_name text default null,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default null,
  p_is_allowance boolean default null,
  p_clear text[] default '{}',
  p_allowance_kind home.project_allowance_kind default null,
  p_additional boolean default null,
  p_attendance_pct numeric default null
)
returns home.project_quote_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line home.project_quote_lines;
  v_clear text[] := coalesce(p_clear, '{}');
  v_project uuid := home.line_project(p_line_id);
  v_allowance boolean;
begin
  if v_project is null then
    raise exception 'No such line';
  end if;

  perform home.require_project_member(v_project);

  select coalesce(p_is_allowance, is_allowance) into v_allowance
  from home.project_quote_lines where id = p_line_id;

  update home.project_quote_lines set
    name            = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    detail          = case when 'detail' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_detail, '')), ''), detail) end,
    amount          = case when 'amount' = any(v_clear) then null
                           else coalesce(p_amount, amount) end,
    amount_incl_gst = coalesce(p_amount_incl_gst, amount_incl_gst),
    is_allowance    = v_allowance,
    -- A line that stops being an allowance drops all three, or the constraint
    -- would refuse the write with a name nobody can act on.
    allowance_kind  = case when not v_allowance then null
                           when 'allowance_kind' = any(v_clear) then null
                           else coalesce(p_allowance_kind, allowance_kind, 'ballpark') end,
    additional      = case when not v_allowance then false
                           else coalesce(p_additional, additional) end,
    attendance_pct  = case when not v_allowance then null
                           when 'attendance_pct' = any(v_clear) then null
                           else coalesce(p_attendance_pct, attendance_pct) end,
    updated_at      = now()
  where id = p_line_id
  returning * into v_line;

  return v_line;
end;
$$;

grant execute on function home.update_quote_line(
  uuid, text, text, numeric, boolean, boolean, text[],
  home.project_allowance_kind, boolean, numeric
) to authenticated;

notify pgrst, 'reload schema';
