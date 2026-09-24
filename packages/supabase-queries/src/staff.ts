/**
 * The SnagHQ staff portal's reads and writes, and the rules only it needs.
 *
 * **A separate entry point, and the app must never import it.** Everything
 * here is imported as `@snag/supabase-queries/staff` by `apps/staff` and by
 * nothing else, so none of the portal's code ships in the app households
 * install. Nothing here is a secret — every `staff_*` function refuses a caller
 * who is not on `home.staff`, server-side — but the household's app has no
 * business carrying the portal, and `staffSeparation.test.ts` in `apps/mobile`
 * fails the build if it ever does.
 *
 * The household's half (`getSupportRequestForSnag`, `supportIsOpen`, …) stays
 * in `index.ts` and `support.ts`, because the app is where a household asks.
 */
import type { SupabaseClient as TypedSupabaseClient } from '@supabase/supabase-js';
import type {
  AdviceDraft,
  AdvicePart,
  AdviceTradie,
  SnagAdvice,
  StaffMember,
  StaffQueue,
  StaffQueueRow,
  StaffQueueTab,
  StaffRequestPage,
  SupportCloseReason,
} from '@snag/shared-types';
import { asError, mapAdvice, mapSupportMessage, snagHeadline, unwrap } from './index';

type SupabaseClient = TypedSupabaseClient<any, any, any>;
type Row = Record<string, any>;

/** Whether this session is somebody on the SnagHQ staff list. */
export async function isStaff(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc('is_staff');
  if (error) throw asError(error, "Couldn't check the staff list");
  return data === true;
}

function mapQueueRow(row: Row): StaffQueueRow {
  return {
    id: row.id,
    status: row.status,
    open: row.open,
    question: row.question,
    reference: row.reference,
    createdAt: row.created_at,
    waitingSince: row.waiting_since,
    firstSeenAt: row.first_seen_at ?? null,
    lastStaffReplyAt: row.last_staff_reply_at ?? null,
    closedAt: row.closed_at ?? null,
    closedBy: row.closed_by ?? null,
    closeReason: row.close_reason ?? null,
    assignedTo: row.assigned_to ?? null,
    assignedName: row.assigned_name ?? null,
    job: row.job
      ? {
          description: row.job.description ?? null,
          room: row.job.room ?? null,
          photoPath: row.job.photo_path ?? null,
          photoCount: row.job.photo_count ?? 0,
          suburb: row.job.suburb ?? null,
          town: row.job.town ?? null,
        }
      : null,
  };
}

const mapStaffMember = (row: Row): StaffMember => ({
  userId: row.user_id,
  displayName: row.display_name,
});

/** The whole queue for one tab, in one request. */
export async function getStaffQueue(client: SupabaseClient, tab: StaffQueueTab): Promise<StaffQueue> {
  const { data, error } = await client.rpc('staff_queue', { p_tab: tab });
  const payload = unwrap<Row>(data, error, "Couldn't load the queue");
  return {
    rows: ((payload.rows ?? []) as Row[]).map(mapQueueRow),
    counts: {
      unclaimed: payload.counts?.unclaimed ?? 0,
      mine: payload.counts?.mine ?? 0,
      open: payload.counts?.open ?? 0,
      waiting: payload.counts?.waiting ?? 0,
      oldestWaitingSince: payload.counts?.oldest_waiting_since ?? null,
    },
    me: payload.me ? mapStaffMember(payload.me) : null,
  };
}

/** Everything the request page draws. Opening it is logged. */
export async function getStaffRequestPage(
  client: SupabaseClient,
  requestId: string
): Promise<StaffRequestPage> {
  const { data, error } = await client.rpc('staff_request_page', { p_request_id: requestId });
  const p = unwrap<Row>(data, error, "Couldn't open that question");
  const r = p.request as Row;
  const j = p.job as Row;
  return {
    request: {
      id: r.id,
      snagId: r.snag_id,
      status: r.status,
      question: r.question,
      createdAt: r.created_at,
      waitingSince: r.waiting_since,
      firstSeenAt: r.first_seen_at ?? null,
      lastStaffReplyAt: r.last_staff_reply_at ?? null,
      assignedTo: r.assigned_to ?? null,
      askedByName: r.asked_by_name ?? null,
    },
    job: {
      id: j.id,
      reference: j.reference,
      description: j.description ?? null,
      room: j.room ?? null,
      photoPaths: j.photo_paths ?? [],
      status: j.status,
      parts: j.parts ?? [],
      bought: j.bought ?? [],
      dueAt: j.due_at ?? null,
      repeatDays: j.repeat_days ?? null,
      createdAt: j.created_at,
      doneAt: j.done_at ?? null,
      lastDoneAt: j.last_done_at ?? null,
      reporterName: j.reporter_name ?? null,
      propertyName: j.property_name ?? null,
      linkedThings: ((j.linked_things ?? []) as Row[]).map((t) => ({
        id: t.id,
        name: t.name,
        room: t.room ?? null,
        make: t.make ?? null,
        model: t.model ?? null,
      })),
    },
    place: {
      name: p.place?.name ?? '',
      suburb: p.place?.suburb ?? null,
      town: p.place?.town ?? null,
    },
    notes: ((p.notes ?? []) as Row[]).map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.created_at,
      authorName: n.author_name ?? null,
    })),
    advice: p.advice ? mapAdvice(p.advice as Row) : null,
    messages: ((p.messages ?? []) as Row[]).map(mapSupportMessage),
    log: ((p.log ?? []) as Row[]).map((l) => ({
      action: l.action,
      at: l.at,
      staffName: l.staff_name,
    })),
    staff: ((p.staff ?? []) as Row[]).map(mapStaffMember),
    me: p.me,
  };
}

/** Claim (your own id), assign (a colleague's) or release (null). */
export async function staffAssign(
  client: SupabaseClient,
  requestId: string,
  staffId: string | null
): Promise<void> {
  const { error } = await client.rpc('staff_assign', { p_request_id: requestId, p_staff_id: staffId });
  if (error) throw asError(error, "Couldn't change who has it");
}

export async function staffAddNote(client: SupabaseClient, requestId: string, body: string): Promise<void> {
  const { error } = await client.rpc('staff_add_note', { p_request_id: requestId, p_body: body });
  if (error) throw asError(error, "Couldn't save that note");
}

/**
 * A reply, with or without an assessment. Returns the message id, which the
 * portal passes to `staffMarkEmailed` once the email has actually gone.
 */
export async function staffReply(
  client: SupabaseClient,
  requestId: string,
  body: string | null,
  advice: AdviceDraft | null
): Promise<string> {
  const { data, error } = await client.rpc('staff_reply', {
    p_request_id: requestId,
    p_body: body,
    p_advice: advice ? cleanAdviceDraft(advice) : null,
  });
  return unwrap<string>(data as string | null, error, "Couldn't send that reply");
}

/** Where the reply's email goes. Only ever called server-side. */
export async function staffReplyEmailTarget(
  client: SupabaseClient,
  requestId: string
): Promise<{ email: string; snagId: string; headline: string; askedByName: string | null } | null> {
  const { data, error } = await client
    .rpc('staff_reply_email_target', { p_request_id: requestId })
    .maybeSingle();
  if (error) throw asError(error, "Couldn't find who asked");
  if (!data) return null;
  const row = data as Row;
  return {
    email: row.email,
    snagId: row.snag_id,
    headline: snagHeadline({ description: row.description ?? null, room: row.room ?? null }),
    askedByName: row.asked_by_name ?? null,
  };
}

export async function staffMarkEmailed(client: SupabaseClient, messageId: string): Promise<void> {
  const { error } = await client.rpc('staff_mark_emailed', { p_message_id: messageId });
  if (error) throw asError(error, "Couldn't record that the email went");
}

export async function staffCloseRequest(
  client: SupabaseClient,
  requestId: string,
  reason: SupportCloseReason
): Promise<void> {
  const { error } = await client.rpc('staff_close_request', {
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) throw asError(error, "Couldn't close that question");
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
