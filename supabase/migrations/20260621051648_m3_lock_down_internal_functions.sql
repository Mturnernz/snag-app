-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

revoke execute on function public.dispatch_snag_notification(uuid, text) from anon, authenticated;
revoke execute on function public.apply_default_owner() from anon, authenticated;
revoke execute on function public.notify_after_snag_insert() from anon, authenticated;
revoke execute on function public.notify_after_snag_update() from anon, authenticated;
