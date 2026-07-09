-- Let the login screen's QR scanner look up an org before the user has an
-- account. The first-time onboarding flow captures the scanned join code
-- pre-auth (see src/lib/pendingIntent.ts) and resumes joining after sign-up,
-- so get_org_by_join_code has to be callable by the anon role.
--
-- Safe to expose: it reveals only the org id + name to someone who already
-- holds the code (they scanned the poster). It never lists orgs, and joining
-- still requires a signed-in user via join_org_via_code.

grant execute on function public.get_org_by_join_code(text) to anon;
