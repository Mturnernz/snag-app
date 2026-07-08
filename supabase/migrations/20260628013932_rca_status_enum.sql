-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

-- Add the 'rca_pending' status so a supervisor/admin can delegate a Root
-- Cause Analysis on a sorted serious-lane snag to anyone in the org.
-- Postgres requires this to be committed before the value can be used,
-- so it's split into its own migration (same pattern as
-- niggle_resolve_confirm_enum.sql -> niggle_resolve_confirm.sql).
alter type public.snag_status add value 'rca_pending';
