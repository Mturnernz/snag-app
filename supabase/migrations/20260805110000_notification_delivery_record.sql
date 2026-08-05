-- Make "is mail actually leaving?" a question this database can answer.
--
-- Right now it cannot, and that is not a gap so much as a repeated injury:
--
--   * July 2026. SNAG_FROM_ADDRESS defaulted to Resend's sandbox sender, so
--     every notification to anyone but the account holder was rejected 403.
--     `sendEmail` console.errors that, `notify-snag` returns 200 anyway, and
--     the DB dispatch discards the response — so mail stopped leaving the
--     system for three weeks and was found by reading Resend's dashboard.
--
--   * The invite bug this follows. `invite_user` never dispatched at all, for
--     the entire life of the feature. Nothing was rejected because nothing was
--     attempted, so even a record of failures would have shown a clean sheet.
--
-- Those two need different evidence, which is why this records *attempts*
-- rather than only failures. A failure log answers "did a send go wrong". It
-- cannot answer "was a send ever tried", and the invite bug lived entirely in
-- that second question. So every call to sendEmail writes a row, and the
-- health check below compares invites created against invite emails attempted
-- — a divergence there is the exact shape of the bug that hid for months.
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  -- The dispatch event, e.g. 'invite_created', 'serious_created'.
  event text not null,
  -- Nullable rather than not-null: a send whose org can't be resolved is
  -- exactly the kind of anomaly worth keeping, and a constraint here would
  -- discard it at the moment it mattered.
  org_id uuid references public.organisations(id) on delete set null,
  subject text not null,
  recipient_count int not null default 0,
  ok boolean not null,
  -- Resend's HTTP status and body when it refused. The 403 above would have
  -- been sitting in these two columns in plain sight.
  status_code int,
  error_body text,
  created_at timestamptz not null default now()
);

create index on public.notification_deliveries (created_at desc);
create index on public.notification_deliveries (event, created_at desc);
create index on public.notification_deliveries (org_id, created_at desc);

-- RLS on with no policies: nothing but service_role (which bypasses RLS, and
-- is what the edge function holds) reads or writes this directly. It spans
-- every organisation, so it is deliberately not a table any client selects
-- from — the aggregate below is the whole client-facing surface.
alter table public.notification_deliveries enable row level security;

-- Recipient addresses are deliberately NOT stored. The health signal needs a
-- count, not a mailing list, and this table is the one place in the schema
-- that would otherwise hold every address the system has ever mailed, across
-- all orgs, outside any org's RLS.
comment on table public.notification_deliveries is
  'One row per attempted notification email. Records attempts, not just failures, so a dispatch that never fired is detectable. No recipient addresses — counts only.';

-- The aggregate a supervisor or admin can see, scoped to their own org.
--
-- Two numbers, answering the two failure modes above: sends that were refused,
-- and invites created without a matching send. Both over the same window so
-- they can be read together.
create function public.email_delivery_health(p_hours int default 24)
returns table (
  window_hours int,
  sends_attempted bigint,
  sends_failed bigint,
  invites_created bigint,
  invite_emails_attempted bigint
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org_id uuid := public.current_org_id();
  v_since timestamptz;
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can read delivery health';
  end if;
  -- Clamped rather than trusted: this is a security-definer function reading
  -- across a time range a caller supplies.
  p_hours := least(greatest(coalesce(p_hours, 24), 1), 24 * 30);
  v_since := now() - make_interval(hours => p_hours);

  return query
  select
    p_hours,
    (select count(*) from public.notification_deliveries d
      where d.org_id = v_org_id and d.created_at >= v_since),
    (select count(*) from public.notification_deliveries d
      where d.org_id = v_org_id and d.created_at >= v_since and not d.ok),
    (select count(*) from public.invites i
      where i.org_id = v_org_id and i.created_at >= v_since),
    (select count(*) from public.notification_deliveries d
      where d.org_id = v_org_id and d.created_at >= v_since and d.event = 'invite_created');
end;
$$;

revoke execute on function public.email_delivery_health(int) from public, anon;
grant execute on function public.email_delivery_health(int) to authenticated;

-- Why this table rather than `net._http_response`, which pg_net already
-- populates for free: pg_net gives up after 5s while the edge function keeps
-- running, so a cold start logs `Timeout of 5000 ms reached` for an email that
-- was sent and delivered. Observed on the first invocation after this went out.
-- The row here is written by the function itself, after the send resolves, so
-- it reports what actually happened rather than whether Postgres was still
-- listening when it did.

-- Note on what is deliberately absent: there is no cron job emailing anyone
-- about this.
--
-- An alarm for broken email that travels by email is circular in precisely the
-- case that matters. July's outage rejected every send, so the alert would
-- have been rejected too — it would have been silent exactly when it was
-- needed, while looking like a working safety net for the months either side.
--
-- So the signal goes where an officer admin already is: the portal dashboard
-- reads this function and says so on the page. That is not clever, but it is
-- not circular, and the failure it is watching for is one nobody thought to
-- look for precisely because nothing ever said it out loud.
