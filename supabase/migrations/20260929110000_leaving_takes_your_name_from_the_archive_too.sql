-- Leaving takes your name from the archive too.
--
-- *Delete my account* removes the sign-in and the name. That is what the
-- privacy statement says, and until now it was only true of `home`: a person
-- who had also used the retired product left their name and email address in
-- `public.profiles`, and `20260929100000` kept them there deliberately,
-- because the archive was the pilot organisations' record.
--
-- The owner's decision, 29 September 2026: there is no longer a requirement to
-- keep those records for the pilot organisations. When somebody deletes their
-- account, their sign-in and their name go, in both schemas.
--
-- **So the archive gets the tombstone `home` already has.** The profile row
-- stays, because `audit_log`, `invites`, `public.snags` and the rest still
-- point at it with NO ACTION keys. Deleting it would mean deleting or
-- rewriting their rows too. The personal parts go: the name reads *Someone who
-- left*, as `home.profiles` does, and the email address is blanked, because it
-- was the sign-in. An invite the retired product addressed to that email
-- keeps its row and loses the address.
--
-- This is the one write into `public` a caller can cause, and it only ever
-- touches the caller's own profile and invites to the caller's own address.
-- Free text the pilots typed (a description, a witness statement) is not
-- searched for names, because nothing ties it to this person.
--
-- Nobody had deleted an account since `20260929100000`, so the backfill at the
-- foot matches nothing today. It is here so this file is right whenever it
-- runs.

create or replace function home.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := home.my_email();
  v_household uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Shared households first: remove_member does the careful part — nulling the
  -- assignments that would otherwise point at nobody, and handing on any
  -- property this account was alone on.
  for v_household in
    select m.household_id
    from home.household_members m
    where m.profile_id = v_uid
      and (
        select count(*) from home.household_members o
        where o.household_id = m.household_id
      ) > 1
  loop
    perform home.remove_member(v_household, v_uid);
  end loop;

  -- What is left is the households nobody else is in. They go whole, and their
  -- snags and things go with them, so nothing in those points at this profile.
  delete from home.households h
  where exists (
    select 1 from home.household_members m
    where m.household_id = h.id and m.profile_id = v_uid
  );

  -- Invitations addressed to this account die with it; ones it sent do not,
  -- because the household they point at may well outlive the sender. Read the
  -- address before the auth row goes, since my_email() reads from it.
  delete from home.invitations where email = v_email;

  -- The tombstone. Not a delete: three NOT NULL columns in households that
  -- survive still name this person, and they are right to.
  update home.profiles
  set display_name = 'Someone who left',
      deleted_at   = coalesce(deleted_at, now())
  where id = v_uid;

  -- The retired product's copy of the same person. Its rows stay, because the
  -- archive's own keys point at them; the name and the address go.
  update public.profiles
  set name  = 'Someone who left',
      email = ''
  where id = v_uid;

  if v_email is not null then
    update public.invites
    set email = ''
    where lower(btrim(email)) = v_email;
  end if;

  delete from auth.users where id = v_uid;
end;
$$;

revoke execute on function home.delete_my_account() from public, anon;
grant execute on function home.delete_my_account() to authenticated;

-- ---------------------------------------------------------------- backfill

-- A login deleted between 20260929100000 and this file would have left its
-- archive profile named. Invites first, while the profile still holds the
-- address they were sent to.
update public.invites i
set email = ''
from public.profiles p
where not exists (select 1 from auth.users u where u.id = p.id)
  and p.email <> ''
  and lower(btrim(i.email)) = lower(btrim(p.email));

update public.profiles p
set name  = 'Someone who left',
    email = ''
where not exists (select 1 from auth.users u where u.id = p.id)
  and (p.name <> 'Someone who left' or p.email <> '');
