-- PRODUCT_REVIEW.md §3.6 + §4.1 — make the RPC perimeter fail closed.
--
-- Context for why this matters more than usual: anonymous sign-ins are enabled
-- project-wide (deliberately — the QR public-reporting flow in
-- apps/mobile/src/lib/supabase.ts needs it). That means anyone can mint an
-- `authenticated` JWT with no email and no org membership, so every function
-- granted to `authenticated` is reachable by a stranger and the whole boundary
-- rests on those functions rejecting a caller with no active org.

-- ─── 1. Null-guard the active-org check ─────────────────────────────────────
-- `null is distinct from null` evaluates to FALSE, so a caller with no active
-- org passing p_org_id => null slipped past this guard. Both functions then
-- returned harmless empty/zero results (org_id = null matches nothing), so
-- there was no exposure — but a guard that doesn't fail closed is a guard
-- waiting to be trusted by the next person. get_site_breakdown's copy of the
-- same bug is fixed in 20260724120000_rca_waiver_and_outstanding.sql.

create or replace function public.get_org_stats(p_org_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if p_org_id is null or p_org_id is distinct from public.current_org_id() then
    raise exception 'Stats are only available for your active organisation';
  end if;

  select jsonb_build_object(
    'total_snags', count(*),
    'by_status', jsonb_build_object(
      'flagged',     count(*) filter (where status = 'flagged'),
      'in_progress', count(*) filter (where status = 'in_progress'),
      'resolved',    count(*) filter (where status = 'resolved'),
      'rca_pending', count(*) filter (where status = 'rca_pending')),
    'by_kind', jsonb_build_object(
      'fixit',       count(*) filter (where kind = 'fixit'),
      'improvement', count(*) filter (where kind = 'improvement'),
      'hazard',      count(*) filter (where kind = 'hazard'),
      'incident',    count(*) filter (where kind = 'incident')),
    'by_severity', jsonb_build_object(
      'minor',    count(*) filter (where severity = 'minor'),
      'moderate', count(*) filter (where severity = 'moderate'),
      'injury',   count(*) filter (where severity = 'injury'),
      'critical', count(*) filter (where severity = 'critical'))
  ) into v_result
  from public.snags
  where org_id = p_org_id;

  -- Count memberships, not profiles.org_id (which is just the active-org
  -- mirror and undercounts multi-org members parked on another org).
  return v_result || jsonb_build_object(
    'total_members',
    (select count(*) from public.org_memberships where org_id = p_org_id and removed_at is null)
  );
end;
$$;

-- ─── 2. Revoke anon EXECUTE on definer functions that never needed it ───────
-- Each of these already fails closed for an anon caller, because
-- current_org_id() / current_role() / auth.uid() return null and the function
-- raises before doing work. This stops relying on that as the only line of
-- defence. get_site_breakdown got this treatment when it was written; these
-- nine were missed.
--
-- Deliberately NOT revoked (anon access is the point):
--   get_invite_preview      — invite preview before signup
--   get_site_by_public_token — QR scan resolves org/site before sign-in

revoke execute on function public.add_comment(uuid, text, uuid[]) from public, anon;
revoke execute on function public.create_work_group(text, text, uuid[]) from public, anon;
revoke execute on function public.update_work_group(uuid, text, text, uuid[]) from public, anon;
revoke execute on function public.delete_work_group(uuid) from public, anon;
revoke execute on function public.get_my_mentions() from public, anon;
revoke execute on function public.get_unseen_mention_count() from public, anon;
revoke execute on function public.mark_all_mentions_seen() from public, anon;
revoke execute on function public.mark_onboarding_seen() from public, anon;
revoke execute on function public.get_org_stats(uuid) from public, anon;

-- ─── 3. Make "closed by default" the default ────────────────────────────────
-- New functions in public are created with EXECUTE granted to PUBLIC, which is
-- how the nine above slipped through. Revoking the default means every future
-- RPC has to opt in explicitly with `grant execute ... to authenticated`.

alter default privileges in schema public revoke execute on functions from public;
