-- Same anon-executable gap the RCA reassign/cancel hardening pass fixed:
-- granting to authenticated doesn't remove the implicit PUBLIC grant that
-- create function applies by default, and anon inherits from PUBLIC. Close
-- it for the two new CAPA RPCs only (the ~50 pre-existing functions with
-- the same gap are tracked separately, per rca_reassign_cancel_hardening.sql).
revoke execute on function public.verify_corrective_action(uuid) from public, anon;
revoke execute on function public.add_corrective_action_evidence(uuid, text, text) from public, anon;
