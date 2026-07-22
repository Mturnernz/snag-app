import Link from 'next/link';
import { getOrgStats, getSiteBreakdown } from '@snag/supabase-queries';
import { STATUS_LABELS, type SnagStatus } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const supabase = await createClient();

  const [stats, siteBreakdown] = await Promise.all([
    getOrgStats(supabase, activeMembership.org_id),
    getSiteBreakdown(supabase, activeMembership.org_id),
  ]);

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>{activeMembership.org_name}</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 32 }}>
        {stats.totalSnags} snags · {stats.totalMembers} members
      </p>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 40 }}>
        {(Object.keys(stats.byStatus) as SnagStatus[]).map((status) => (
          <div key={status} className="card">
            <p style={{ fontSize: 28, fontWeight: 700, margin: '0 0 4px' }}>{stats.byStatus[status]}</p>
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>{STATUS_LABELS[status]}</p>
          </div>
        ))}
      </section>

      <h2 style={{ marginBottom: 16 }}>By site</h2>
      {siteBreakdown.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No sites yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '8px 12px' }}>Site</th>
                <th style={{ padding: '8px 12px' }}>Open investigations</th>
                <th style={{ padding: '8px 12px' }}>Unassigned</th>
                <th style={{ padding: '8px 12px' }}>Overdue actions</th>
              </tr>
            </thead>
            <tbody>
              {siteBreakdown.map((site) => (
                <tr key={site.siteId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                    <Link href={`/snags?site=${site.siteId}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                      {site.siteName}
                    </Link>
                  </td>
                  <td style={{ padding: '10px 12px' }}>{site.openInvestigations}</td>
                  <td style={{ padding: '10px 12px' }}>{site.unassigned}</td>
                  <td style={{ padding: '10px 12px', color: site.overdueActions > 0 ? 'var(--color-danger)' : undefined }}>
                    {site.overdueActions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
