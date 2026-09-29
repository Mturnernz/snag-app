-- v1 ships without the renovations tab.
--
-- `profiles.projects_enabled` (20260920090000) already decides whether the
-- Projects tab exists for a person, and it defaulted to true: every account
-- made from now on would arrive with a tab the launch does not include, and the
-- You tab offered a switch to bring it back. The switch is gone from the app;
-- this makes the default false and turns it off for everybody but the two
-- accounts that use it today.
--
-- Matched by the address people sign in with, lower-cased, so a capital typed
-- at sign-up does not lose somebody their tab. Anybody else who should see it
-- later is one update by hand:
--
--   update home.profiles set projects_enabled = true
--   where id = (select id from auth.users where lower(email) = '<address>');
--
-- Nothing is deleted. A profile with the tab off keeps its renovations and the
-- jobs filed against them; they are simply not offered (see *Projects can be
-- put away, per person* in CLAUDE.md for what else goes with the tab).

alter table home.profiles alter column projects_enabled set default false;

update home.profiles p
   set projects_enabled = false
 where p.projects_enabled
   and not exists (
     select 1 from auth.users u
      where u.id = p.id
        and lower(u.email) in ('mturnernz@gmail.com', 'alyssa.weake@gmail.com')
   );

update home.profiles p
   set projects_enabled = true
  from auth.users u
 where u.id = p.id
   and lower(u.email) in ('mturnernz@gmail.com', 'alyssa.weake@gmail.com')
   and not p.projects_enabled;
