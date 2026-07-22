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
