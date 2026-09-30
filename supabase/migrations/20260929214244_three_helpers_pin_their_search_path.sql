-- Three helpers pin their search path.
--
-- The security advisor's `function_search_path_mutable` named three functions
-- in `home` that resolve names against whatever search path the caller has:
-- `incl_gst` and `nsum` (arithmetic the money views use) and `quote_reach`
-- (the quote → project walk the `reach_project_id` trigger stores). None is
-- SECURITY DEFINER, so a caller could only ever mislead their own query — but
-- every other function in the schema pins it, and a warning left standing is
-- one nobody reads when it matters.
--
-- An empty path is safe for all three: `quote_reach` names every table with
-- its schema, and the other two call only `round`, `coalesce` and `case`,
-- which `pg_catalog` answers whatever the path says.
--
-- **The cost, measured rather than assumed.** A `SET` clause stops Postgres
-- inlining a SQL function, and `incl_gst` and `nsum` sit inside the rollups
-- behind the Projects page. `home.project_page` on the largest live project
-- (17 prices) was timed four times each way inside a rolled-back transaction
-- before this was applied: 102, 50, 51, 51 ms before; 52, 45, 17, 17 ms after.
-- No slowdown worth the name. If a later rollup leans on these harder, time it
-- again rather than assuming.

alter function home.incl_gst(numeric, boolean) set search_path = '';
alter function home.nsum(numeric, numeric) set search_path = '';
alter function home.quote_reach(uuid) set search_path = '';
