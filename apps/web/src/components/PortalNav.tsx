'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Membership } from '@snag/supabase-queries';
import Icon, { type IconName } from './Icon';
import { Button } from './Button';
import styles from './PortalNav.module.css';

const NAV_LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { href: '/snags', label: 'Snags', icon: 'ListChecks' },
  { href: '/reports', label: 'Reports', icon: 'ChartColumn' },
  { href: '/documents', label: 'Documents', icon: 'FileText' },
];

export default function PortalNav({
  email, activeMembership, usableOrgs, signOutAction, switchOrgAction,
}: {
  email: string | null;
  activeMembership: Membership;
  usableOrgs: Membership[];
  signOutAction: (formData: FormData) => void;
  switchOrgAction: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const sidebar = (
    <aside className={styles.sidebar} data-open={open}>
      <Link href="/dashboard" className={styles.brand} onClick={() => setOpen(false)}>SNAG</Link>

      <nav className={styles.nav}>
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={styles.navLink}
            data-active={pathname === link.href || pathname.startsWith(link.href + '/')}
            onClick={() => setOpen(false)}
          >
            <Icon name={link.icon} size="md" />
            {link.label}
          </Link>
        ))}
      </nav>

      <div className={styles.footer}>
        {usableOrgs.length > 1 ? (
          <form action={switchOrgAction}>
            <select
              name="orgId"
              defaultValue={activeMembership.org_id}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className={styles.orgSelect}
            >
              {usableOrgs.map((m) => (
                <option key={m.org_id} value={m.org_id}>{m.org_name}</option>
              ))}
            </select>
          </form>
        ) : (
          <p className={styles.orgName}>{activeMembership.org_name}</p>
        )}
        <p className={styles.userLine}>
          {email} · {activeMembership.role === 'officer_admin' ? 'Officer admin' : 'Supervisor'}
        </p>
        <form action={signOutAction}>
          <Button type="submit" variant="secondary" size="sm" style={{ width: '100%' }}>
            <Icon name="LogOut" size="sm" /> Sign out
          </Button>
        </form>
      </div>
    </aside>
  );

  return (
    <>
      <div className={styles.topbar}>
        <Link href="/dashboard" className={styles.topbarBrand}>SNAG</Link>
        <button type="button" className={styles.menuButton} aria-label="Open menu" onClick={() => setOpen(true)}>
          <Icon name="Menu" size="md" />
        </button>
      </div>
      <div className={styles.backdrop} data-open={open} onClick={() => setOpen(false)} />
      {sidebar}
    </>
  );
}
