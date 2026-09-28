-- ============================================================================
-- A lookup Google refused is not a lookup that was busy.
-- ============================================================================
--
-- The first live product lookups, on 27 September 2026, all failed the same
-- way: every model answered 429 "You exceeded your current quota", seconds
-- after a plain label read on the same key and model had answered. That is an
-- allowance on the key's Google project — a used-up day, or web search not
-- included on its plan — and `lookup-product` filed it as `busy`, so the card
-- said "The search was busy" and offered a Try again that could not work.
--
-- `limit` says it instead: Google would not run the search. `quota` stays the
-- household's own fifty reads a day, which is a different allowance with a
-- different fix.

alter table home.product_lookups drop constraint product_lookups_reason_check;
alter table home.product_lookups add constraint product_lookups_reason_check
  check (reason is null or reason in ('busy', 'quota', 'limit', 'error'));
