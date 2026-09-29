-- The retired product can no longer be called, and storage still works.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/archive_locked.sql
--
-- Safe against the live project as well as a local stack: it only reads
-- catalogues, and the one write (an object row, to prove uploads still pass
-- the policies) is inside a transaction that is rolled back.
--
-- See 20260928090000_the_archive_stops_speaking.sql. The shape of the check
-- matters more than the four names: the functions `public` may still hand to
-- `authenticated` are computed from `pg_depend`, as the closure of everything
-- the `storage.objects` policies reach, so a policy added later that reads
-- through another table cannot be missed the way `current_role` and
-- `can_view_site` were missed by reading.

begin;

-- ------------------------------------------------ what storage depends on

create temp table storage_needs on commit drop as
with recursive reach(tbl) as (
  select 'storage.objects'::regclass::oid
  union
  select d.refobjid
  from reach r
  join pg_policy p on p.polrelid = r.tbl
  join pg_depend d on d.classid = 'pg_policy'::regclass
                  and d.objid = p.oid
                  and d.refclassid = 'pg_class'::regclass
  where d.refobjid <> r.tbl
)
select distinct pr.oid
from reach r
join pg_policy p on p.polrelid = r.tbl
join pg_depend d on d.classid = 'pg_policy'::regclass
                and d.objid = p.oid
                and d.refclassid = 'pg_proc'::regclass
join pg_proc pr on pr.oid = d.refobjid
where pr.pronamespace = 'public'::regnamespace;

do $$
declare
  v_extra text;
  v_missing text;
begin
  -- Nothing in `public` is executable by a caller unless storage needs it.
  select string_agg(p.oid::regprocedure::text, ', ') into v_extra
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.oid not in (select oid from storage_needs)
    and (has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('anon', p.oid, 'execute'));
  if v_extra is not null then
    raise exception 'public functions still executable by callers: %', v_extra;
  end if;

  -- Everything storage needs is executable by authenticated, or every
  -- storage read raises 42501.
  select string_agg(oid::regprocedure::text, ', ') into v_missing
  from storage_needs
  where not has_function_privilege('authenticated', oid, 'execute');
  if v_missing is not null then
    raise exception 'storage policies need EXECUTE on: %', v_missing;
  end if;

  -- And none of it is handed to anon.
  select string_agg(oid::regprocedure::text, ', ') into v_extra
  from storage_needs
  where has_function_privilege('anon', oid, 'execute');
  if v_extra is not null then
    raise exception 'anon can execute: %', v_extra;
  end if;

  if exists (select 1 from cron.job where jobname = 'overdue-actions-digest') then
    raise exception 'the retired digest is still scheduled';
  end if;
end
$$;

-- ------------------------------------------------ storage, as a member

-- Any household member with a photo will do; the test reads and writes as
-- them and rolls back.
create temp table member on commit drop as
select m.profile_id, m.household_id
from home.household_members m
where exists (
  select 1 from storage.objects o
  where o.bucket_id = 'home-photos'
    and split_part(o.name, '/', 1) = m.household_id::text
)
limit 1;
grant select on member to authenticated;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', profile_id, 'role', 'authenticated')::text,
  true
) from member;

set local role authenticated;

do $$
declare
  v_household uuid := (select household_id from member);
  n int;
begin
  if v_household is null then
    raise notice 'no household has a photo; storage checks skipped';
    return;
  end if;

  select count(*) into n from storage.objects where bucket_id = 'home-photos';
  if n = 0 then
    raise exception 'a member reads no photos';
  end if;

  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('home-photos', v_household || '/archive-locked-probe.jpg',
          auth.uid(), auth.uid()::text, '{"mimetype":"image/jpeg","size":1}');

  begin
    perform public.accept_rca(gen_random_uuid());
    raise exception 'a retired function answered a household member';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

reset role;

rollback;
