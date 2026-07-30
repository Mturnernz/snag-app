import type { Metadata } from 'next';
import Link from 'next/link';
import { getOrgStats, getSiteBreakdown } from '@snag/supabase-queries';
import { STATUS_LABELS, type SnagStatus } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, StatGrid, StatTile, EmptyState } from '@/components/Card';
import tableStyles from '@/components/Table.module.css';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const supabase = await createClient();

  const [{ data: stats, error: statsError }, { data: siteBreakdown, error: breakdownError }] = await Promise.all([
    getOrgStats(supabase, activeMembership.org_id),
    getSiteBreakdown(supabase, activeMembership.org_id),
  ]);

  return (
    <div>
      <PageHeader
        title={activeMembership.org_name}
        subtitle={statsError ? undefined : `${stats.totalSnags} snags · ${stats.totalMembers} members`}
      />

      {statsError ? (
        <p className="error-text" style={{ marginBottom: 'var(--space-4xl)' }}>
          Couldn&apos;t load organisation figures: {statsError.message ?? 'unknown error'}
        </p>
      ) : (
        <div style={{ marginBottom: 'var(--space-4xl)' }}>
          <StatGrid>
            {(Object.keys(stats.byStatus) as SnagStatus[]).map((status) => (
              <StatTile key={status} value={stats.byStatus[status]} label={STATUS_LABELS[status]} />
            ))}
          </StatGrid>
        </div>
      )}

      <h2 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-lg)' }}>By site</h2>
      {/* An error here used to render as "No sites yet." — see
          PRODUCT_REVIEW.md §3.4. */}
      {breakdownError ? (
        <p className="error-text">
          Couldn&apos;t load the site breakdown: {breakdownError.message ?? 'unknown error'}
        </p>
      ) : siteBreakdown.length === 0 ? (
        <EmptyState>No sites yet.</EmptyState>
      ) : (
        <div className={tableStyles.wrap}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>Site</th>
                <th>Open investigations</th>
                <th>Unassigned</th>
                <th>RCA outstanding</th>
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
                  {/* Serious snags closed without a root-cause analysis. Links
                      through to the resolved list, which is where they live. */}
                  <td className={tableStyles.numeric} style={{ color: site.rcaOutstanding > 0 ? 'var(--color-danger)' : undefined, fontWeight: site.rcaOutstanding > 0 ? 600 : 400 }}>
                    {site.rcaOutstanding > 0 ? (
                      <Link href={`/snags?site=${site.siteId}&status=resolved`} style={{ color: 'inherit' }}>
                        {site.rcaOutstanding}
                      </Link>
                    ) : (
                      site.rcaOutstanding
                    )}
                  </td>
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
