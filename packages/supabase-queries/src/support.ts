/**
 * Asking SnagHQ about a job: the rules, kept pure so `support.test.ts` can pin
 * them without a network, and shared by the app and the staff portal so the
 * two cannot disagree about whether a question is still open or what an
 * assessment has to carry.
 */
import type {
  AdviceDraft,
  AdvicePart,
  AdviceTradie,
  SnagAdvice,
  SupportRequest,
  SupportStatus,
} from '@snag/shared-types';
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

/**
 * "3 hours", "2 days" — how long somebody has been waiting, for the queue.
 * Rounded down: a question 47 hours old has waited one day, not two, and the
 * queue under-stating a wait is safer than the reverse only in the sense that
 * it is never the reason somebody jumps it.
 */
export function describeWait(since: string, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(since).getTime());
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

/** The form opened on whatever assessment is already on the job. */
export function adviceDraftFrom(advice: SnagAdvice | null): AdviceDraft {
  return {
    diagnosis: advice?.diagnosis ?? '',
    verdict: advice?.verdict ?? null,
    reason: advice?.reason ?? '',
    steps: advice?.steps ?? [],
    needToSee: advice?.needToSee ?? '',
    parts: advice?.parts ?? [],
    trade: advice?.trade ?? '',
    tradies: advice?.tradies ?? [],
  };
}

const blank = (s: string | null | undefined): boolean => !s || s.trim() === '';
const orNull = (s: string | null | undefined): string | null => (blank(s) ? null : s!.trim());

/**
 * The draft as `staff_reply` takes it: trimmed, and with the rows the form
 * added and nobody filled in dropped rather than refused. A half-filled row is
 * kept, so `adviceDraftProblems` can say what it is missing.
 */
export function cleanAdviceDraft(draft: AdviceDraft) {
  const parts: AdvicePart[] = draft.parts
    .filter((p) => !(blank(p.item) && blank(p.where) && blank(p.approxNzd)))
    .map((p) => ({ item: p.item.trim(), where: orNull(p.where), approxNzd: orNull(p.approxNzd) }));
  const tradies: AdviceTradie[] = draft.tradies
    .filter((t) => ![t.name, t.phone, t.url, t.source, t.calloutNzd, t.totalNzd].every(blank))
    .map((t) => ({
      name: t.name.trim(),
      phone: orNull(t.phone),
      url: orNull(t.url),
      source: t.source.trim(),
      calloutNzd: orNull(t.calloutNzd),
      totalNzd: orNull(t.totalNzd),
    }));
  return {
    diagnosis: draft.diagnosis.trim(),
    verdict: draft.verdict,
    reason: orNull(draft.reason),
    steps: draft.steps.map((s) => s.trim()).filter((s) => s !== ''),
    needToSee: orNull(draft.needToSee),
    parts,
    trade: orNull(draft.trade),
    tradies,
  };
}

/**
 * What is stopping this assessment going out, in words, or nothing.
 *
 * The same refusals `staff_reply` makes, so the form can say them before the
 * round trip — and the one that matters most is the tradesman's source. A name
 * and a number nobody can follow back to where they were found is the
 * unverifiable claim the whole assessment loop is built to refuse; typed by an
 * employee rather than pasted from a model, it is refused rather than dropped,
 * because the employee can fix it.
 */
export function adviceDraftProblems(draft: AdviceDraft): string[] {
  const clean = cleanAdviceDraft(draft);
  const problems: string[] = [];
  if (clean.diagnosis === '') problems.push('Say what you think is wrong');
  else if (clean.diagnosis.length > 600) problems.push('Keep what is wrong under 600 characters');
  if (!clean.verdict) problems.push('Say whether they can do it themselves');
  if (clean.parts.some((p) => p.item === '')) problems.push('Every part needs to say what it is');
  for (const t of clean.tradies) {
    if (t.name === '') problems.push('Every tradesman needs a name');
    else if (t.source === '') problems.push(`Say where you found ${t.name}`);
  }
  return problems;
}

/**
 * The one email a reply sends.
 *
 * It says there is an answer and where it is, and nothing else: no diagnosis,
 * no photograph, no price. An email is a copy that gets forwarded and sits in
 * an inbox for years, and the answer belongs on the job, where the other
 * person in the house will also see it.
 */
export function supportReplyEmail(input: {
  headline: string;
  snagId: string;
  askedByName: string | null;
  appUrl: string;
}): { subject: string; text: string } {
  const link = `${input.appUrl.replace(/\/+$/, '')}/snags/${input.snagId}`;
  const first = input.askedByName?.trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${first},` : 'Hi,';
  return {
    subject: `SnagHQ has replied about "${input.headline}"`,
    text: [
      greeting,
      '',
      `SnagHQ has replied to your question about "${input.headline}".`,
      '',
      `Open it in Snag: ${link}`,
      '',
      "The answer is on the job itself, so everybody in your house can see it.",
      "You're getting this because you asked SnagHQ about this job. Snag doesn't send any other email.",
    ].join('\n'),
  };
}
