-- Switch the org join code format from a 10-char lowercase hex string to an
-- 8-char alphanumeric code that's easy to read aloud or type in by hand
-- (manual entry is a new client path — see ScanJoinCodeScreen.tsx). The
-- charset excludes visually-ambiguous characters (0/O, 1/I/L).
--
-- Existing orgs keep their current hex code until they next regenerate —
-- get_org_by_join_code/join_org_via_code compare join_code as an opaque
-- string, so mixed formats coexist fine; no backfill needed.

create function public.generate_join_code()
returns text
language plpgsql
as $$
declare
  v_charset text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i int;
begin
  for i in 1..8 loop
    v_code := v_code || substr(v_charset, 1 + floor(random() * length(v_charset))::int, 1);
  end loop;
  return v_code;
end;
$$;

alter table public.organisations alter column join_code set default public.generate_join_code();

create or replace function public.regenerate_org_join_code()
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := public.current_org_id();
  v_code text;
begin
  if public.current_role() <> 'officer_admin' then
    raise exception 'Only an admin can regenerate the join code';
  end if;

  v_code := public.generate_join_code();
  update public.organisations set join_code = v_code where id = v_org_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor_id)
    values (v_org_id, 'organisation', v_org_id, 'join_code_regenerated', auth.uid());

  return v_code;
end;
$$;
