-- ============================================================================
-- What the maker says about a model, looked up once and checked before it is
-- shown.
-- ============================================================================
--
-- `read-label` used to answer "what does it take" and "how often is it
-- serviced" from the model's memory of the make and model. A plate does not
-- print its filter code, so that was the only place the answer could come
-- from — and it was a guess. Four reads of one Mitsubishi Electric
-- MSZ-GS60VFD plate on 27 September 2026 transcribed the plate identically
-- every time and suggested three different filter sets: two with part codes
-- (one belonging to a different range of heat pumps, one found nowhere), two
-- with none. Same photo, same model, no fallback in the logs: the variation
-- was the model's own sampling. A wrong part number is a wasted trip and a
-- reason to stop believing the record.
--
-- So the suggestion half of the reading is gone, and `lookup-product` replaces
-- it: a search of the maker's own website for the manual, the parts a
-- householder replaces and the service interval, where **every value is kept
-- only if the function has itself opened a page on the maker's own site that
-- states it for this model** (`verifyLookup`). Most of the time some of that is
-- nothing, and nothing is the honest answer.
--
-- **Kept here, once per make and model per household.** The answer is a fact
-- about the model, not about a photo, so a second scan — or a second heat pump
-- of the same model — gets the same answer rather than a fresh roll, and costs
-- nothing. Per household rather than shared across them, like everything else
-- this schema remembers: a shared table would tell one household what models
-- another owns, and there are not enough households for sharing to save
-- anything.
--
-- A waiting room like `label_readings`, never the record: nothing in it
-- reaches `home.things` until somebody taps it on the thing's page, through
-- `update_thing` like every other edit.
--
-- RLS on, a read policy for members, no write policies: the functions below
-- are the only writers, as everywhere in `home`.

/*
 * The key a make and model are remembered under. Case, spaces, dashes and
 * slashes are how two people write one model number differently —
 * "MSZ-GS60VFD" and "msz gs60vfd" are the same heat pump — so only letters and
 * digits count. Null when either half has none, because a lookup needs both.
 */
create function home.product_key(p_make text, p_model text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(regexp_replace(p_make, '[^[:alnum:]]', '', 'g'), '') = ''
      or coalesce(regexp_replace(p_model, '[^[:alnum:]]', '', 'g'), '') = ''
    then null
    else lower(regexp_replace(p_make, '[^[:alnum:]]', '', 'g'))
      || '|' || upper(regexp_replace(p_model, '[^[:alnum:]]', '', 'g'))
  end;
$$;

revoke execute on function home.product_key(text, text) from public, anon;
grant execute on function home.product_key(text, text) to authenticated;

create table home.product_lookups (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references home.households(id) on delete cascade,
  product_key text not null,
  -- As somebody wrote them, for the card's words. The key is what matches.
  make text not null,
  model text not null,
  -- `found`: something was confirmed. `nothing`: the search ran and nothing
  -- survived the checks — an answer, not a failure, and not asked again.
  status text not null default 'pending'
    check (status in ('pending', 'found', 'nothing', 'failed')),
  -- What survived `verifyLookup`: the manual, the service interval with the
  -- maker's own sentence, and the parts, each with the page it was found on.
  result jsonb,
  reason text check (reason is null or reason in ('busy', 'quota', 'error')),
  created_by uuid references home.profiles(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (household_id, product_key)
);

alter table home.product_lookups enable row level security;

create policy "members read their product lookups"
  on home.product_lookups for select using (home.is_member(household_id));

-- Named, because the platform's default privileges grant new tables to both.
revoke all on table home.product_lookups from anon, authenticated;
grant select on home.product_lookups to authenticated;

-- ------------------------------------------------------------------ the writes

/*
 * Opens a lookup for this make and model and returns its id — or null when
 * there is nothing to do: an answer is already kept (`found` or `nothing`), or
 * one is being looked up right now.
 *
 * **A kept answer is not looked up again unless somebody asks** (`p_again`),
 * and the client only offers that on a lookup that failed. Looking a model up
 * again on every scan is exactly how one heat pump came to have three answers.
 * A `pending` row older than three minutes is a lookup that died and is taken
 * over, the rule `label_readings_to_check` uses.
 */
create function home.begin_product_lookup(
  p_household_id uuid,
  p_make text,
  p_model text,
  p_again boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := home.product_key(p_make, p_model);
  v_row home.product_lookups;
  v_id uuid;
begin
  perform home.require_member(p_household_id);
  if v_key is null then
    raise exception 'A make and a model are needed to look it up';
  end if;

  select * into v_row from home.product_lookups
   where household_id = p_household_id and product_key = v_key
   for update;

  if found then
    if v_row.status = 'pending' and v_row.created_at > now() - interval '3 minutes' then
      return null;
    end if;
    if v_row.status in ('found', 'nothing') and not p_again then
      return null;
    end if;
    update home.product_lookups
       set status = 'pending', result = null, reason = null,
           make = btrim(p_make), model = btrim(p_model),
           created_by = auth.uid(), created_at = now(), finished_at = null
     where id = v_row.id;
    return v_row.id;
  end if;

  insert into home.product_lookups (household_id, product_key, make, model, created_by)
  values (p_household_id, v_key, btrim(p_make), btrim(p_model), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function home.begin_product_lookup(uuid, text, text, boolean) from public, anon;
grant execute on function home.begin_product_lookup(uuid, text, text, boolean) to authenticated;

/*
 * Records what the lookup came to. Only a pending one can finish, so a lookup
 * that was taken over after three minutes cannot land on top of the one that
 * replaced it.
 */
create function home.finish_product_lookup(
  p_id uuid,
  p_status text,
  p_result jsonb default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  if p_status not in ('found', 'nothing', 'failed') then
    raise exception 'A lookup finishes found, nothing or failed';
  end if;
  select household_id into v_household from home.product_lookups where id = p_id;
  if v_household is null then
    raise exception 'No such lookup';
  end if;
  perform home.require_member(v_household);

  update home.product_lookups
     set status = p_status,
         result = case when p_status = 'found' then p_result else null end,
         reason = case when p_status = 'failed' then coalesce(p_reason, 'error') else null end,
         finished_at = now()
   where id = p_id and status = 'pending';
end;
$$;

revoke execute on function home.finish_product_lookup(uuid, text, jsonb, text) from public, anon;
grant execute on function home.finish_product_lookup(uuid, text, jsonb, text) to authenticated;

-- ------------------------------------------------------------------- the read

/*
 * The lookup kept for this make and model, if any. SECURITY INVOKER, so the
 * read policy decides; the key is computed here and only here, so the client
 * cannot disagree with the writer about which model is which.
 *
 * A lookup still `pending` three minutes on is reported as failed: the
 * function gives the search a minute, so one that has not finished by then
 * never will.
 */
create function home.product_lookup(p_household_id uuid, p_make text, p_model text)
returns table (
  id uuid,
  make text,
  model text,
  status text,
  result jsonb,
  reason text,
  created_at timestamptz,
  finished_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    pl.id,
    pl.make,
    pl.model,
    case when pl.status = 'pending' and pl.created_at < now() - interval '3 minutes'
         then 'failed' else pl.status end,
    pl.result,
    case when pl.status = 'pending' and pl.created_at < now() - interval '3 minutes'
         then 'error' else pl.reason end,
    pl.created_at,
    pl.finished_at
  from home.product_lookups pl
  where pl.household_id = p_household_id
    and pl.product_key = home.product_key(p_make, p_model);
$$;

revoke execute on function home.product_lookup(uuid, text, text) from public, anon;
grant execute on function home.product_lookup(uuid, text, text) to authenticated;
