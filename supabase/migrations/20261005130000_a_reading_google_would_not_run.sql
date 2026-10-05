-- ============================================================================
-- A label reading Google would not run is not a reading that was busy.
-- ============================================================================
--
-- The day before launch the Gemini key's prepaid credits ran out and every
-- read answered 402. `read-label` filed that as `error`, so the card offered a
-- Try again that could not work and spent one of the household's fifty daily
-- reads each time it was pressed. `limit` says it instead, the same word
-- `20260927110000` gave product lookups for the same reason: Google would not
-- run it, and the fix is on the key's Google project rather than in the app.

alter table home.label_readings drop constraint label_readings_reason_check;
alter table home.label_readings add constraint label_readings_reason_check
  check (reason is null or reason in ('illegible', 'busy', 'quota', 'limit', 'error'));
