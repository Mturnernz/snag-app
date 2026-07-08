-- SNAPSHOT of a migration already applied to the Snagv1 project
-- (wpkdpukpllxuyqqlxkxf). Recovered from supabase_migrations.schema_migrations
-- on 2026-07-03. Do NOT re-apply.

revoke execute on function public.current_org_id() from public;
revoke execute on function public.current_role() from public;
revoke execute on function public.create_organisation_and_owner(text, text) from public;
revoke execute on function public.create_site(text, text) from public;
revoke execute on function public.invite_user(text, public.user_role, uuid) from public;
revoke execute on function public.get_invite_preview(uuid) from public;
revoke execute on function public.accept_invite(uuid, text) from public;

grant execute on function public.current_org_id() to authenticated;
grant execute on function public.current_role() to authenticated;
grant execute on function public.create_organisation_and_owner(text, text) to authenticated;
grant execute on function public.create_site(text, text) to authenticated;
grant execute on function public.invite_user(text, public.user_role, uuid) to authenticated;
grant execute on function public.get_invite_preview(uuid) to anon, authenticated;
grant execute on function public.accept_invite(uuid, text) to authenticated;

drop policy "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  using (id = (select auth.uid()));

create index on public.invites (invited_by);
create index on public.invites (site_id);
create index on public.audit_log (actor_id);
