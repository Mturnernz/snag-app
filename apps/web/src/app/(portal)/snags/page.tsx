import Link from 'next/link';
import { STATUS_LABELS, type SnagStatus, type SnagKind, type SnagSeverity } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, EmptyState } from '@/components/Card';
import { Button } from '@/components/Button';
import { StatusBadge, KindBadge, SeverityBadge } from '@/components/Badge';
import { mergeSelectedAction } from './actions';
import styles from './page.module.css';

const STATUS_FILTERS: (SnagStatus | 'all')[] = ['all', 'flagged', 'in_progress', 'rca_pending', 'resolved'];

export default async function SnagsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; status?: string; error?: string }>;
}) {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const { site, status, error: mergeError } = await searchParams;
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
      <PageHeader title="Snags" subtitle={activeMembership.org_name} />

      <div className={styles.filters}>
        {STATUS_FILTERS.map((s) => {
          const active = (status ?? 'all') === s;
          const href = s === 'all' ? '/snags' + (site ? `?site=${site}` : '') : `/snags?status=${s}` + (site ? `&site=${site}` : '');
          return (
            <Link key={s} href={href} className={styles.filterChip} data-active={active}>
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
            </Link>
          );
        })}
      </div>

      {error && <p className="error-text">Couldn&apos;t load snags: {error.message}</p>}
      {mergeError && <p className="error-text" style={{ marginBottom: 'var(--space-md)' }}>{mergeError}</p>}

      {snags && snags.length === 0 && <EmptyState>No snags match this filter.</EmptyState>}

      {snags && snags.length > 0 && (
        <form action={mergeSelectedAction}>
          <div className={styles.list}>
            {snags.map((snag) => (
              <div key={snag.id} className={styles.row}>
                <input type="checkbox" name="snagIds" value={snag.id} className={styles.rowCheckbox} aria-label={`Select ${snag.reference} to merge`} />
                <Link href={`/snags/${snag.id}`} className={styles.rowLink}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>
                      <span className={styles.rowRef}>{snag.reference}</span> · {snag.site_name}
                    </p>
                    <p className={styles.rowDesc}>{snag.description ?? '(no description)'}</p>
                  </div>
                  <div className={styles.rowBadges}>
                    <KindBadge kind={snag.kind as SnagKind} />
                    {snag.severity && <SeverityBadge severity={snag.severity as SnagSeverity} />}
                    <StatusBadge status={snag.status as SnagStatus} />
                  </div>
                </Link>
              </div>
            ))}
          </div>
          <Button type="submit" variant="secondary">Merge selected</Button>
        </form>
      )}
    </div>
  );
}
