-- What Snag keeps about you, as one file you can take away.
--
-- Principle 6 of the Privacy Act 2020 gives a person the right to a copy of
-- what an agency holds about them. Until now the only answer was an email to
-- help@snaghq.co.nz and somebody running queries by hand. `export_my_data`
-- is *Download my data* on the You tab: one call, one JSON document.
--
-- **SECURITY INVOKER, and that is the design rather than a detail.** It reads
-- the tables the app reads, as the caller, so the row policies decide what is
-- in it. The file holds exactly what this person could open in the app, one
-- screen at a time: their own profile, the households and places they are
-- on, and everything recorded at those places. It never holds a household
-- they have left, a place they are not linked to, or a staff note. There is
-- no filter here for a policy to disagree with.
--
-- Three things are left out, each deliberately:
--
--   * **Two tokens.** `invitations.token` is a live join link, and
--     `projects.inbox_token` is the address bills are emailed to. An export is
--     a file that gets forwarded, and a forwarded join link is a way into the
--     household. Neither says anything about the person.
--   * **The tables nobody reads.** `label_reads` (the daily counter),
--     `staff` and `support_access_log` have RLS on and no read policy, so a
--     caller cannot select them and this function does not try.
--   * **The files themselves.** Photos and documents are listed by their
--     storage path inside the rows that hold them, never as signed URLs,
--     because a URL in a forwarded file is access to the photograph for as
--     long as it lives. They open from the app.
--
-- **One statement per table**, for the reason `20260926100000` gives about
-- `project_page`: a single statement holding thirty subqueries is re-planned
-- whole on every call. Each table here is its own `execute`, and the list of
-- tables is written out by name. Dynamic SQL only saves writing thirty
-- identical selects. It is not a sweep, and a table added to `home` is not
-- exported until somebody adds it here and reads what it holds.

create or replace function home.export_my_data()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  -- table name, columns left out
  v_tables constant text[][] := array[
    ['profiles', ''],
    ['households', ''],
    ['household_members', ''],
    ['properties', ''],
    ['property_members', ''],
    ['locations', ''],
    ['snags', ''],
    ['comments', ''],
    ['snag_things', ''],
    ['bought_parts', ''],
    ['snag_advice', ''],
    ['things', ''],
    ['absent_things', ''],
    ['label_readings', ''],
    ['product_lookups', ''],
    ['file_tags', ''],
    ['projects', 'inbox_token'],
    ['project_elements', ''],
    ['project_items', ''],
    ['project_quotes', ''],
    ['project_quote_lines', ''],
    ['project_quote_rooms', ''],
    ['project_payments', ''],
    ['project_expected_costs', ''],
    ['project_expected_cost_lines', ''],
    ['project_milestones', ''],
    ['project_overrides', ''],
    ['invoice_reviews', ''],
    ['invitations', 'token'],
    ['support_requests', ''],
    ['support_messages', '']
  ];
  v_out jsonb;
  v_rows jsonb;
  i int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to download your data'
      using errcode = '42501';
  end if;

  v_out := jsonb_build_object(
    'exported_at', now(),
    'account', jsonb_build_object(
      'id', auth.uid(),
      'email', auth.jwt() ->> 'email'
    ),
    'about', 'Everything Snag holds that this account can see: your profile, '
      || 'the households and places you are on, and what is recorded there. '
      || 'Photos and documents are listed by name; open them in the app.'
  );

  for i in 1 .. array_length(v_tables, 1) loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t) - %L), ''[]''::jsonb) from home.%I t',
      v_tables[i][2], v_tables[i][1]
    ) into v_rows;
    v_out := v_out || jsonb_build_object(v_tables[i][1], v_rows);
  end loop;

  return v_out;
end;
$function$;

revoke execute on function home.export_my_data() from public, anon;
grant execute on function home.export_my_data() to authenticated;
