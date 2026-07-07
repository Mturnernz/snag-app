-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

create table public.notify_debug_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  detail jsonb
);
