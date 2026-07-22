import Link from 'next/link';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { signOutAction, switchOrgAction } from './actions';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/snags', label: 'Snags' },
  { href: '/reports', label: 'Reports' },
  { href: '/documents', label: 'Documents' },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { email, activeMembership, memberships } = await requireSupervisorOrAdmin();
  const usableOrgs = memberships.filter((m) => m.org_active);

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          padding: '24px 16px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Link href="/dashboard" style={{ fontWeight: 700, fontSize: 18, textDecoration: 'none', color: 'var(--color-text-primary)', padding: '0 8px 24px', display: 'block' }}>
          SNAG
        </Link>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                padding: '10px 8px',
                borderRadius: 'var(--radius-button)',
                textDecoration: 'none',
                color: 'var(--color-text-primary)',
                fontWeight: 500,
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 16, marginTop: 16 }}>
          {usableOrgs.length > 1 ? (
            <form action={switchOrgAction} style={{ marginBottom: 12 }}>
              <select
                name="orgId"
                defaultValue={activeMembership.org_id}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: 'var(--radius-button)',
                  border: '1px solid var(--color-border)',
                  fontSize: 14,
                }}
              >
                {usableOrgs.map((m) => (
                  <option key={m.org_id} value={m.org_id}>{m.org_name}</option>
                ))}
              </select>
            </form>
          ) : (
            <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px', padding: '0 8px' }}>
              {activeMembership.org_name}
            </p>
          )}
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 12px', padding: '0 8px' }}>
            {email} · {activeMembership.role === 'officer_admin' ? 'Officer admin' : 'Supervisor'}
          </p>
          <form action={signOutAction}>
            <button type="submit" className="btn-secondary" style={{ width: '100%', fontSize: 14, padding: '8px' }}>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main style={{ flex: 1, padding: '32px 40px', maxWidth: 1120 }}>{children}</main>
    </div>
  );
}
