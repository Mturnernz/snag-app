-- `household_members` can be looked up by household, but not by person.
--
-- Its only index is the primary key on `(household_id, profile_id)`, which a
-- lookup by `profile_id` alone cannot use — the leading column is the wrong
-- one. `property_members` has had `property_members_profile_id_idx` since the
-- schema was stood up; its sibling never got one.
--
-- It is asked by person on every read of `home.profiles`, which is the table
-- `snags_with_details` joins three times (reporter, assignee, comment author)
-- and `things_with_details` twice. The policy's `mine.profile_id = auth.uid()`
-- is that lookup, once per statement now that `20260921100300` has made it an
-- InitPlan — and a sequential scan per statement is exactly the cost that
-- InitPlan was worth removing the repetition of.
--
-- **This is the only one of the sixty the linter lists that is worth adding.**
-- The rest are `created_by` and `updated_by`: nothing in this app filters or
-- joins on them, so an index on each would be write cost on every insert to buy
-- nothing at all. `unindexed_foreign_keys` is an INFO lint for a reason — it
-- cannot see which direction a join is actually travelled in, and here every
-- structural foreign key the project page uses (`element_id`, `quote_id`,
-- `expected_cost_id`, `project_id`) is already indexed, in the composite order
-- the queries sort by.

create index if not exists household_members_profile_id_idx
  on home.household_members (profile_id);
