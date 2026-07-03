-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.
--
-- NOTE: the applied migration hardcoded the internal secret value inline.
-- It is REDACTED here because this file is committed to a repository; the
-- live value was moved to Supabase Vault by the next migration
-- (m3_notify_secret_vault) and this inline version was superseded.

create or replace function public.dispatch_snag_notification(p_snag_id uuid, p_event text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://wpkdpukpllxuyqqlxkxf.supabase.co/functions/v1/notify-snag',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-snag-internal-secret', '<redacted — stored in Supabase Vault as snag_internal_secret>'
    ),
    body := jsonb_build_object('event', p_event, 'snag_id', p_snag_id)
  );
exception when others then
  null;
end;
$$;
