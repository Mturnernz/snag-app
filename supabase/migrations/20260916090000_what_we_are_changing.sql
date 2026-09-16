-- Projects: what we're *changing*, beside what's wrong and what's there.
--
-- The list holds what is wrong with the house. The House tab holds what is in
-- it. Neither can hold a renovation — a body of work with a budget, a span of
-- rooms, a folder of quotes and an answer to "what did the bathroom actually
-- cost". That is this.
--
-- **Four levels, and the rule that stops them being four.** A downstairs
-- laundry renovation is a bathroom, a laundry and a storage area; the bathroom
-- is a toilet, a shower mixer, tiles and waterproofing; the toilet is three
-- quotes of which one gets chosen. Storing that needs four tables. *Showing* it
-- needs two, because of `implicit`:
--
--   A middle layer appears only when it earns its place.
--
-- Every project gets an element the moment it is created — named after the room
-- when one room was chosen, after the project itself when none was — and that
-- element is flagged `implicit`. The client does not draw an implicit element;
-- it draws its items directly under the project. Adding a second element clears
-- the flag on every element of that project and the layer becomes visible, at
-- the moment somebody actually made it exist. The same shape repeats at the
-- bottom: an item with one quote shows that number inline and never says the
-- word "quote".
--
-- The alternative — a nullable `element_id` on an item — was rejected because it
-- gives the rollup two paths to sum through, which is how a total starts
-- disagreeing with itself.
--
-- **Money is numeric here, and that is a departure.** `home.snag_advice` keeps
-- costs as *text*, quoted back with the date, because parsing "180-260" into a
-- number is the app asserting a precision the answer never had. A project cannot
-- do that: rolling elements up into a total is the entire reason elements exist.
-- So amounts are numeric, and they buy that with three rules, two of which are
-- enforced here and the third of which is enforced by there being no code for it:
--
--   1. **A total always ships its denominator.** Every rollup view carries
--      `item_count` and `priced_count` beside its sums, so no caller can render
--      `$8,990` without being handed `5 of 9 items priced` in the same row. A
--      renovation total assembled from half the items is the most misleading
--      number this app could show, and it misleads in the direction that costs
--      money.
--   2. **An unpriced item is not zero.** It is counted and excluded. `sum` over
--      no rows is null here, never 0 — `coalesce` is applied only where the
--      answer genuinely is nothing.
--   3. **Nothing reads a figure out of an attachment.** Every amount is typed by
--      somebody who looked at the quote. There is deliberately no function here
--      that takes a document and returns a number.
--
-- **GST is a property of each amount, not of the household.** New Zealand quotes
-- come both ways and the difference is 15% — which is the difference between a
-- renovation on budget and one $2,000 over. So every money column is a pair:
-- the number as it was typed, and whether that number already includes GST. The
-- rollups normalise to **inclusive**, because that is what leaves the bank
-- account, and `home.incl_gst` is the one place the arithmetic happens.
--
-- **Files belong to exactly one level, and they roll up rather than down.** A
-- council consent belongs to the project; a tiling quote belongs to the item it
-- prices. The project's paperwork view shows both, because everything under a
-- project is part of that project's record — but opening the element does not
-- show the project's consent, because that document is not about the bathroom.
-- `home.project_files` is the union that does it, and it names which level each
-- file came from so a list can say where it lives.
--
-- Storage reuses `home-photos` and the `<household_id>/...` layout, so not one
-- storage policy changes: `home.can_use_photo_folder` already answers for the
-- folder every one of these files lands in, and `application/pdf` was added to
-- the bucket's allow-list by `20260914090000`.

-- ---------------------------------------------------------------- enums

create type home.project_status as enum ('planned', 'underway', 'done');

-- Never 'done'. That word belongs to snags, and an item that has been installed
-- is not the same claim as a job that has been finished — the renovation can be
-- installed and still wrong, which is what the snags hanging off it are for.
create type home.project_item_status as enum ('considering', 'chosen', 'ordered', 'installed');

-- What a piece of paper *is*. A quote is what something might cost; an invoice
-- and a receipt are what it did. Only the second two count towards "spent".
create type home.project_quote_kind as enum ('quote', 'invoice', 'receipt');

-- ---------------------------------------------------------------- the money

-- The one place 15% lives.
--
-- Immutable and granted to `authenticated` rather than revoked, unlike the other
-- helpers in this schema: the rollup views are `security_invoker`, so their
-- expressions are evaluated as the *calling* role and a revoked EXECUTE here
-- would raise `42501 permission denied for function incl_gst` on every read
-- rather than returning fewer rows. That is exactly what `20260911093000` exists
-- to remember.
create function home.incl_gst(p_amount numeric, p_incl boolean)
returns numeric
language sql
immutable
as $$
  select case
    when p_amount is null then null
    when p_incl then round(p_amount, 2)
    else round(p_amount * 1.15, 2)
  end;
$$;

grant execute on function home.incl_gst(numeric, boolean) to authenticated;

-- ---------------------------------------------------------------- projects

create table home.projects (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references home.households(id) on delete cascade,
  -- A project belongs to one place. Solar across the house and the bach is two
  -- projects, for the same reason a snag is about one place: the read policies,
  -- the room vocabulary and the people who can see it are all per property.
  property_id uuid not null references home.properties(id) on delete cascade,

  name text not null check (length(btrim(name)) between 1 and 80),
  summary text check (summary is null or length(btrim(summary)) <= 2000),
  status home.project_status not null default 'planned',

  -- Three dates, all optional, none of them a schedule. This is a record of
  -- when, not a second scheduler — `due_at` + `repeat_days` on a snag is the
  -- only scheduling mechanism in this app and it stays the only one.
  started_on date,
  target_on date,
  finished_on date,

  -- Optional, and a pair like every other amount here.
  budget numeric(12, 2) check (budget is null or budget between 0 and 99999999),
  budget_incl_gst boolean not null default true,

  photo_paths text[] not null default '{}',
  document_paths text[] not null default '{}',

  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references home.profiles(id)
);

create index on home.projects (property_id, status);
create index on home.projects (household_id);

alter table home.projects enable row level security;

create policy "members read their projects"
  on home.projects for select using (home.is_property_member(property_id));

grant select on home.projects to authenticated;

-- ---------------------------------------------------------------- elements

create table home.project_elements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references home.projects(id) on delete cascade,

  name text not null check (length(btrim(name)) between 1 and 80),
  -- TEXT, for exactly the reason `snags.room` and `things.room` are: removing a
  -- room tag must never rewrite what is filed under it.
  room text check (room is null or length(btrim(room)) between 1 and 60),

  -- The layer's visibility, stored rather than derived.
  --
  -- Derived ("is this the only element") was the first shape and it is wrong:
  -- deleting the second of two elements would silently re-hide the first, which
  -- had a name somebody chose and paperwork attached to it. Once a person has
  -- seen the layer, it stays.
  implicit boolean not null default false,

  sort_order integer not null default 0,
  notes text check (notes is null or length(btrim(notes)) <= 2000),

  photo_paths text[] not null default '{}',
  document_paths text[] not null default '{}',

  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on home.project_elements (project_id, sort_order);

alter table home.project_elements enable row level security;

-- A child asks its project's property. Deliberately through `is_property_member`
-- and a join rather than through `home.project_property`, which is SECURITY
-- DEFINER and stays revoked: a policy expression runs as the calling role.
create policy "members read their project elements"
  on home.project_elements for select using (
    exists (
      select 1 from home.projects p
      where p.id = home.project_elements.project_id
        and home.is_property_member(p.property_id)
    )
  );

grant select on home.project_elements to authenticated;

-- ---------------------------------------------------------------- items

create table home.project_items (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references home.project_elements(id) on delete cascade,

  name text not null check (length(btrim(name)) between 1 and 80),
  status home.project_item_status not null default 'considering',
  sort_order integer not null default 0,
  notes text check (notes is null or length(btrim(notes)) <= 2000),

  photo_paths text[] not null default '{}',
  document_paths text[] not null default '{}',

  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on home.project_items (element_id, sort_order);

alter table home.project_items enable row level security;

create policy "members read their project items"
  on home.project_items for select using (
    exists (
      select 1
      from home.project_elements e
      join home.projects p on p.id = e.project_id
      where e.id = home.project_items.element_id
        and home.is_property_member(p.property_id)
    )
  );

grant select on home.project_items to authenticated;

-- ---------------------------------------------------------------- quotes

create table home.project_quotes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references home.project_items(id) on delete cascade,

  supplier text check (supplier is null or length(btrim(supplier)) between 1 and 80),
  -- What the supplier is offering — "Methven Krome", "Caroma Luna". Optional,
  -- because most of the time the item's own name is the whole answer.
  detail text check (detail is null or length(btrim(detail)) <= 200),

  amount numeric(12, 2) check (amount is null or amount between 0 and 99999999),
  -- The pair. Every screen that shows an amount shows this beside it, because
  -- "$1,150" means two different numbers and the difference is 15%.
  amount_incl_gst boolean not null default true,

  kind home.project_quote_kind not null default 'quote',
  -- Which one was picked. Settable on any kind, because sometimes the first
  -- piece of paper on an item is the invoice — you bought it and moved on.
  chosen boolean not null default false,
  dated date,
  notes text check (notes is null or length(btrim(notes)) <= 2000),

  photo_paths text[] not null default '{}',
  document_paths text[] not null default '{}',

  created_by uuid not null references home.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on home.project_quotes (item_id);

-- One chosen quote per item, enforced rather than hoped for: two chosen rows
-- would make the item's contribution to the project total depend on row order.
create unique index project_quotes_one_chosen
  on home.project_quotes (item_id) where chosen;

alter table home.project_quotes enable row level security;

create policy "members read their project quotes"
  on home.project_quotes for select using (
    exists (
      select 1
      from home.project_items i
      join home.project_elements e on e.id = i.element_id
      join home.projects p on p.id = e.project_id
      where i.id = home.project_quotes.item_id
        and home.is_property_member(p.property_id)
    )
  );

grant select on home.project_quotes to authenticated;

-- ---------------------------------------------------------------- helpers
--
-- Called only from inside the SECURITY DEFINER functions below, which run as the
-- owner — so the caller's EXECUTE is never consulted and stays revoked. Same
-- shape and same reasoning as `home.snag_property` and `home.thing_property`.

create function home.project_property(p_project_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.property_id from home.projects p where p.id = p_project_id;
$$;

revoke execute on function home.project_property(uuid) from public, anon, authenticated;

create function home.element_project(p_element_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.project_id from home.project_elements e where e.id = p_element_id;
$$;

revoke execute on function home.element_project(uuid) from public, anon, authenticated;

create function home.item_project(p_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.project_id
  from home.project_items i
  join home.project_elements e on e.id = i.element_id
  where i.id = p_item_id;
$$;

revoke execute on function home.item_project(uuid) from public, anon, authenticated;

create function home.quote_project(p_quote_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.project_id
  from home.project_quotes q
  join home.project_items i on i.id = q.item_id
  join home.project_elements e on e.id = i.element_id
  where q.id = p_quote_id;
$$;

revoke execute on function home.quote_project(uuid) from public, anon, authenticated;

-- Every write below starts here: you may write to a project if you can see the
-- place it belongs to. There are no roles in this app and there is no owner of a
-- project — any member of the household linked to the place can contribute,
-- which is the whole point of a shared record.
create function home.require_project_member(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property uuid := home.project_property(p_project_id);
begin
  if v_property is null then
    raise exception 'No such project';
  end if;
  perform home.require_property_member(v_property);
end;
$$;

revoke execute on function home.require_project_member(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the rollups
--
-- Every figure a screen shows about money is computed here, in the views, and
-- never stored on a row. That is the `needs_parts` argument applied to a much
-- more dangerous number: a maintained total and the quotes it describes will
-- disagree the first time somebody edits an amount from the other phone, and a
-- renovation budget that is quietly wrong is worse than no budget at all.
--
-- Every level carries `item_count` and `priced_count` beside its sums, so no
-- caller can render a total without being handed its denominator in the same
-- row. That is rule one, made structural.
--
-- The columns are written out one by one rather than `select i.*`, because a
-- star freezes at creation: `20260914140000` already paid for that lesson on
-- `things_with_details`, where `document_paths` was added two days later and
-- was silently missing from every read in the app.

create view home.project_items_with_totals
with (security_invoker = true)
as
select
  i.id,
  i.element_id,
  i.name,
  i.status,
  i.sort_order,
  i.notes,
  i.photo_paths,
  i.document_paths,
  i.created_by,
  i.created_at,
  i.updated_at,
  (select count(*) from home.project_quotes q where q.item_id = i.id)
    as quote_count,
  -- What this item is going to cost: the amount on the quote somebody picked,
  -- normalised to GST-inclusive. Null when nothing is picked — never zero.
  (select home.incl_gst(q.amount, q.amount_incl_gst)
     from home.project_quotes q
    where q.item_id = i.id and q.chosen)
    as chosen_amount,
  (select min(home.incl_gst(q.amount, q.amount_incl_gst))
     from home.project_quotes q
    where q.item_id = i.id and q.amount is not null)
    as quoted_low,
  (select max(home.incl_gst(q.amount, q.amount_incl_gst))
     from home.project_quotes q
    where q.item_id = i.id and q.amount is not null)
    as quoted_high,
  -- What has actually left the bank. Only invoices and receipts count: a quote
  -- is what something might cost, and adding it here would have every project
  -- read as fully paid the day it was priced.
  (select sum(home.incl_gst(q.amount, q.amount_incl_gst))
     from home.project_quotes q
    where q.item_id = i.id
      and q.amount is not null
      and q.kind in ('invoice', 'receipt'))
    as spent
from home.project_items i;

grant select on home.project_items_with_totals to authenticated;

create view home.project_elements_with_totals
with (security_invoker = true)
as
select
  e.id,
  e.project_id,
  e.name,
  e.room,
  e.implicit,
  e.sort_order,
  e.notes,
  e.photo_paths,
  e.document_paths,
  e.created_by,
  e.created_at,
  e.updated_at,
  t.item_count,
  t.priced_count,
  t.quoted_count,
  t.chosen_total,
  t.range_low,
  t.range_high,
  t.spent_total
from home.project_elements e
cross join lateral (
  select
    count(*)                                   as item_count,
    count(*) filter (where i.chosen_amount is not null) as priced_count,
    -- Items that have been quoted and not decided. Reported separately because
    -- "we have three prices and haven't picked" is a different state from
    -- "nobody has asked", and only one of them is somebody's next move.
    count(*) filter (where i.chosen_amount is null and i.quote_count > 0)
                                               as quoted_count,
    sum(i.chosen_amount)                       as chosen_total,
    -- A settled item contributes its chosen amount to both ends; an unsettled
    -- one contributes the cheapest and dearest quote it has. An item nobody has
    -- priced contributes nothing at all to either — it is in `item_count` and
    -- nowhere else, which is what makes the denominator do its job.
    sum(coalesce(i.chosen_amount, i.quoted_low))  as range_low,
    sum(coalesce(i.chosen_amount, i.quoted_high)) as range_high,
    sum(i.spent)                               as spent_total
  from home.project_items_with_totals i
  where i.element_id = e.id
) t;

grant select on home.project_elements_with_totals to authenticated;

-- ---------------------------------------------------------------- paperwork
--
-- **Files roll up, never down.** A file belongs to exactly one level — the
-- council consent to the project, the tiling quote to the item it prices — and
-- this view gathers everything under a project into one list, saying which level
-- each came from. So the project's paperwork section shows all of it, and
-- opening the bathroom element shows the bathroom's, because the consent is not
-- about the bathroom.
--
-- It is created before `projects_with_totals` because that view counts these
-- rows, and a view that reads another has to be created second — there is no
-- forward reference in Postgres, and getting this order wrong fails the whole
-- migration rather than degrading quietly.
create view home.project_files
with (security_invoker = true)
as
select p.id as project_id, 'project'::text as level, p.id as owner_id,
       p.name as owner_name, 'photo'::text as kind, path
from home.projects p, unnest(p.photo_paths) as path
union all
select p.id, 'project', p.id, p.name, 'document', path
from home.projects p, unnest(p.document_paths) as path
union all
select e.project_id, 'element', e.id, e.name, 'photo', path
from home.project_elements e, unnest(e.photo_paths) as path
union all
select e.project_id, 'element', e.id, e.name, 'document', path
from home.project_elements e, unnest(e.document_paths) as path
union all
select e.project_id, 'item', i.id, i.name, 'photo', path
from home.project_items i
join home.project_elements e on e.id = i.element_id,
     unnest(i.photo_paths) as path
union all
select e.project_id, 'item', i.id, i.name, 'document', path
from home.project_items i
join home.project_elements e on e.id = i.element_id,
     unnest(i.document_paths) as path
union all
select e.project_id, 'quote', q.id, coalesce(q.supplier, i.name), 'photo', path
from home.project_quotes q
join home.project_items i    on i.id = q.item_id
join home.project_elements e on e.id = i.element_id,
     unnest(q.photo_paths) as path
union all
select e.project_id, 'quote', q.id, coalesce(q.supplier, i.name), 'document', path
from home.project_quotes q
join home.project_items i    on i.id = q.item_id
join home.project_elements e on e.id = i.element_id,
     unnest(q.document_paths) as path;

grant select on home.project_files to authenticated;

create view home.projects_with_totals
with (security_invoker = true)
as
select
  p.id,
  p.household_id,
  p.property_id,
  p.name,
  p.summary,
  p.status,
  p.started_on,
  p.target_on,
  p.finished_on,
  p.budget,
  p.budget_incl_gst,
  p.photo_paths,
  p.document_paths,
  p.created_by,
  p.created_at,
  p.updated_at,
  p.updated_by,
  pr.name                as property_name,
  creator.display_name   as created_by_name,
  t.element_count,
  -- What the client should actually draw. An implicit element is a layer that
  -- has not earned its place yet, so a project with one of them shows its items
  -- directly and never says the word "element".
  t.shown_element_count,
  t.item_count,
  t.priced_count,
  t.quoted_count,
  t.chosen_total,
  t.range_low,
  t.range_high,
  t.spent_total,
  f.file_count
from home.projects p
join home.properties pr      on pr.id = p.property_id
join home.profiles creator   on creator.id = p.created_by
cross join lateral (
  select
    count(*)                                        as element_count,
    count(*) filter (where not e.implicit)          as shown_element_count,
    coalesce(sum(e.item_count), 0)                  as item_count,
    coalesce(sum(e.priced_count), 0)                as priced_count,
    coalesce(sum(e.quoted_count), 0)                as quoted_count,
    sum(e.chosen_total)                             as chosen_total,
    sum(e.range_low)                                as range_low,
    sum(e.range_high)                               as range_high,
    sum(e.spent_total)                              as spent_total
  from home.project_elements_with_totals e
  where e.project_id = p.id
) t
cross join lateral (
  select count(*) as file_count
  from home.project_files pf
  where pf.project_id = p.id
) f;

grant select on home.projects_with_totals to authenticated;

-- ---------------------------------------------------------------- the writes
--
-- No insert/update/delete policy exists on any table above, exactly as
-- everywhere else in this schema. Every write is one of these, so the shape of a
-- write can change in one migration rather than in client code that is already
-- installed on somebody's phone.

create function home.create_project(
  p_property_id uuid,
  p_name text,
  p_status home.project_status default 'planned',
  p_summary text default null,
  p_rooms text[] default '{}',
  p_started_on date default null,
  p_target_on date default null,
  p_finished_on date default null,
  p_budget numeric default null,
  p_budget_incl_gst boolean default true,
  p_photo_paths text[] default '{}',
  p_document_paths text[] default '{}'
)
returns home.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_project home.projects;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_rooms text[];
  v_room text;
  v_i integer := 0;
begin
  select pr.household_id into v_household_id
  from home.properties pr where pr.id = p_property_id;

  if v_household_id is null then
    raise exception 'No such property';
  end if;

  perform home.require_property_member(p_property_id);

  -- Said in words rather than left to the check constraint, which would surface
  -- as `projects_name_check` and mean nothing to anybody.
  if v_name is null then
    raise exception 'Give it a name — the one you''d say out loud';
  end if;

  insert into home.projects (
    household_id, property_id, name, summary, status,
    started_on, target_on, finished_on,
    budget, budget_incl_gst, photo_paths, document_paths,
    created_by, updated_by
  )
  values (
    v_household_id, p_property_id, v_name,
    nullif(btrim(coalesce(p_summary, '')), ''),
    coalesce(p_status, 'planned'),
    p_started_on, p_target_on, p_finished_on,
    p_budget, coalesce(p_budget_incl_gst, true),
    coalesce(p_photo_paths, '{}'), coalesce(p_document_paths, '{}'),
    auth.uid(), auth.uid()
  )
  returning * into v_project;

  -- The rooms, de-duplicated and kept in the order they were tapped rather than
  -- alphabetised: the chips were pressed in an order that meant something to
  -- whoever pressed them, and the elements read back down the page in it.
  with picked as (
    select btrim(x) as r, min(ord) as ord
    from unnest(coalesce(p_rooms, '{}')) with ordinality as t(x, ord)
    where nullif(btrim(x), '') is not null
    group by btrim(x)
  )
  select array_agg(r order by ord) into v_rooms from picked;

  if coalesce(array_length(v_rooms, 1), 0) >= 2 then
    -- Two rooms or more is what makes the middle layer real. This is the only
    -- place elements are created without somebody asking for one by name, and
    -- they are not implicit: the person answering "which rooms" has plainly
    -- described a project with parts.
    foreach v_room in array v_rooms loop
      insert into home.project_elements (project_id, name, room, implicit, sort_order, created_by)
      values (v_project.id, v_room, v_room, false, v_i, auth.uid());
      v_i := v_i + 1;
    end loop;
  else
    -- One room, or none. A single element that the client never draws, so items
    -- hang directly off the project and the word "element" is never said. It is
    -- a real row so that the rollup has one path to sum through rather than two.
    insert into home.project_elements (project_id, name, room, implicit, sort_order, created_by)
    values (
      v_project.id,
      coalesce(v_rooms[1], v_name),
      v_rooms[1],
      true, 0, auth.uid()
    );
  end if;

  return v_project;
end;
$$;

grant execute on function home.create_project(
  uuid, text, home.project_status, text, text[], date, date, date,
  numeric, boolean, text[], text[]
) to authenticated;

-- `p_clear` names the columns being emptied, because a null argument means
-- "leave it alone" — the same convention `update_snag` and `update_thing` use.
create function home.update_project(
  p_project_id uuid,
  p_name text default null,
  p_summary text default null,
  p_status home.project_status default null,
  p_started_on date default null,
  p_target_on date default null,
  p_finished_on date default null,
  p_budget numeric default null,
  p_budget_incl_gst boolean default null,
  p_photo_paths text[] default null,
  p_document_paths text[] default null,
  p_clear text[] default '{}'
)
returns home.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project home.projects;
  v_current home.projects;
  v_clear text[] := coalesce(p_clear, '{}');
  v_name text;
begin
  perform home.require_project_member(p_project_id);

  select * into v_current from home.projects p where p.id = p_project_id;

  v_name := coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_current.name);

  update home.projects set
    name            = v_name,
    summary         = case when 'summary' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_summary, '')), ''), summary) end,
    status          = coalesce(p_status, status),
    started_on      = case when 'started_on' = any(v_clear) then null
                           else coalesce(p_started_on, started_on) end,
    target_on       = case when 'target_on' = any(v_clear) then null
                           else coalesce(p_target_on, target_on) end,
    finished_on     = case when 'finished_on' = any(v_clear) then null
                           else coalesce(p_finished_on, finished_on) end,
    budget          = case when 'budget' = any(v_clear) then null
                           else coalesce(p_budget, budget) end,
    budget_incl_gst = coalesce(p_budget_incl_gst, budget_incl_gst),
    photo_paths     = coalesce(p_photo_paths, photo_paths),
    document_paths  = coalesce(p_document_paths, document_paths),
    updated_at      = now(),
    updated_by      = auth.uid()
  where id = p_project_id
  returning * into v_project;

  return v_project;
end;
$$;

grant execute on function home.update_project(
  uuid, text, text, home.project_status, date, date, date,
  numeric, boolean, text[], text[], text[]
) to authenticated;

-- Returns every storage key the cascade orphaned, for the client to clear.
--
-- It has to be the client: `storage.protect_delete()` raises 42501 on a direct
-- delete of a `storage.objects` row, rightly, because that would leave the bytes
-- in the backing store with the row gone. Returning them afterwards works here —
-- unlike `delete_household` — because your membership of the property survives,
-- so `home.can_use_photo_folder` still answers yes when the client acts on them.
create function home.delete_project(p_project_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
begin
  perform home.require_project_member(p_project_id);

  select coalesce(array_agg(path), '{}') into v_paths
  from (
    select unnest(p.photo_paths || p.document_paths) as path
      from home.projects p where p.id = p_project_id
    union all
    select unnest(e.photo_paths || e.document_paths)
      from home.project_elements e where e.project_id = p_project_id
    union all
    select unnest(i.photo_paths || i.document_paths)
      from home.project_items i
      join home.project_elements e on e.id = i.element_id
     where e.project_id = p_project_id
    union all
    select unnest(q.photo_paths || q.document_paths)
      from home.project_quotes q
      join home.project_items i    on i.id = q.item_id
      join home.project_elements e on e.id = i.element_id
     where e.project_id = p_project_id
  ) all_files;

  delete from home.projects where id = p_project_id;

  return v_paths;
end;
$$;

grant execute on function home.delete_project(uuid) to authenticated;

-- ---------------------------------------------------------------- elements

create function home.create_element(
  p_project_id uuid,
  p_name text,
  p_room text default null
)
returns home.project_elements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_element home.project_elements;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_next integer;
begin
  perform home.require_project_member(p_project_id);

  if v_name is null then
    raise exception 'Give it a name — which part of the job is it?';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next
  from home.project_elements where project_id = p_project_id;

  insert into home.project_elements (project_id, name, room, implicit, sort_order, created_by)
  values (p_project_id, v_name, nullif(btrim(coalesce(p_room, '')), ''), false, v_next, auth.uid())
  returning * into v_element;

  -- The layer has now earned its place, so the element that was standing in for
  -- it stops hiding — unless it was never used, in which case it goes. An
  -- implicit element with no items and no files was a placeholder nobody ever
  -- saw or named; leaving it would put a phantom "Downstairs laundry" element
  -- inside the Downstairs laundry project on the day somebody added their first
  -- real one. One that *does* hold something stays and becomes visible, because
  -- what it holds is real even though its name was never chosen.
  delete from home.project_elements e
  where e.project_id = p_project_id
    and e.implicit
    and e.id <> v_element.id
    and e.photo_paths = '{}'
    and e.document_paths = '{}'
    and not exists (select 1 from home.project_items i where i.element_id = e.id);

  update home.project_elements
     set implicit = false
   where project_id = p_project_id and implicit;

  return v_element;
end;
$$;

grant execute on function home.create_element(uuid, text, text) to authenticated;

create function home.update_element(
  p_element_id uuid,
  p_name text default null,
  p_room text default null,
  p_notes text default null,
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
    name           = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    room           = case when 'room' = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_room, '')), ''), room) end,
    notes          = case when 'notes' = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes) end,
    photo_paths    = coalesce(p_photo_paths, photo_paths),
    document_paths = coalesce(p_document_paths, document_paths),
    updated_at     = now()
  where id = p_element_id
  returning * into v_element;

  if v_element.id is null then
    raise exception 'No such part of the job';
  end if;

  return v_element;
end;
$$;

grant execute on function home.update_element(uuid, text, text, text, text[], text[], text[])
  to authenticated;

create function home.delete_element(p_element_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
  v_project uuid := home.element_project(p_element_id);
begin
  perform home.require_project_member(v_project);

  -- The last element cannot go: items hang off an element, so a project with
  -- none of them is a project nothing can be added to. Emptying it is the way
  -- to start again.
  if (select count(*) from home.project_elements where project_id = v_project) <= 1 then
    raise exception 'That''s the only part of this job — empty it instead, or delete the whole project';
  end if;

  select coalesce(array_agg(path), '{}') into v_paths
  from (
    select unnest(e.photo_paths || e.document_paths) as path
      from home.project_elements e where e.id = p_element_id
    union all
    select unnest(i.photo_paths || i.document_paths)
      from home.project_items i where i.element_id = p_element_id
    union all
    select unnest(q.photo_paths || q.document_paths)
      from home.project_quotes q
      join home.project_items i on i.id = q.item_id
     where i.element_id = p_element_id
  ) all_files;

  delete from home.project_elements where id = p_element_id;

  return v_paths;
end;
$$;

grant execute on function home.delete_element(uuid) to authenticated;

-- ---------------------------------------------------------------- items

create function home.create_item(
  p_element_id uuid,
  p_name text,
  p_notes text default null,
  p_status home.project_item_status default 'considering'
)
returns home.project_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item home.project_items;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_next integer;
begin
  perform home.require_project_member(home.element_project(p_element_id));

  if v_name is null then
    raise exception 'Give it a name — what is it you''re getting?';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next
  from home.project_items where element_id = p_element_id;

  insert into home.project_items (element_id, name, notes, status, sort_order, created_by)
  values (
    p_element_id, v_name,
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(p_status, 'considering'), v_next, auth.uid()
  )
  returning * into v_item;

  return v_item;
end;
$$;

grant execute on function home.create_item(uuid, text, text, home.project_item_status)
  to authenticated;

create function home.update_item(
  p_item_id uuid,
  p_name text default null,
  p_status home.project_item_status default null,
  p_notes text default null,
  p_photo_paths text[] default null,
  p_document_paths text[] default null,
  p_clear text[] default '{}'
)
returns home.project_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item home.project_items;
  v_clear text[] := coalesce(p_clear, '{}');
begin
  perform home.require_project_member(home.item_project(p_item_id));

  update home.project_items set
    name           = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    status         = coalesce(p_status, status),
    notes          = case when 'notes' = any(v_clear) then null
                          else coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes) end,
    photo_paths    = coalesce(p_photo_paths, photo_paths),
    document_paths = coalesce(p_document_paths, document_paths),
    updated_at     = now()
  where id = p_item_id
  returning * into v_item;

  if v_item.id is null then
    raise exception 'No such item';
  end if;

  return v_item;
end;
$$;

grant execute on function home.update_item(
  uuid, text, home.project_item_status, text, text[], text[], text[]
) to authenticated;

create function home.delete_item(p_item_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
begin
  perform home.require_project_member(home.item_project(p_item_id));

  select coalesce(array_agg(path), '{}') into v_paths
  from (
    select unnest(i.photo_paths || i.document_paths) as path
      from home.project_items i where i.id = p_item_id
    union all
    select unnest(q.photo_paths || q.document_paths)
      from home.project_quotes q where q.item_id = p_item_id
  ) all_files;

  delete from home.project_items where id = p_item_id;

  return v_paths;
end;
$$;

grant execute on function home.delete_item(uuid) to authenticated;

-- ---------------------------------------------------------------- quotes

create function home.create_quote(
  p_item_id uuid,
  p_supplier text default null,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default true,
  p_kind home.project_quote_kind default 'quote',
  p_dated date default null,
  p_notes text default null,
  p_chosen boolean default false,
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
begin
  perform home.require_project_member(home.item_project(p_item_id));

  -- Cleared first, because `project_quotes_one_chosen` is a plain unique index
  -- rather than a deferred constraint: setting the new one first would fail on
  -- the old one still being true.
  if coalesce(p_chosen, false) then
    update home.project_quotes set chosen = false, updated_at = now()
     where item_id = p_item_id and chosen;
  end if;

  insert into home.project_quotes (
    item_id, supplier, detail, amount, amount_incl_gst, kind, chosen, dated, notes,
    photo_paths, document_paths, created_by
  )
  values (
    p_item_id,
    nullif(btrim(coalesce(p_supplier, '')), ''),
    nullif(btrim(coalesce(p_detail, '')), ''),
    p_amount, coalesce(p_amount_incl_gst, true),
    coalesce(p_kind, 'quote'), coalesce(p_chosen, false), p_dated,
    nullif(btrim(coalesce(p_notes, '')), ''),
    coalesce(p_photo_paths, '{}'), coalesce(p_document_paths, '{}'),
    auth.uid()
  )
  returning * into v_quote;

  return v_quote;
end;
$$;

grant execute on function home.create_quote(
  uuid, text, text, numeric, boolean, home.project_quote_kind, date, text, boolean, text[], text[]
) to authenticated;

create function home.update_quote(
  p_quote_id uuid,
  p_supplier text default null,
  p_detail text default null,
  p_amount numeric default null,
  p_amount_incl_gst boolean default null,
  p_kind home.project_quote_kind default null,
  p_dated date default null,
  p_notes text default null,
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
begin
  perform home.require_project_member(home.quote_project(p_quote_id));

  update home.project_quotes set
    supplier        = case when 'supplier' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_supplier, '')), ''), supplier) end,
    detail          = case when 'detail' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_detail, '')), ''), detail) end,
    amount          = case when 'amount' = any(v_clear) then null
                           else coalesce(p_amount, amount) end,
    amount_incl_gst = coalesce(p_amount_incl_gst, amount_incl_gst),
    kind            = coalesce(p_kind, kind),
    dated           = case when 'dated' = any(v_clear) then null
                           else coalesce(p_dated, dated) end,
    notes           = case when 'notes' = any(v_clear) then null
                           else coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes) end,
    photo_paths     = coalesce(p_photo_paths, photo_paths),
    document_paths  = coalesce(p_document_paths, document_paths),
    updated_at      = now()
  where id = p_quote_id
  returning * into v_quote;

  if v_quote.id is null then
    raise exception 'No such quote';
  end if;

  return v_quote;
end;
$$;

grant execute on function home.update_quote(
  uuid, text, text, numeric, boolean, home.project_quote_kind, date, text, text[], text[], text[]
) to authenticated;

-- Separate from `update_quote` for the reason `set_part_bought` is separate from
-- `update_snag`: choosing between three prices is one decision that is its own
-- confirmation, and it is the only write in this schema that changes what a
-- project's total says. Keeping it alone means the sibling-clearing can never be
-- skipped by a caller that happened to pass `chosen` among eight other fields.
create function home.set_quote_chosen(p_quote_id uuid, p_chosen boolean)
returns home.project_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote home.project_quotes;
  v_item uuid;
begin
  perform home.require_project_member(home.quote_project(p_quote_id));

  select item_id into v_item from home.project_quotes where id = p_quote_id;

  if v_item is null then
    raise exception 'No such quote';
  end if;

  update home.project_quotes set chosen = false, updated_at = now()
   where item_id = v_item and chosen and id <> p_quote_id;

  update home.project_quotes set chosen = coalesce(p_chosen, false), updated_at = now()
   where id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$$;

grant execute on function home.set_quote_chosen(uuid, boolean) to authenticated;

create function home.delete_quote(p_quote_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[];
begin
  perform home.require_project_member(home.quote_project(p_quote_id));

  select coalesce(q.photo_paths || q.document_paths, '{}') into v_paths
  from home.project_quotes q where q.id = p_quote_id;

  delete from home.project_quotes where id = p_quote_id;

  return coalesce(v_paths, '{}');
end;
$$;

grant execute on function home.delete_quote(uuid) to authenticated;
