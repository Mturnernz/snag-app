-- Profile screen's Organisations list shows a snag summary for every org the
-- user belongs to, not just the active one. snags' RLS scopes SELECT to
-- org_id = current_org_id(), so a plain client query can't see a non-active
-- org's snags. This RPC bypasses RLS (SECURITY DEFINER) but re-checks real
-- org membership itself as the authorization gate.

create or replace function public.get_org_snag_summary(p_org_id uuid)
returns table(total bigint, flagged bigint, in_progress bigint, resolved bigint, rca_pending bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.org_memberships m
    where m.user_id = auth.uid() and m.org_id = p_org_id and m.removed_at is null
  ) then
    raise exception 'You are not a member of that organisation';
  end if;

  return query
  select
    count(*) as total,
    count(*) filter (where s.status = 'flagged') as flagged,
    count(*) filter (where s.status = 'in_progress') as in_progress,
    count(*) filter (where s.status = 'resolved') as resolved,
    count(*) filter (where s.status = 'rca_pending') as rca_pending
  from public.snags s
  where s.org_id = p_org_id;
end;
$$;

grant execute on function public.get_org_snag_summary(uuid) to authenticated;
