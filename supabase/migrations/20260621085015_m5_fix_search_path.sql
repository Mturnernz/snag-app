-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

create or replace function public.block_snag_delete_within_retention()
returns trigger
language plpgsql set search_path = public as $$
begin
  if old.retained_until > current_date then
    raise exception 'This snag is retained until % and cannot be deleted', old.retained_until;
  end if;
  return old;
end;
$$;
