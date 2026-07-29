-- Same reason as root_cause_text, plus a Postgres detail worth recording:
-- NOT NULL is checked against the proposed tuple *before* ON CONFLICT resolves,
-- so attach_investigation_document's upsert failed even when the row already
-- existed and the DO UPDATE branch would never have touched this column.
--
-- An investigation can also legitimately have no named lead yet: attaching the
-- org's own investigation document is a valid first act on a snag nobody has
-- formally been assigned to.

alter table public.investigations alter column lead_investigator_id drop not null;
