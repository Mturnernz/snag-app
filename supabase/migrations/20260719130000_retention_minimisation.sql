-- Retention & privacy-minimisation policy (Compliance Baseline, Phase 2).
--
-- block_snag_delete_within_retention (20260623183200) made snag deletion
-- unconditional and permanent, well beyond HSWA's 5-year notifiable-event
-- floor — that's the right call for evidentiary defensibility, but it means
-- ordinary personal detail on ordinary niggles is now retained forever with
-- no minimisation step, which is the wrong side of the Privacy Act's
-- storage-limitation principle. This job narrows itself deliberately: only
-- resolved, non-notifiable, niggle-lane snags (fixit/improvement) past a
-- conservative 3-year threshold are touched. Serious-lane and
-- is_notifiable snags — and everything on the checklist/witness/evidence/
-- investigation tables, which only the serious lane ever populates — are
-- never minimised by this job.
--
-- This nulls the description/photo_paths *references* on the snag row; it
-- does not delete the underlying storage objects, which is a follow-up if
-- and when this policy is confirmed with legal review (see the delivered
-- compliance proposal's disclaimer).

alter table public.snags
  add column minimised_at timestamptz;

create function public.run_retention_minimisation()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.snags
    set description = null,
        photo_path = null,
        photo_paths = '{}',
        minimised_at = now()
    where lane = 'niggle'
      and status = 'resolved'
      and is_notifiable = false
      and minimised_at is null
      and created_at < now() - interval '3 years';
end;
$$;

revoke execute on function public.run_retention_minimisation() from public, anon, authenticated;

-- Weekly, off-peak — this is background hygiene, not time-sensitive like
-- the overdue-actions digest, so it doesn't need a daily cadence.
select cron.schedule('retention-minimisation', '0 17 * * 0', $$select public.run_retention_minimisation();$$);
