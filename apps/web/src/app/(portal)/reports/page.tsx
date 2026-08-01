import type { Metadata } from 'next';
import { getOrgStats, getOrgSnagTrend } from '@snag/supabase-queries';
import { STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS, type SnagStatus, type SnagKind, type SnagSeverity } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, EmptyState } from '@/components/Card';
import { Button } from '@/components/Button';
import Icon from '@/components/Icon';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Reports',
};

function Bar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className={styles.bar}>
      <span className={styles.barLabel}>{label}</span>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.barValue}>{count}</span>
    </div>
  );
}

const WEEKDAY_MONTH: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

function TrendChart({ points }: { points: { period: string; total: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.total));
  return (
    <div className={styles.trend}>
      {points.map((p) => (
        <div key={p.period} className={styles.trendCol}>
          <span className={styles.trendCount}>{p.total || ''}</span>
          <div
            className={styles.trendBar}
            data-has-value={p.total > 0}
            title={`${new Date(p.period).toLocaleDateString(undefined, WEEKDAY_MONTH)}: ${p.total}`}
            style={{ height: `${Math.max(2, (p.total / max) * 88)}px` }}
          />
          <span className={styles.trendLabel}>{new Date(p.period).toLocaleDateString(undefined, WEEKDAY_MONTH)}</span>
        </div>
      ))}
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const { error: exportError } = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const [{ data: stats, error: statsError }, trend] = await Promise.all([
    getOrgStats(supabase, activeMembership.org_id),
    getOrgSnagTrend(supabase, activeMembership.org_id, ninetyDaysAgo.toISOString().slice(0, 10), now.toISOString().slice(0, 10), 'week'),
  ]);
  const isOfficerAdmin = activeMembership.role === 'officer_admin';

  return (
    <div style={{ maxWidth: 640 }}>
      <PageHeader title="Reports" subtitle={activeMembership.org_name} />

      {/* Breakdowns below are all derived from stats — if the RPC failed, say so
          rather than drawing 0% bars that look like real findings. */}
      {statsError && (
        <p className="error-text" style={{ marginBottom: 'var(--space-lg)' }}>
          Couldn&apos;t load report figures: {statsError.message ?? 'unknown error'}
        </p>
      )}

      <Card elevated className={styles.section} style={{ marginBottom: 'var(--space-xl)' }}>
        <p className={styles.sectionTitle}>Trend — last 90 days</p>
        <p className={styles.sectionSubtitle}>Snags reported per week</p>
        {trend.length === 0 ? <EmptyState>No snags in this period.</EmptyState> : <TrendChart points={trend} />}
      </Card>

      <Card elevated style={{ marginBottom: 'var(--space-xl)' }}>
        <p className={styles.sectionTitle} style={{ marginBottom: 'var(--space-lg)' }}>By status</p>
        {(Object.keys(stats.byStatus) as SnagStatus[]).map((s) => (
          <Bar key={s} label={STATUS_LABELS[s]} count={stats.byStatus[s]} total={stats.totalSnags} />
        ))}
      </Card>

      <Card elevated style={{ marginBottom: 'var(--space-xl)' }}>
        <p className={styles.sectionTitle} style={{ marginBottom: 'var(--space-lg)' }}>By kind</p>
        {(Object.keys(stats.byKind) as SnagKind[]).map((k) => (
          <Bar key={k} label={KIND_LABELS[k]} count={stats.byKind[k]} total={stats.totalSnags} />
        ))}
      </Card>

      <Card elevated style={{ marginBottom: 'var(--space-xl)' }}>
        <p className={styles.sectionTitle} style={{ marginBottom: 'var(--space-lg)' }}>By severity</p>
        {(Object.keys(stats.bySeverity) as SnagSeverity[]).map((sv) => (
          <Bar key={sv} label={SEVERITY_LABELS[sv]} count={stats.bySeverity[sv]} total={stats.totalSnags} />
        ))}
      </Card>

      {exportError && <p className="error-text" style={{ marginBottom: 'var(--space-md)' }}>{exportError}</p>}

      {/* POST forms, not links: both endpoints write a file to storage and
          insert an audit row, and next/link prefetches links in the viewport —
          so as GETs, scrolling this page could have fired an export
          (PRODUCT_REVIEW.md §6.3). */}
      {isOfficerAdmin ? (
        <div className={styles.exportRow}>
          <form action="/reports/export" method="post">
            <Button type="submit" variant="primary"><Icon name="Download" size="sm" /> Governance report (PDF)</Button>
          </form>
          <form action="/reports/export-csv" method="post">
            <Button type="submit" variant="secondary"><Icon name="Download" size="sm" /> Raw data (CSV)</Button>
          </form>
        </div>
      ) : (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Governance report export is available to officer admins.
        </p>
      )}
    </div>
  );
}
