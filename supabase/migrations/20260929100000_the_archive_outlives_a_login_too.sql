-- The archive outlives a login too.
--
-- *Delete my account* failed for every account that also used the retired
-- product. On 29 September 2026 that was seven of the nine logins:
--
--   23503: update or delete on table "profiles" violates foreign key
--   constraint "audit_log_actor_id_fkey" on table "audit_log"
--
-- `20260915091000` found this shape in `home` and cut the cascade from
-- `auth.users` to `home.profiles`, because an account and a person are not
-- the same row. It left `public.profiles` alone, because nothing there was
-- being deleted. But `public.profiles.id` also cascades from `auth.users`.
-- Deleting the login therefore tries to delete the pilot profile, and every
-- pilot profile is still named by the archive: `audit_log.actor_id`,
-- `invites.invited_by`, ten columns on `public.snags` and more on the RCA,
-- investigation and debrief tables, all NO ACTION. The first of those to hold
-- a row refuses the whole delete. Every pilot account has audit rows, so every
-- one of them failed.
--
-- A refusal is the better way for this to fail. Where no NO ACTION column held
-- the profile, the cascade went through: it would have deleted the pilot
-- profile and, through the ON DELETE CASCADE columns under it, that person's
-- rows in `site_members`, `org_memberships`, `site_supervisors`,
-- `work_group_supervisors`, `comment_mentions`, `serious_incident_owners` and
-- the rest. That is a household action writing into the frozen archive.
--
-- **So the cascade goes, as it went in `home`.** This is DDL on `public`, not
-- a write to it: every row stays exactly as it is, and the archive's record of
-- who reported, resolved and signed off keeps its names. The pilot profile
-- keeps an id with no login behind it. Nothing reads that id as a live user:
-- `current_org_id()` and the other three predicates storage still reaches ask
-- `where id = auth.uid()`, and no login will ever carry that id again.
--
-- Rehearsed against the live project inside a statement that raised at the
-- end, as each of the seven pilot logins in turn. Before: all seven refused,
-- on `audit_log` or `invites`. After: all seven deleted, and the archive still
-- held its seven profiles. `supabase/tests/archive_locked.sql` asserts that
-- nothing in `public` refers to `auth.users` any more, and replays the delete
-- for one pilot login in a transaction it rolls back.

alter table public.profiles drop constraint profiles_id_fkey;

comment on column public.profiles.id is
  'Was auth.users.id, and cascaded from it until 20260929100000. The cascade '
  'was cut so a person deleting their Snag login cannot delete, or be blocked '
  'by, the retired product''s records of them. A pilot profile may now name an '
  'id with no login behind it.';
