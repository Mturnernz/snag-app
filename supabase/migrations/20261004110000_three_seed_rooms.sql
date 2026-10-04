-- A new place starts with three rooms, not twelve.
--
-- `seed_locations` gave every new property Kitchen, Bathroom, Bedroom, Living
-- room, Laundry, Hallway, Garage, Outside, Deck, Roof, Under the house and
-- Elsewhere. First-run setup then showed all twelve as a list to prune before
-- anything else could happen. It now seeds Kitchen, Laundry and Master
-- bedroom, and the rooms step is a grid of those three with a card to add
-- another (`setup/steps/RoomsStep.tsx`).
--
-- **New properties only.** Nothing here touches `home.locations`: a place that
-- already has its twelve keeps them, and every snag filed under one of them
-- keeps its room, because `snags.room` is TEXT.
--
-- Same signature, so `create or replace` keeps the function's grants; the
-- revoke is restated beside it so the closure is visible in this file too.
-- Callers (`create_household`, `create_property`) are unchanged.

create or replace function home.seed_locations(p_property_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into home.locations (property_id, name, sort_order)
  select p_property_id, name, ord
  from (values
    ('Kitchen', 1), ('Laundry', 2), ('Master bedroom', 3)
  ) as seed(name, ord)
  on conflict (property_id, name) do nothing;
$$;

revoke execute on function home.seed_locations(uuid) from public, anon, authenticated;
