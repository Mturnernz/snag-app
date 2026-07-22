import Link from 'next/link';
import { getOrgStats, getSiteBreakdown } from '@snag/supabase-queries';
import { STATUS_LABELS, type SnagStatus } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, StatGrid, StatTile, EmptyState } from '@/components/Card';
import tableStyles from '@/components/Table.module.css';

export default async function DashboardPage() {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const supabase = await createClient();

  const [stats, siteBreakdown] = await Promise.all([
    getOrgStats(supabase, activeMembership.org_id),
    getSiteBreakdown(supabase, activeMembership.org_id),
  ]);

  return (
    <div>
      <PageHeader
        title={activeMembership.org_name}
        subtitle={`${stats.totalSnags} snags · ${stats.totalMembers} members`}
      />

      <div style={{ marginBottom: 'var(--space-4xl)' }}>
        <StatGrid>
          {(Object.keys(stats.byStatus) as SnagStatus[]).map((status) => (
            <StatTile key={status} value={stats.byStatus[status]} label={STATUS_LABELS[status]} />
          ))}
        </StatGrid>
      </div>

      <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-lg)' }}>By site</h2>
      {siteBreakdown.length === 0 ? (
        <EmptyState>No sites yet.</EmptyState>
      ) : (
        <div className={tableStyles.wrap}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>Site</th>
                <th>Open investigations</th>
                <th>Unassigned</th>
                <th>Overdue actions</th>
              </tr>
            </thead>
            <tbody>
              {siteBreakdown.map((site) => (
                <tr key={site.siteId}>
                  <td style={{ fontWeight: 600 }}>
                    <Link href={`/snags?site=${site.siteId}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                      {site.siteName}
                    </Link>
                  </td>
                  <td className={tableStyles.numeric}>{site.openInvestigations}</td>
                  <td className={tableStyles.numeric}>{site.unassigned}</td>
                  <td className={tableStyles.numeric} style={{ color: site.overdueActions > 0 ? 'var(--color-danger)' : undefined, fontWeight: site.overdueActions > 0 ? 600 : 400 }}>
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
