import Link from 'next/link';
import { STATUS_LABELS, type SnagStatus, type SnagKind, type SnagSeverity } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, EmptyState } from '@/components/Card';
import { Button } from '@/components/Button';
import { StatusBadge, KindBadge, SeverityBadge } from '@/components/Badge';
import Icon from '@/components/Icon';
import { mergeSelectedAction } from './actions';
import styles from './page.module.css';

const STATUS_FILTERS: (SnagStatus | 'all')[] = ['all', 'flagged', 'in_progress', 'rca_pending', 'resolved'];

/**
 * The chips compose: status, the dashboard's `?site=`, and Assigned are three
 * independent filters on one URL. Built here rather than concatenated per chip,
 * which is how `?site=` came to be silently dropped by whichever chip forgot it.
 */
function filterHref({ status, site, assigned }: { status?: string; site?: string; assigned?: boolean }) {
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (site) params.set('site', site);
  if (assigned) params.set('assigned', '1');
  const qs = params.toString();
  return qs ? `/snags?${qs}` : '/snags';
}

export default async function SnagsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; status?: string; error?: string; assigned?: string }>;
}) {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const { site, status, error: mergeError, assigned } = await searchParams;
  const assignedOnly = assigned === '1';
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
  // Has an assignee, whoever it is — owner_id is the assignee on both lanes,
  // and on the serious lane triage sets it to the lead investigator.
  if (assignedOnly) query = query.not('owner_id', 'is', null);

  const { data: snags, error } = await query;

  return (
    <div>
      <PageHeader title="Snags" subtitle={activeMembership.org_name} />

      <div className={styles.filters}>
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={filterHref({ status: s, site, assigned: assignedOnly })}
            className={styles.filterChip}
            data-active={(status ?? 'all') === s}
          >
            {s === 'all' ? 'All' : STATUS_LABELS[s]}
          </Link>
        ))}
        {/* A separate axis from status, so it toggles rather than replacing
            whichever status chip is on. */}
        <Link
          href={filterHref({ status, site, assigned: !assignedOnly })}
          className={styles.filterChip}
          data-active={assignedOnly}
        >
          Assigned
        </Link>
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
                    {/* Who is on it. owner_name has been selected by this query
                        all along and shown by nothing. Omitted rather than
                        labelled "Unassigned": that would be on nearly every
                        row and say nothing. */}
                    {snag.owner_name && (
                      <span className={styles.rowOwner}>
                        <Icon name="User" size="sm" />
                        {snag.owner_name}
                      </span>
                    )}
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
