import Link from 'next/link';
import { describeWait, getStaffQueue, snagHeadline } from '@snag/supabase-queries';
import { SUPPORT_CLOSE_REASON_LABELS, type StaffQueueRow, type StaffQueueTab } from '@snag/shared-types';
import { createStaffClient, signPhotos } from '@/lib/supabase/staff';
import { day } from '@/lib/when';
import styles from '../staff.module.css';

const TABS: { tab: StaffQueueTab; label: string }[] = [
  { tab: 'unclaimed', label: 'Unclaimed' },
  { tab: 'mine', label: 'Mine' },
  { tab: 'open', label: 'Everything open' },
  { tab: 'closed', label: 'Closed (30 days)' },
];

function isTab(value: string | undefined): value is StaffQueueTab {
  return TABS.some((t) => t.tab === value);
}

/**
 * The queue. Waiting on SnagHQ first, oldest wait first — a household that
 * asked on Monday has been waiting longer than one that asked this morning, and
 * the only fair order is the one that says so. Then what is waiting on the
 * household. A closed row carries no photograph and no words of the job,
 * because access has ended.
 */
export default async function Queue({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: asked } = await searchParams;
  const tab: StaffQueueTab = isTab(asked) ? asked : 'unclaimed';

  const supabase = await createStaffClient();
  const queue = await getStaffQueue(supabase, tab);
  const photos = await signPhotos(
    supabase,
    queue.rows.flatMap((r) => (r.job?.photoPath ? [r.job.photoPath] : []))
  );

  const counts: Record<StaffQueueTab, number | null> = {
    unclaimed: queue.counts.unclaimed,
    mine: queue.counts.mine,
    open: queue.counts.open,
    closed: null,
  };

  return (
    <main className={styles.page}>
      <h1 className={styles.h1}>Questions</h1>
      <div className={styles.counts}>
        <span>
          {queue.counts.waiting} waiting on SnagHQ
          {queue.counts.oldestWaitingSince
            ? ` · oldest ${describeWait(queue.counts.oldestWaitingSince)}`
            : ''}
        </span>
        <span>{queue.counts.open} open</span>
      </div>

      <nav className={styles.tabs} aria-label="Queue">
        {TABS.map((t) => (
          <Link
            key={t.tab}
            href={`/staff?tab=${t.tab}`}
            className={styles.tab}
            aria-current={t.tab === tab ? 'page' : undefined}
          >
            {t.label}
            {counts[t.tab] !== null ? ` · ${counts[t.tab]}` : ''}
          </Link>
        ))}
      </nav>

      {queue.rows.length === 0 ? (
        <p className={styles.empty}>
          {tab === 'unclaimed' ? 'Nothing waiting for somebody to pick it up.' : 'Nothing here.'}
        </p>
      ) : (
        <ul className={styles.list}>
          {queue.rows.map((row) => (
            <li key={row.id}>
              <QueueRow row={row} photo={row.job?.photoPath ? photos[row.job.photoPath] : undefined} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function QueueRow({ row, photo }: { row: StaffQueueRow; photo?: string }) {
  const headline = row.job
    ? snagHeadline({ description: row.job.description, room: row.job.room })
    : row.reference;
  const where = row.job ? [row.job.room, [row.job.suburb, row.job.town].filter(Boolean).join(', ')].filter(Boolean).join(' · ') : null;

  const body = (
    <>
      {row.job ? (
        photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.thumb} src={photo} alt="" />
        ) : (
          <span className={styles.thumb} aria-hidden />
        )
      ) : null}
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>{headline}</span>
        <span className={styles.question}>&ldquo;{row.question}&rdquo;</span>
        <span className={styles.meta}>
          <span className={styles.mono}>{row.reference}</span>
          {where ? ` · ${where}` : ''}
        </span>
      </span>
      <span className={styles.rowSide}>
        <Status row={row} />
        <span className={styles.meta}>{row.assignedName ?? 'Unclaimed'}</span>
      </span>
    </>
  );

  // A closed question cannot be opened — the page would only say so — so the
  // row is not a link.
  return row.open ? (
    <Link href={`/staff/requests/${row.id}`} className={styles.row}>
      {body}
    </Link>
  ) : (
    <div className={`${styles.row} ${styles.rowClosed}`}>{body}</div>
  );
}

function Status({ row }: { row: StaffQueueRow }) {
  if (!row.open) {
    const why =
      row.closedBy === 'expired'
        ? 'Lapsed'
        : row.closedBy === 'customer'
          ? 'Closed by them'
          : row.closeReason
            ? SUPPORT_CLOSE_REASON_LABELS[row.closeReason]
            : 'Closed';
    return (
      <>
        <span className={styles.badge}>{why}</span>
        {row.closedAt ? <span className={styles.meta}>{day(row.closedAt)}</span> : null}
      </>
    );
  }
  if (row.status === 'waiting') {
    return (
      <>
        <span className={styles.badge} data-tone="waiting">
          Waiting {describeWait(row.waitingSince)}
        </span>
        {row.firstSeenAt ? null : <span className={styles.meta}>Not opened yet</span>}
      </>
    );
  }
  return <span className={styles.badge}>With them</span>;
}
