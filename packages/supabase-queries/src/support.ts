/**
 * Asking SnagHQ about a job: the household's rules, kept pure so
 * `support.test.ts` can pin them without a network. The portal reads the same
 * `supportIsOpen`, so the two cannot disagree about whether a question is still
 * open. What only the portal needs — the assessment's refusals, the email, the
 * queue's wait — is in `staff.ts`, which the app never imports.
 */
import type { SupportRequest, SupportStatus } from '@snag/shared-types';
import { SUPPORT_ACCESS_DAYS } from '@snag/shared-types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether SnagHQ can still see the job.
 *
 * The client twin of `home.support_is_open`, the way `inclGst` twins
 * `home.incl_gst`: waiting on SnagHQ, or replied to within
 * `SUPPORT_ACCESS_DAYS`. If the two ever disagree the card tells a household
 * the job is shared when it is not, or the other way round.
 */
export function supportIsOpen(
  req: { status: SupportStatus; lastStaffReplyAt: string | null },
  now: Date = new Date()
): boolean {
  if (req.status === 'closed') return false;
  if (req.status === 'replied' && req.lastStaffReplyAt) {
    return new Date(req.lastStaffReplyAt).getTime() >= now.getTime() - SUPPORT_ACCESS_DAYS * DAY_MS;
  }
  return true;
}

/** The moment access lapses on its own, or null while it is SnagHQ's turn. */
export function supportAccessEndsAt(req: {
  status: SupportStatus;
  lastStaffReplyAt: string | null;
}): Date | null {
  if (req.status !== 'replied' || !req.lastStaffReplyAt) return null;
  return new Date(new Date(req.lastStaffReplyAt).getTime() + SUPPORT_ACCESS_DAYS * DAY_MS);
}

function shortDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
}

/**
 * The line at the top of the job page's card, in the household's words.
 *
 * Every state is stated, including the one nobody at SnagHQ has looked at yet:
 * a question that reads the same whether it was read an hour ago or never is a
 * question somebody asks twice.
 */
export function describeSupportStatus(req: SupportRequest, now: Date = new Date()): string {
  if (!supportIsOpen(req, now)) {
    if (req.closedBy === 'staff') return 'Closed by SnagHQ';
    return 'Closed — SnagHQ can no longer see this job';
  }
  if (req.status === 'replied') {
    const ends = supportAccessEndsAt(req);
    const replied = req.lastStaffReplyAt ? ` ${shortDay(req.lastStaffReplyAt)}` : '';
    return ends
      ? `SnagHQ replied${replied} · shared until ${shortDay(ends)}`
      : `SnagHQ replied${replied}`;
  }
  if (req.firstSeenAt) return `Seen by SnagHQ ${shortDay(req.firstSeenAt)} · waiting for an answer`;
  return `Waiting for SnagHQ · asked ${shortDay(req.waitingSince)}`;
}
