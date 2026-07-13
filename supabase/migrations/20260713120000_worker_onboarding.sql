-- First-time worker onboarding tutorial: a one-time welcome + overview
-- carousel gate, plus a "replay tutorial" entry any role can revisit.
alter table public.profiles add column has_seen_onboarding boolean not null default false;

create function public.mark_onboarding_seen()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set has_seen_onboarding = true where id = auth.uid();
end;
$$;

grant execute on function public.mark_onboarding_seen() to authenticated;
