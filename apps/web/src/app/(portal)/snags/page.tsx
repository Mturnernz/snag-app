import Link from 'next/link';
import { STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS, type SnagStatus } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const STATUS_FILTERS: (SnagStatus | 'all')[] = ['all', 'flagged', 'in_progress', 'rca_pending', 'resolved'];

const STATUS_COLORS: Record<SnagStatus, { fg: string; bg: string }> = {
  flagged: { fg: 'var(--color-status-flagged)', bg: 'var(--color-status-flagged-bg)' },
  in_progress: { fg: 'var(--color-status-in-progress)', bg: 'var(--color-status-in-progress-bg)' },
  resolved: { fg: 'var(--color-status-resolved)', bg: 'var(--color-status-resolved-bg)' },
  rca_pending: { fg: 'var(--color-status-rca-pending)', bg: 'var(--color-status-rca-pending-bg)' },
};

export default async function SnagsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; status?: string }>;
}) {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const { site, status } = await searchParams;
  const supabase = await createClient();

  // Direct RLS-scoped select against snags_with_details — same view and
  // column shape apps/mobile's IssueListScreen reads, per
  // SNAG_WEB_APP_PLAN.md §4 ("reads are plain PostgREST selects").
  let query = supabase
    .from('snags_with_details')
    .select('id, reference, description, status, kind, severity, site_id, site_name, owner_name, reporter_name, comment_count, created_at')
    .eq('org_id', activeMembership.org_id)
    .is('parent_snag_id', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (site) query = query.eq('site_id', site);
  if (status && status !== 'all') query = query.eq('status', status);

  const { data: snags, error } = await query;

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Snags</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 24 }}>{activeMembership.org_name}</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {STATUS_FILTERS.map((s) => {
          const active = (status ?? 'all') === s;
          const href = s === 'all' ? '/snags' + (site ? `?site=${site}` : '') : `/snags?status=${s}` + (site ? `&site=${site}` : '');
          return (
            <Link
              key={s}
              href={href}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
                border: '1px solid var(--color-border)',
                background: active ? 'var(--color-primary)' : 'var(--color-surface)',
                color: active ? '#fff' : 'var(--color-text-primary)',
              }}
            >
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
            </Link>
          );
        })}
      </div>

      {error && <p className="error-text">Couldn't load snags: {error.message}</p>}

      {snags && snags.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>No snags match this filter.</p>
      )}

      {snags && snags.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {snags.map((snag) => (
            <Link
              key={snag.id}
              href={`/snags/${snag.id}`}
              className="card"
              style={{ display: 'flex', justifyContent: 'space-between', gap: 16, textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: '0 0 4px', fontWeight: 600 }}>
                  {snag.reference} · {snag.site_name}
                </p>
                <p style={{ margin: 0, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {snag.description ?? '(no description)'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, fontSize: 13 }}>
                <span style={{ color: 'var(--color-text-muted)' }}>{KIND_LABELS[snag.kind as keyof typeof KIND_LABELS]}</span>
                {snag.severity && <span style={{ color: 'var(--color-text-muted)' }}>{SEVERITY_LABELS[snag.severity as keyof typeof SEVERITY_LABELS]}</span>}
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: 20,
                    background: STATUS_COLORS[snag.status as SnagStatus].bg,
                    color: STATUS_COLORS[snag.status as SnagStatus].fg,
                    fontWeight: 600,
                  }}
                >
                  {STATUS_LABELS[snag.status as SnagStatus]}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
