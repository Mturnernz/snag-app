import type { SupabaseClient } from '@supabase/supabase-js';
import { getMemberships } from '@snag/supabase-queries';

// The app's own deployment. Same value and the same caveat as
// /go/snag/[id]: deliberately NOT the portal host. A worker sent to a
// (portal) route is bounced to /unauthorized, which offers them the app — so
// pointing this at www.snaghq.co.nz makes a loop out of a handoff.
const APP_URL = process.env.NEXT_PUBLIC_SNAG_APP_URL ?? 'https://app.snaghq.co.nz';

/**
 * Where someone lands once their invite is accepted.
 *
 * Read from memberships rather than from the invite's `role`, because the
 * membership is what the portal gate will actually consult a moment later.
 * Sending someone to /dashboard on the strength of the invite row and having
 * requireSupervisorOrAdmin reject them there is the failure this avoids.
 */
export async function destinationAfterAccept(
  client: SupabaseClient,
  token: string
): Promise<string> {
  const memberships = await getMemberships(client);
  const active = memberships.find((m) => m.is_active && m.org_active);

  if (active && active.role !== 'worker') return '/dashboard';

  // Workers do their work in the app; the portal has nothing for them. The
  // token rides along so the landing page can say which organisation they just
  // joined rather than dropping them on a bare sign-in.
  return `/join/${token}/welcome`;
}

export { APP_URL };
