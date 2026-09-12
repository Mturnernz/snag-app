-- Ghost entries, and the one piece of state they need.
--
-- The House tab now arrives furnished: every room holds a dashed, greyed entry
-- for what a house of this kind probably has — a rangehood in the kitchen, a
-- toby under the house — until somebody records the real one.
--
-- **A ghost is not a row.** It exists only in the client, from a constant
-- (`ROOM_SUGGESTIONS`), and it never reaches `home.things`, never appears in
-- search, and can never be pointed at by a snag. That is the whole point: a
-- record full of entries nobody has confirmed looks full and answers nothing,
-- which is worse than an empty one — you believe it, check it in the shop, and
-- find nothing there.
--
-- So the only thing the server has to remember is the negative: which
-- suggestions this particular house does NOT have. A flat with no dryer should
-- stop being asked about a dryer, and should stop being asked for both people,
-- because there is one house and two people disagreeing about whether there is
-- a dryer is not a state worth modelling.
--
-- Keyed by (property_id, room, name) rather than by a suggestion id, for the
-- same reason `snags.room` and `things.room` are TEXT: the catalogue is an
-- interface, not data. It changes without a migration, and a row left behind by
-- a suggestion that has since been reworded is inert rather than broken.

create table home.absent_things (
  property_id uuid not null references home.properties(id) on delete cascade,
  room text not null check (length(btrim(room)) between 1 and 60),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  created_by uuid references home.profiles(id),
  primary key (property_id, room, name)
);

alter table home.absent_things enable row level security;

create policy "members read what their place hasn't got"
  on home.absent_things for select using (home.is_property_member(property_id));

grant select on home.absent_things to authenticated;

-- ---------------------------------------------------------------- writes

create function home.mark_thing_absent(p_property_id uuid, p_room text, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_property_member(p_property_id);

  insert into home.absent_things (property_id, room, name, created_by)
  values (p_property_id, btrim(p_room), btrim(p_name), auth.uid())
  on conflict (property_id, room, name) do nothing;
end;
$$;

grant execute on function home.mark_thing_absent(uuid, text, text) to authenticated;

-- Restores a whole room at once rather than one entry at a time. Dismissing is
-- a tap; undoing it is a rescue, and a rescue that costs six taps is a dead
-- end. `Elsewhere` exists in the location seed for the same reason.
create function home.restore_absent_things(p_property_id uuid, p_room text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform home.require_property_member(p_property_id);

  delete from home.absent_things a
  where a.property_id = p_property_id
    and (p_room is null or a.room = btrim(p_room));
end;
$$;

grant execute on function home.restore_absent_things(uuid, text) to authenticated;
