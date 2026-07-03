-- Don't add to the anon-executable debt flagged by the security advisor:
-- the new RPCs are callable by authenticated only. (The pre-existing 50
-- functions share the default-PUBLIC grant; tightening those org-wide is
-- a separate hardening pass.)
revoke execute on function public.reassign_rca(uuid, uuid) from public, anon;
revoke execute on function public.cancel_rca(uuid) from public, anon;
