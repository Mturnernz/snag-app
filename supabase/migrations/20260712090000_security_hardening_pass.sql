-- Security/performance hardening pass, driven by the Supabase advisors.

-- 1) CRITICAL: snags_with_details ran with its owner's privileges (the
-- Postgres default for views), which bypasses RLS on every underlying
-- table — any authenticated user could read any org's snags/comments/vote
-- counts by querying the view directly. The client's org filter is
-- client-supplied and not a security boundary. security_invoker makes the
-- view enforce the caller's RLS. Safe for existing flows: the view is all
-- LEFT JOINs, profiles has an id = auth.uid() self-view clause (so a
-- cross-org reporter still resolves their own reporter_name), and snags'
-- reporter_id = auth.uid() clause keeps "track my own report" working.
alter view public.snags_with_details set (security_invoker = true);

-- 2) Lock the API surface down to signed-in users. Postgres grants EXECUTE
-- to PUBLIC on new functions by default, so every RPC was callable by the
-- anon role (each one no-ops/errors on auth.uid() = null, but there is no
-- reason to expose them at all). Revoke PUBLIC/anon everywhere, granting
-- authenticated explicitly (many functions only had the implicit PUBLIC
-- grant). Extension-owned functions are left alone.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- The invite-preview page is the one thing a signed-out user legitimately
-- hits (email link before login).
grant execute on function public.get_invite_preview(uuid) to anon;

-- New functions no longer default to PUBLIC-executable. Every future
-- migration must grant execute to authenticated explicitly (house style
-- already does).
alter default privileges in schema public revoke execute on functions from public;

-- 3) Internal-only plumbing should not be user-callable at all: a user who
-- could call dispatch_* directly could trigger arbitrary notification
-- emails. These are only ever invoked from inside other SECURITY DEFINER
-- functions (which execute as the owner, unaffected by this revoke).
revoke execute on function public.dispatch_snag_notification(uuid, text) from authenticated;
revoke execute on function public.dispatch_rca_notification(uuid, text) from authenticated;
revoke execute on function public.mark_in_progress_if_flagged(uuid) from authenticated;

-- 4) Pin the one function with a role-mutable search_path.
alter function public.generate_join_code() set search_path = public;

-- 5) RLS initplan fixes: auth.uid()/current_org_id()/current_role() in a
-- policy are re-evaluated for every candidate row unless wrapped in a
-- scalar subquery, which lets the planner hoist them to run once per
-- query. These five policies sit on the hottest tables.
alter policy "users can view their own memberships" on public.org_memberships
  using (user_id = (select auth.uid()));

alter policy "users can view their own active org" on public.user_active_org
  using (user_id = (select auth.uid()));

alter policy "members can view organisations they belong to" on public.organisations
  using (public.is_member_of_org((select auth.uid()), id));

alter policy "org members can view profiles in their org" on public.profiles
  using (
    id = (select auth.uid())
    or public.is_member_of_org(id, (select public.current_org_id()))
    or public.reported_into_org(id, (select public.current_org_id()))
  );

alter policy "members can view snags at sites they can see" on public.snags
  using (
    (
      org_id = (select public.current_org_id())
      and public.can_view_site(site_id)
      and (public.is_org_active(org_id) or (select public."current_role"()) = 'officer_admin'::public.user_role)
    )
    or reporter_id = (select auth.uid())
  );

-- 6) Input hardening: add_comment accepted unbounded text (the client caps
-- at 500 chars, but the RPC is the real boundary).
create or replace function public.add_comment(p_snag_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_comment_id uuid;
begin
  if p_body is null or btrim(p_body) = '' then
    raise exception 'Comment cannot be empty';
  end if;
  if length(p_body) > 2000 then
    raise exception 'Comment is too long';
  end if;
  if not exists (select 1 from public.snags s where s.id = p_snag_id and s.org_id = current_org_id()) then
    raise exception 'snag not found';
  end if;

  insert into public.comments (snag_id, author_id, body)
  values (p_snag_id, auth.uid(), p_body)
  returning id into v_comment_id;

  return v_comment_id;
end;
$$;
