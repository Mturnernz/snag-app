-- The emailed-bill function can reach the schema its two functions live in.
--
-- `20260924090000` granted `inbox_for` and `file_emailed_bill` to `service_role`
-- and nothing else — but EXECUTE on a function is not enough on its own: the
-- caller also needs USAGE on the schema the function is in, and `home` has only
-- ever granted that to `authenticated`, deliberately (see CLAUDE.md, *How
-- `home` gets exposed*). So the first real bill emailed in reached Resend,
-- reached the function, and died at `42501 permission denied for schema home`
-- before it could look up which project its address belonged to.
--
-- USAGE only, and to the one role that is never in a browser. It grants no
-- table access by itself: `service_role` gets exactly the two functions it was
-- already granted, which is the grant-by-name rule this schema keeps. `anon`
-- still gets nothing, and a signed-out request still answers 42501.

grant usage on schema home to service_role;
