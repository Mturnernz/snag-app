-- P2.4.2 (part 1): add the 'cancelled' RCA status. Postgres requires the
-- new enum value to be committed before it can be used, so this is split
-- from the RPCs that use it (same pattern as rca_status_enum.sql).
alter type public.rca_status add value 'cancelled';
