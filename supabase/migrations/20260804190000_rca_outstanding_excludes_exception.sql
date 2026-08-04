-- A written reason discharges the RCA obligation, the same way a waiver does.
--
-- `snag_rca_outstanding` deliberately keeps resolved snags: an RCA is owed on a
-- serious snag until one is accepted or `waive_rca` records why it isn't needed,
-- and resolving doesn't discharge that. 20260804093000 then added the missing
-- half of the story to each row — closed with N steps outstanding, with or
-- without somebody's reason on the record.
--
-- But a snag closed under `resolution_exception_reason` has already had that
-- conversation. A supervisor looked at an unfinished investigation — root cause
-- among the conditions they were told were unmet — wrote down why it was being
-- closed anyway, and had their name and the time stamped against it. Leaving it
-- in an "outstanding work" list asks for that decision a second time in a
-- different vocabulary: the only thing that would clear the row is `waive_rca`,
-- writing a second reason why the analysis isn't happening beside the one
-- already on the snag.
--
-- So the list keeps exactly the rows somebody can still act on:
--
--   * `rca_pending` — an analysis is in flight and needs accepting or rejecting.
--   * resolved with the investigation complete — the RCA is genuinely still owed.
--   * resolved with steps outstanding and *no* reason recorded — the ones that
--     got in through a hole (the pre-gate closes, and the niggle-cascade bug
--     20260804093000 §4 fixed). These are the rows worth chasing, and the mobile
--     dashboard styles them accordingly.
--
-- Which means recording a reason after the fact — `record_resolution_exception`,
-- written for exactly the backlog above — now visibly clears a row rather than
-- only annotating it. `get_site_breakdown` counts this view, so its figure
-- follows without a second edit; that is the point of the predicate living here.
--
-- The column list is unchanged, so this stays a `create or replace`: a client
-- build already in someone's browser goes on selecting
-- `resolution_exception_reason`/`_at` from it, and gets no rows carrying them.
create or replace view public.snag_rca_outstanding
with (security_invoker = true) as
select
  sn.id as snag_id,
  sn.org_id,
  sn.site_id,
  sn.reference,
  sn.description,
  sn.status,
  sn.severity,
  sn.owner_id,
  sn.resolution_exception_reason,
  sn.resolution_exception_at,
  -- Recomputed rather than read from the snapshot: the snapshot says what was
  -- outstanding when the snag was closed, this says what is outstanding now.
  coalesce(array_length(public.serious_resolve_unmet(sn.id), 1), 0) as unmet_count
from public.snags sn
where sn.lane = 'serious'
  and sn.status in ('resolved', 'rca_pending')
  and sn.rca_waived_at is null
  -- Closed early with a supervisor's written reason: decided, not outstanding.
  and sn.resolution_exception_at is null
  and not exists (
    select 1 from public.snag_rca r
    where r.snag_id = sn.id and r.status = 'accepted'
  )
  and (
    sn.parent_snag_id is null
    or not exists (
      select 1 from public.snags parent
      where parent.id = sn.parent_snag_id and parent.lane = 'serious'
    )
  );

grant select on public.snag_rca_outstanding to authenticated;
