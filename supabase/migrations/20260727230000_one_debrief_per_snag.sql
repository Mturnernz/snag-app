-- One debrief per snag, and no hot/formal split.
--
-- `start_debrief` was a bare insert with no guard, so every call created a row.
-- The format selector made that trivially reachable: each tap started another
-- debrief. In production SNAG-00033 accumulated 13, created seconds apart, of
-- which only the first held anything.
--
-- Two changes, in this order:
--   1. Remove the empty duplicates (verified: every row being deleted has zero
--      findings, lessons and attendees — the oldest per snag, which is the one
--      carrying content wherever any exists, is kept).
--   2. Make the RPC idempotent and constrain the table, so tapping repeatedly
--      is harmless rather than merely discouraged by the UI.
--
-- `format` is kept as a column. Existing rows record which kind of debrief was
-- held, and that is history rather than configuration; it simply stops being
-- asked for or shown. New rows take the 'formal' default.

begin;

-- 1. Drop empty duplicates, keeping the oldest debrief per snag.
with ranked as (
  select d.id,
         row_number() over (partition by d.snag_id order by d.created_at) as rn,
         (select count(*) from public.debrief_findings f where f.debrief_id = d.id)
       + (select count(*) from public.debrief_lessons l where l.debrief_id = d.id)
       + (select count(*) from public.debrief_attendees a where a.debrief_id = d.id) as content
  from public.snag_debriefs d
)
delete from public.snag_debriefs
where id in (select id from ranked where rn > 1 and content = 0);

-- Anything still duplicated has content in more than one row, which a
-- migration must not silently discard. Nothing in production hits this, but a
-- future re-run against different data should stop rather than guess.
do $$
declare
  v_dupes int;
begin
  select count(*) into v_dupes
  from (select snag_id from public.snag_debriefs group by snag_id having count(*) > 1) x;
  if v_dupes > 0 then
    raise exception 'Refusing to constrain: % snag(s) have multiple debriefs with content. Merge them by hand first.', v_dupes;
  end if;
end $$;

create unique index if not exists snag_debriefs_one_per_snag on public.snag_debriefs (snag_id);

alter table public.snag_debriefs alter column format set default 'formal';

-- 2. Idempotent start: return the existing debrief rather than adding another.
--
-- Idempotent rather than raising, because the caller's intent is "make sure a
-- debrief exists" — an error on the second tap would be a worse experience for
-- the same outcome. The audit entry is only written when one is actually
-- created, so the log doesn't fill with non-events.
create or replace function public.start_debrief(p_snag_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_snag public.snags := public.require_serious_snag(p_snag_id);
  v_id uuid;
begin
  select id into v_id from public.snag_debriefs where snag_id = p_snag_id;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.snag_debriefs (snag_id, started_by)
    values (p_snag_id, auth.uid())
    returning id into v_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_snag.org_id, 'snag_debrief', v_id, 'debrief_started', auth.uid());

  return v_id;
end;
$$;

-- The old two-argument form is dropped so no client can keep calling it and
-- reintroduce the duplicates this migration exists to remove.
drop function if exists public.start_debrief(uuid, public.debrief_format);

revoke all on function public.start_debrief(uuid) from public, anon;
grant execute on function public.start_debrief(uuid) to authenticated;

commit;
