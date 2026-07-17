-- Scheduled digest for overdue corrective actions — MVP-SPEC.md listed this
-- as out of scope originally; it's now in active development. No scheduling
-- infrastructure (pg_cron or otherwise) existed anywhere in this project
-- before this migration, so this is genuinely new, not an extension of an
-- existing job.
create extension if not exists pg_cron with schema extensions;

-- Mirrors dispatch_snag_notification's pg_net + Vault-secret pattern
-- exactly, but is never called from a user-facing RPC — only from
-- run_overdue_actions_digest below, itself only ever invoked by the cron
-- job, so this is revoked from everyone rather than granted to authenticated.
create function public.dispatch_overdue_actions_digest(p_org_id uuid)
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
    body := jsonb_build_object('event', 'overdue_actions_digest', 'org_id', p_org_id)
  );
exception when others then
  null;
end;
$$;

revoke execute on function public.dispatch_overdue_actions_digest(uuid) from public, anon, authenticated;

-- "Overdue" matches the resolve-gate/dashboard definition: due_date passed
-- and not (done and verified). One dispatch per org with at least one such
-- action — notify-snag resolves the actual recipients per org.
create function public.run_overdue_actions_digest()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org record;
begin
  for v_org in
    select distinct sn.org_id
    from public.corrective_actions ca
    join public.snags sn on sn.id = ca.snag_id
    where ca.due_date < current_date
      and not (ca.status = 'done' and ca.verified_by is not null)
  loop
    perform public.dispatch_overdue_actions_digest(v_org.org_id);
  end loop;
end;
$$;

revoke execute on function public.run_overdue_actions_digest() from public, anon, authenticated;

-- Daily at 18:00 UTC = 06:00 NZDT / 07:00 NZST — before the NZ workday
-- starts, so a supervisor's digest is waiting when they open the app.
select cron.schedule('overdue-actions-digest', '0 18 * * *', $$select public.run_overdue_actions_digest();$$);
