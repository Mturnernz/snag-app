import { getOrgStats, getOrgSnagTrend } from '@snag/supabase-queries';
import { STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS, type SnagStatus, type SnagKind, type SnagSeverity } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

function Bar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
      <span style={{ width: 110, fontSize: 14, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: 'var(--color-border)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)' }} />
      </div>
      <span style={{ width: 32, textAlign: 'right', fontSize: 14, flexShrink: 0 }}>{count}</span>
    </div>
  );
}

const WEEKDAY_MONTH: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

function TrendChart({ points }: { points: { period: string; total: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.total));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
      {points.map((p) => (
        <div key={p.period} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{p.total || ''}</span>
          <div
            title={`${new Date(p.period).toLocaleDateString(undefined, WEEKDAY_MONTH)}: ${p.total}`}
            style={{
              width: '100%',
              height: `${Math.max(2, (p.total / max) * 88)}px`,
              background: p.total > 0 ? 'var(--color-primary)' : 'var(--color-border)',
              borderRadius: 3,
            }}
          />
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
            {new Date(p.period).toLocaleDateString(undefined, WEEKDAY_MONTH)}
          </span>
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
  const [stats, trend] = await Promise.all([
    getOrgStats(supabase, activeMembership.org_id),
    getOrgSnagTrend(supabase, activeMembership.org_id, ninetyDaysAgo.toISOString().slice(0, 10), now.toISOString().slice(0, 10), 'week'),
  ]);
  const isOfficerAdmin = activeMembership.role === 'officer_admin';

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ marginBottom: 4 }}>Reports</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 32 }}>{activeMembership.org_name}</p>

      <section className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>Trend — last 90 days</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20 }}>Snags reported per week</p>
        {trend.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No snags in this period.</p>
        ) : (
          <TrendChart points={trend} />
        )}
      </section>

      <section className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>By status</h2>
        {(Object.keys(stats.byStatus) as SnagStatus[]).map((s) => (
          <Bar key={s} label={STATUS_LABELS[s]} count={stats.byStatus[s]} total={stats.totalSnags} />
        ))}
      </section>

      <section className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>By kind</h2>
        {(Object.keys(stats.byKind) as SnagKind[]).map((k) => (
          <Bar key={k} label={KIND_LABELS[k]} count={stats.byKind[k]} total={stats.totalSnags} />
        ))}
      </section>

      <section className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>By severity</h2>
        {(Object.keys(stats.bySeverity) as SnagSeverity[]).map((sv) => (
          <Bar key={sv} label={SEVERITY_LABELS[sv]} count={stats.bySeverity[sv]} total={stats.totalSnags} />
        ))}
      </section>

      {exportError && <p className="error-text" style={{ marginBottom: 12 }}>{exportError}</p>}

      {isOfficerAdmin ? (
        <div style={{ display: 'flex', gap: 12 }}>
          <a href="/reports/export" className="btn-primary">Download governance report (PDF, last 90 days)</a>
          <a href="/reports/export-csv" className="btn-secondary">Export raw data (CSV, last 90 days)</a>
        </div>
      ) : (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
          Governance report export is available to officer admins.
        </p>
      )}
    </div>
  );
}
