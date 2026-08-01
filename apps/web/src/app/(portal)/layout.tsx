import type { Metadata } from 'next';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import PortalNav from '@/components/PortalNav';
import shellStyles from '@/components/PortalNav.module.css';
import { signOutAction, switchOrgAction } from './actions';

// Applies to every route in the group. Nothing behind requireSupervisorOrAdmin()
// is reachable by a crawler anyway, but a page that redirects to /login can
// still be indexed *as* the login page from an inbound link — so say it here
// once rather than on five pages.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { email, activeMembership, memberships } = await requireSupervisorOrAdmin();
  const usableOrgs = memberships.filter((m) => m.org_active);

  return (
    <div className={shellStyles.shell}>
      <PortalNav
        email={email}
        activeMembership={activeMembership}
        usableOrgs={usableOrgs}
        signOutAction={signOutAction}
        switchOrgAction={switchOrgAction}
      />
      <main className={shellStyles.main}>{children}</main>
    </div>
  );
}
