-- An investigations row now exists from the moment the investigation is
-- assigned, which is before anyone knows the root cause — and in document mode
-- there is never a SNAG-recorded one at all. The NOT NULL made
-- assign_investigation impossible.
--
-- update_snag_status already tests `root_cause_text is null` rather than the
-- row's existence, so the snag-mode gate is unchanged by this: a row without a
-- cause fails exactly as no row did.

alter table public.investigations alter column root_cause_text drop not null;
