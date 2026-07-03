-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.
--
-- NOTE: the applied migration passed the secret value inline to
-- vault.create_secret. It is REDACTED here because this file is committed
-- to a repository; the live value lives in Supabase Vault.

select vault.create_secret('<redacted>', 'snag_internal_secret');

create or replace function public.dispatch_snag_notification(p_snag_id uuid, p_event text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'snag_internal_secret';

  perform net.http_post(
    url := 'https://wpkdpukpllxuyqqlxkxf.supabase.co/functions/v1/notify-snag',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-snag-internal-secret', v_secret
    ),
    body := jsonb_build_object('event', p_event, 'snag_id', p_snag_id)
  );
exception when others then
  null;
end;
$$;
