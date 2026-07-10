-- Postgres has no built-in min()/max() aggregate for uuid, so
-- apply_default_owner() failed with "function min(uuid) does not exist" on
-- every snag insert once the site had a single assignment candidate.
-- array_agg + [1] picks the (only, since v_count = 1) candidate without
-- relying on an ordering aggregate that doesn't exist for uuid.

create or replace function public.apply_default_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count int;
  v_owner uuid;
begin
  if new.owner_id is null then
    with candidates as (
      select user_id as uid from public.site_supervisors where site_id = new.site_id
      union
      select owner_id as uid from public.site_default_owners
        where site_id = new.site_id and owner_id is not null
    )
    select count(*), (array_agg(uid))[1] into v_count, v_owner from candidates;

    if v_count = 1 then
      new.owner_id := v_owner;
      new.assigned_at := now();
    end if;
  end if;
  return new;
end;
$function$;
