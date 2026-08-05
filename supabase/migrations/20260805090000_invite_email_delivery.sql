-- Invites have never been emailed.
--
-- `invite_user` has, since M1, written an `invites` row and an audit row and
-- returned. The migration that created it says so outright:
--
--   -- Admin/supervisor creates an invite. Email delivery (Resend) lands in M3;
--
-- M3 shipped (20260621045939_m3_everyone_knows), but it built the *snag*
-- notification pipeline only — `dispatch_snag_notification` takes a snag id,
-- and the triggers calling it are on `snags`. Invites never got their branch,
-- and every later migration touching `invite_user` (org inactivation, RPC
-- hardening) carried the same body forward without noticing.
--
-- Nothing anywhere said so. The RPC succeeds, so the app toasts "Invite sent";
-- the invite is listed as pending, which is true; and the invitee is simply
-- never told. `getPendingInvites` didn't even select `token`, so the code
-- existed only in this table while OrgJoinScreen asked people to "paste the
-- code your admin or supervisor emailed you". Five invites in the Snag org on
-- 2026-08-05 went nowhere, and Resend's log going back to June contains no
-- invite email at all.
--
-- This adds the missing dispatch. It is deliberately the same shape as the
-- snag one — vault secret, pg_net, errors trapped — so there is one pattern
-- here rather than two.

-- ─── Dispatch ────────────────────────────────────────────────────────────────

-- Fire-and-forget call to notify-snag. A mail failure must never roll back the
-- invite: an invite that exists but wasn't emailed is recoverable (resend it,
-- or copy the link), an invite that failed to be created is just an error the
-- admin has to interpret. Same trade-off dispatch_snag_notification makes, and
-- the same `exception when others then null` to hold it.
create or replace function public.dispatch_invite_notification(p_invite_id uuid)
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
    body := jsonb_build_object('event', 'invite_created', 'invite_id', p_invite_id)
  );
exception when others then
  null;
end;
$$;

-- ─── invite_user now actually invites ────────────────────────────────────────

-- Unchanged from 20260711130000 except for the dispatch on the last line.
-- Restated in full rather than patched because that is how every other RPC in
-- this schema has been revised, and a partial view of a security-definer
-- function is how guards get dropped by accident.
create or replace function public.invite_user(p_email text, p_role public.user_role, p_site_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org_id uuid := public.current_org_id();
  v_invite_id uuid;
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can invite people';
  end if;
  if not public.is_org_active(v_org_id) then
    raise exception 'This organisation is no longer active';
  end if;
  if p_site_id is not null and not exists (
    select 1 from public.sites where id = p_site_id and org_id = v_org_id
  ) then
    raise exception 'That site does not belong to your organisation';
  end if;

  insert into public.invites (org_id, site_id, email, role, invited_by)
    values (v_org_id, p_site_id, lower(p_email), p_role, auth.uid())
    returning id into v_invite_id;
  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'invite', v_invite_id, 'created', auth.uid());

  perform public.dispatch_invite_notification(v_invite_id);

  return v_invite_id;
end;
$$;

-- ─── Resend ──────────────────────────────────────────────────────────────────

-- The recovery path, and the reason this migration isn't only a one-line fix.
-- Mail gets filtered, sat on, and sent to an address with a typo in it that the
-- admin can see is wrong the moment they read the pending list. Without this
-- the only remedy is cancel-and-reinvite, which changes the token and so breaks
-- any link that *did* arrive.
--
-- Same token deliberately: resending is the same invite again, not a new one.
create or replace function public.resend_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org_id uuid := public.current_org_id();
begin
  if v_org_id is null then
    raise exception 'You must belong to an organisation';
  end if;
  if public.current_role() not in ('officer_admin', 'supervisor') then
    raise exception 'Only an admin or supervisor can resend an invite';
  end if;
  -- Org-scoped, and pending-only: a resend on an accepted invite would mail
  -- someone a link that now errors, and on a cancelled one it would undo the
  -- cancellation in the only way the recipient can see.
  if not exists (
    select 1 from public.invites
    where id = p_invite_id and org_id = v_org_id and status = 'pending'
  ) then
    raise exception 'Invite not found';
  end if;
  -- An expired invite can't be accepted, so re-mailing it sends someone to a
  -- dead end. Push the window out instead — the admin's intent in pressing
  -- resend is that this person should still be able to join.
  update public.invites
     set expires_at = greatest(expires_at, now() + interval '14 days')
   where id = p_invite_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'invite', p_invite_id, 'resent', auth.uid());

  perform public.dispatch_invite_notification(p_invite_id);
end;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────────

-- dispatch_invite_notification is internal: it is called by the two RPCs above,
-- both security definer, and nothing else should be able to make the system
-- send mail. Same treatment 20260621051648 gave the snag dispatcher.
--
-- The revoke has to name `public` as well as `anon`. 20260803120200 explains
-- why: ALTER DEFAULT PRIVILEGES binds per creating role, so a function applied
-- by a different role is born PUBLIC-callable and reachable at
-- /rest/v1/rpc/<name>. Two RPCs had already drifted through that gap.
revoke execute on function public.dispatch_invite_notification(uuid) from public, anon, authenticated;

revoke execute on function public.resend_invite(uuid) from public, anon;
grant execute on function public.resend_invite(uuid) to authenticated;

revoke execute on function public.invite_user(text, public.user_role, uuid) from public, anon;
grant execute on function public.invite_user(text, public.user_role, uuid) to authenticated;
