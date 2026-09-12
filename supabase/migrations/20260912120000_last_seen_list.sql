-- When this person last looked at the list.
--
-- The app opens on the list now, and the first thing it says is what has been
-- added since you last looked. In a two-person household that line *is* the
-- notification — there is no email, no push, and deliberately no plan for
-- either (see `notify-snag` in the archive, and the comment in CLAUDE.md about
-- two people who live in the same house).
--
-- A server column rather than device storage, for the same reason
-- `last_reported_property` is one: it has to hold on a second device and on the
-- web build, where "device storage" is one browser profile on one phone.
--
-- `mark_list_seen` returns the *previous* value and then stamps now. The caller
-- renders "new since <previous>" for the whole visit, so the New section can't
-- empty itself out from under someone while they are reading it.
--
-- Null on a first run, which is deliberate: the alternative marks an entire
-- backlog as new to somebody who has just signed up.

alter table home.profiles add column last_seen_list_at timestamptz;

create function home.mark_list_seen()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select p.last_seen_list_at into v_previous
  from home.profiles p where p.id = auth.uid();

  update home.profiles set last_seen_list_at = now() where id = auth.uid();

  return v_previous;
end;
$$;

grant execute on function home.mark_list_seen() to authenticated;
