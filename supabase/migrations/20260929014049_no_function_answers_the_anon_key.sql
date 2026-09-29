-- No function in `home` answers the anon key, or anybody but who it names.
--
-- Postgres grants EXECUTE to PUBLIC on every function it creates, and every
-- role inherits PUBLIC — `anon` included. From `20260921*` on, each migration
-- said `revoke ... from public, anon` beside its by-name grant to
-- `authenticated`. The eighty functions written before that never did, so
-- every write the app makes — `create_household`, `delete_my_account`,
-- `invite_to_household`, the lot — was executable by a signed-out caller.
--
-- What stood in the way was one gate: `anon` has no `usage` on the schema,
-- so a signed-out call answers `42501 permission denied for schema home`
-- before any function runs. That is still true and still the first gate.
-- This makes it one of two, so a future `grant usage on schema home to anon`
-- — for a public page, say — does not hand over every write in the app with
-- it. The advisor listed the eighty as `anon_security_definer_function_executable`.
--
-- **Revoked by name, one per function**, although *Grant by name* allows a
-- revoke-only sweep. Written out, the list is what `functionGrants.test.ts`
-- replays; a sweep would leave that test unable to say which migration closed
-- which function. The assertion at the foot is the sweep's other half: it
-- fails this migration if anything in `home` is still executable by PUBLIC or
-- `anon`, so a function this list missed stops the apply rather than staying
-- open in silence.
--
-- **`authenticated` loses nothing.** Measured on the live project before
-- this was written: of the 123 functions `authenticated` can execute, it held
-- every one by its own grant and none through PUBLIC. RLS policies call
-- `is_property_member` and `can_use_photo_folder` as the caller, which is why
-- that had to be measured rather than assumed — a policy whose function the
-- caller cannot execute raises `42501` on every read (see `20260911093000`).
--
-- **`service_role` loses the same 79 it held only through PUBLIC, and that is
-- deliberate.** The one edge function that uses it, `inbound-bill`, calls
-- `inbox_for`, `project_people` and `file_emailed_bill`, each granted to it by
-- name, and keeps them (as does `review_is_unread`). Nothing calls the app's
-- writes as `service_role`: those are the household's to make, and a job
-- created by the service key would be a job with nobody behind it. The dashboard and
-- migrations run as `postgres`, which owns the functions. The platform's
-- read-only roles (`pg_read_all_data`, `supabase_read_only_user`) lose the
-- same eighty, which is right for a role whose name says it cannot write.
--
-- Dry-run on the live project inside a block that rolled itself back, 29
-- September 2026: `anon` 80 → 0, `authenticated` 123 → 123, `service_role`
-- 83 → 4, `postgres` 156 → 156, and no role gained anything.
--
-- Trigger functions were already revoked; a trigger's EXECUTE is checked when
-- it is created, never when it fires.

revoke execute on function home.accept_invitation(uuid) from public, anon;
revoke execute on function home.accept_invitation_by_token(uuid) from public, anon;
revoke execute on function home.add_comment(uuid, text) from public, anon;
revoke execute on function home.add_expected_cost_line(uuid, text, text, numeric, boolean, text[], text[]) from public, anon;
revoke execute on function home.add_milestone(uuid, text, numeric, numeric, boolean, date) from public, anon;
revoke execute on function home.add_payment(uuid, numeric, boolean, date, text, text, text[], text[]) from public, anon;
revoke execute on function home.add_quote_line(uuid, text, text, numeric, boolean, boolean, home.project_allowance_kind, boolean, numeric) from public, anon;
revoke execute on function home.answer_project_snag(uuid, numeric, boolean, home.project_quote_kind, text, text, date, text[]) from public, anon;
revoke execute on function home.can_use_photo_folder(text) from public, anon;
revoke execute on function home.cancel_invitation(uuid) from public, anon;
revoke execute on function home.clear_figure(uuid, home.project_figure, uuid) from public, anon;
revoke execute on function home.create_element(uuid, text, text) from public, anon;
revoke execute on function home.create_expected_cost(uuid, text, numeric, boolean, uuid, text, text, boolean) from public, anon;
revoke execute on function home.create_household(text, text) from public, anon;
revoke execute on function home.create_invite_link(uuid, uuid[], integer) from public, anon;
revoke execute on function home.create_item(uuid, text, text, home.project_item_status) from public, anon;
revoke execute on function home.create_location(uuid, text) from public, anon;
revoke execute on function home.create_project(uuid, text, home.project_status, text, text[], date, date, date, numeric, boolean, text[], text[]) from public, anon;
revoke execute on function home.create_property(uuid, text) from public, anon;
revoke execute on function home.create_snag(uuid, text, text, text[], home.snag_priority, uuid, timestamptz, integer, uuid, uuid) from public, anon;
revoke execute on function home.create_thing(uuid, home.thing_kind, text, text, text[], text[], text, text, text, text[], date, date, integer, jsonb, text, uuid) from public, anon;
revoke execute on function home.create_thing(uuid, home.thing_kind, text, text, text[], text[], text, text, text, text[], date, date, integer, jsonb, text, uuid, uuid) from public, anon;
revoke execute on function home.decline_invitation(uuid) from public, anon;
revoke execute on function home.delete_element(uuid) from public, anon;
revoke execute on function home.delete_expected_cost(uuid) from public, anon;
revoke execute on function home.delete_expected_cost_line(uuid) from public, anon;
revoke execute on function home.delete_household(uuid) from public, anon;
revoke execute on function home.delete_item(uuid) from public, anon;
revoke execute on function home.delete_location(uuid) from public, anon;
revoke execute on function home.delete_milestone(uuid) from public, anon;
revoke execute on function home.delete_my_account() from public, anon;
revoke execute on function home.delete_payment(uuid) from public, anon;
revoke execute on function home.delete_project(uuid) from public, anon;
revoke execute on function home.delete_property(uuid) from public, anon;
revoke execute on function home.delete_quote(uuid) from public, anon;
revoke execute on function home.delete_quote_line(uuid) from public, anon;
revoke execute on function home.delete_snag(uuid) from public, anon;
revoke execute on function home.delete_snag_advice(uuid) from public, anon;
revoke execute on function home.delete_thing(uuid) from public, anon;
revoke execute on function home.household_file_paths(uuid) from public, anon;
revoke execute on function home.incl_gst(numeric, boolean) from public, anon;
revoke execute on function home.invitation_by_token(uuid) from public, anon;
revoke execute on function home.invite_to_household(uuid, text, uuid[]) from public, anon;
revoke execute on function home.is_property_member(uuid) from public, anon;
revoke execute on function home.last_reported_property() from public, anon;
revoke execute on function home.link_property_member(uuid, uuid) from public, anon;
revoke execute on function home.mark_list_seen() from public, anon;
revoke execute on function home.mark_thing_absent(uuid, text, text) from public, anon;
revoke execute on function home.my_invitations() from public, anon;
revoke execute on function home.my_orphan_file_paths() from public, anon;
revoke execute on function home.nsum(numeric, numeric) from public, anon;
revoke execute on function home.quote_reach(uuid) from public, anon;
revoke execute on function home.record_snag_advice(uuid, text, home.advice_verdict, text, text, text[], jsonb, text, jsonb, text) from public, anon;
revoke execute on function home.remove_member(uuid, uuid) from public, anon;
revoke execute on function home.rename_property(uuid, text) from public, anon;
revoke execute on function home.rename_supplier(uuid, text, text) from public, anon;
revoke execute on function home.restore_absent_things(uuid, text) from public, anon;
revoke execute on function home.review_is_unread(home.invoice_reviews) from public, anon;
revoke execute on function home.revoke_invite_link(uuid) from public, anon;
revoke execute on function home.set_expected_cost_confirmed(uuid, boolean) from public, anon;
revoke execute on function home.set_figure(uuid, home.project_figure, numeric, boolean, uuid, text) from public, anon;
revoke execute on function home.set_item_excluded(uuid, boolean) from public, anon;
revoke execute on function home.set_part_bought(uuid, text, boolean) from public, anon;
revoke execute on function home.set_projects_enabled(boolean) from public, anon;
revoke execute on function home.set_property_location(uuid, text, text) from public, anon;
revoke execute on function home.set_quote_status(uuid, home.project_quote_status) from public, anon;
revoke execute on function home.set_snag_status(uuid, home.snag_status) from public, anon;
revoke execute on function home.set_snag_things(uuid, uuid[]) from public, anon;
revoke execute on function home.unlink_property_member(uuid, uuid) from public, anon;
revoke execute on function home.update_element(uuid, text, text, text, numeric, boolean, text[], text[], text[]) from public, anon;
revoke execute on function home.update_expected_cost(uuid, text, numeric, boolean, uuid, text, text, uuid, text[]) from public, anon;
revoke execute on function home.update_expected_cost_line(uuid, text, text, numeric, boolean, text[], text[], text[]) from public, anon;
revoke execute on function home.update_item(uuid, text, home.project_item_status, text, text[], text[], text[]) from public, anon;
revoke execute on function home.update_milestone(uuid, text, numeric, numeric, boolean, date, text[]) from public, anon;
revoke execute on function home.update_payment(uuid, numeric, boolean, date, text, text, text[], text[], text[]) from public, anon;
revoke execute on function home.update_project(uuid, text, text, home.project_status, date, date, date, numeric, boolean, text[], text[], text[]) from public, anon;
revoke execute on function home.update_quote_line(uuid, text, text, numeric, boolean, boolean, text[], home.project_allowance_kind, boolean, numeric) from public, anon;
revoke execute on function home.update_snag(uuid, text, text, home.snag_priority, timestamptz, integer, uuid, text[], text[], uuid, uuid, text[]) from public, anon;
revoke execute on function home.update_thing(uuid, home.thing_kind, text, text, text[], text[], text, text, text, text[], date, date, integer, jsonb, text, uuid, text[]) from public, anon;
revoke execute on function home.upsert_profile(text) from public, anon;

do $$
declare
  v_open text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into v_open
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'home'
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'));

  if v_open is not null then
    raise exception 'Still executable by public or anon: %', v_open;
  end if;
end;
$$;
