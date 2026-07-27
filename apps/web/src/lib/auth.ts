import { redirect } from 'next/navigation';
import { getMemberships, type Membership } from '@snag/supabase-queries';
import { createClient } from '@/lib/supabase/server';

// Gate for every (portal) route — per SNAG_WEB_APP_PLAN.md §3, the portal is
// supervisor/officer_admin only. Unauthenticated visitors go to /login;
// authenticated `worker`-role visitors go to /unauthorized rather than
// silently seeing an empty dashboard.
export async function requireSupervisorOrAdmin(): Promise<{
  userId: string;
  email: string | null;
  activeMembership: Membership;
  memberships: Membership[];
}> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const memberships = await getMemberships(supabase);
  const activeMembership = memberships.find((m) => m.is_active && m.org_active);

  if (!activeMembership) {
    redirect('/unauthorized');
  }
  if (activeMembership.role === 'worker') {
    redirect('/unauthorized');
  }

  return { userId: user.id, email: user.email ?? null, activeMembership, memberships };
}

/**
 * Who the current visitor is, without redirecting anywhere.
 *
 * `requireSupervisorOrAdmin` is a gate — it throws you out. The public
 * `/go/snag/[id]` handoff needs the same answer in order to *decide*, and has
 * to render something useful for the people that gate would have rejected, so
 * it can't call it.
 */
export async function getPortalAccess(): Promise<{
  signedIn: boolean;
  canUsePortal: boolean;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { signedIn: false, canUsePortal: false };

  const memberships = await getMemberships(supabase);
  const active = memberships.find((m) => m.is_active && m.org_active);
  return {
    signedIn: true,
    canUsePortal: Boolean(active) && active!.role !== 'worker',
  };
}
