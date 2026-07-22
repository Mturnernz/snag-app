import { requireSupervisorOrAdmin } from '@/lib/auth';
import PortalNav from '@/components/PortalNav';
import shellStyles from '@/components/PortalNav.module.css';
import { signOutAction, switchOrgAction } from './actions';

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
