'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  updateSnagStatus, resolveSnag, assignSnagOwner, recategoriseSnag, addComment,
  setNotifiableFlag, unmergeSnag, assignInvestigation,
  recordResolutionException, RESOLUTION_EXCEPTION_MIN_LENGTH,
} from '@snag/supabase-queries';
import { SnagKind, SnagSeverity, SnagStatus } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

function fail(snagId: string, message: string): never {
  redirect(`/snags/${snagId}?error=${encodeURIComponent(message)}`);
}

export async function changeStatusAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const status = String(formData.get('status') ?? '') as SnagStatus;
  if (!snagId || !status) return;

  const { error } = await updateSnagStatus(supabase, snagId, status);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

/**
 * Resolving a serious snag whose investigation isn't finished.
 *
 * Separate from changeStatusAction rather than a flag on it: that action is
 * reached from a button that means "this is done", and this one is reached from
 * a form that makes somebody type why it isn't. The server enforces the reason
 * either way — update_snag_status refuses `resolved` over an unmet gate without
 * one — so the length check here is only to keep the round trip out of the way
 * of an obvious mistake.
 */
export async function resolveWithExceptionAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!snagId) return;
  if (reason.length < RESOLUTION_EXCEPTION_MIN_LENGTH) {
    fail(snagId, 'Explain why this is being resolved with the investigation incomplete.');
  }

  const { error } = await updateSnagStatus(supabase, snagId, 'resolved', reason, reason);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

/** The same reason on a snag that was closed before the app asked for one. */
export async function recordResolutionExceptionAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!snagId) return;
  if (reason.length < RESOLUTION_EXCEPTION_MIN_LENGTH) {
    fail(snagId, 'Explain why this was resolved with the investigation incomplete.');
  }

  const { error } = await recordResolutionException(supabase, snagId, reason);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function resolveNiggleAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (!snagId || !note) fail(snagId, 'A resolution note is required.');

  const { error } = await resolveSnag(supabase, snagId, note);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

/**
 * Allocating a snag. On the serious lane this is also where the investigation
 * gets its mode and its lead.
 *
 * The prompt lives here rather than behind a separate "Assign investigation"
 * button because allocating is when a supervisor is already deciding who deals
 * with this — asking twice, in two places, is how a snag ends up with an owner
 * and no investigator. The owner *is* the lead investigator: one person is
 * accountable for the snag, and splitting the two roles buys nothing except a
 * second thing to keep in sync.
 *
 * Mode is only sent when someone is actually named, because assign_investigation
 * needs an assignee. Unassigning a serious snag therefore leaves the existing
 * mode alone rather than silently reverting it to the guided process.
 */
export async function assignOwnerAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const ownerId = String(formData.get('ownerId') ?? '') || null;
  const modeRaw = String(formData.get('mode') ?? '');
  if (!snagId) return;

  const { error } = await assignSnagOwner(supabase, snagId, ownerId);
  if (error) fail(snagId, error.message);

  if (ownerId && (modeRaw === 'snag' || modeRaw === 'document')) {
    const { error: modeError } = await assignInvestigation(supabase, snagId, ownerId, modeRaw);
    if (modeError) fail(snagId, modeError.message);
  }

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

/**
 * Triage: the three decisions in one submit — how it's investigated, who runs
 * it, and whether it's notifiable. The portal half of the same prompt
 * apps/mobile's TriageSheet makes; both write the same three RPCs in the same
 * order, and all three are supervisor/admin-gated server-side too.
 *
 * Order matters. assign_snag_owner fires notify_after_snag_update, which mails
 * the new owner — and that mail names how the investigation is being run, so
 * the investigations row has to exist before it goes out. Allocating first also
 * means a failure leaves the snag untriaged rather than owned-but-unallocated.
 *
 * `notifiable = 'later'` writes nothing: the decision carries a statutory
 * threshold, and a modal is no place to make somebody guess. It stays on the
 * resolve gate and the prompt asks again next visit.
 */
export async function triageAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const investigatorId = String(formData.get('investigatorId') ?? '');
  const modeRaw = String(formData.get('mode') ?? '');
  const notifiable = String(formData.get('notifiable') ?? '');
  if (!snagId) return;
  if (!investigatorId) fail(snagId, 'Pick who is running the investigation.');
  if (modeRaw !== 'snag' && modeRaw !== 'document') fail(snagId, 'Pick how this will be investigated.');
  if (notifiable !== 'yes' && notifiable !== 'no' && notifiable !== 'later') {
    fail(snagId, 'Answer the notifiable question, or say you are not sure yet.');
  }

  const { error: modeError } = await assignInvestigation(supabase, snagId, investigatorId, modeRaw);
  if (modeError) fail(snagId, modeError.message);

  const { error: ownerError } = await assignSnagOwner(supabase, snagId, investigatorId);
  if (ownerError) fail(snagId, ownerError.message);

  if (notifiable !== 'later') {
    const { error: notifiableError } = await setNotifiableFlag(supabase, snagId, notifiable === 'yes');
    if (notifiableError) fail(snagId, notifiableError.message);
  }

  revalidatePath(`/snags/${snagId}`);
  // `?triaged=1` means "this visit has already answered it". The redirect
  // carries it so a cached render can't put the modal straight back up on the
  // navigation that answered it; the read-only portal specs use it for the same
  // reason, since answering the prompt is a write they must not make.
  redirect(`/snags/${snagId}?triaged=1`);
}

export async function recategoriseAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const kind = String(formData.get('kind') ?? '') as SnagKind;
  const severityRaw = String(formData.get('severity') ?? '');
  const severity = (severityRaw || null) as SnagSeverity | null;
  if (!snagId || !kind) return;

  const { error } = await recategoriseSnag(supabase, snagId, kind, severity);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function addCommentAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (!snagId || !body) return;

  const { error } = await addComment(supabase, snagId, body);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

// Named for what it records, not what it flips: the portal now asks the
// question and stores the answer, so "toggle" no longer describes it. Either
// answer stamps notifiable_marked_at server-side, which is what satisfies the
// resolve gate.
export async function setNotifiableDecisionAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const value = formData.get('value') === 'true';
  if (!snagId) return;

  const { error } = await setNotifiableFlag(supabase, snagId, value);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function unmergeAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  if (!snagId) return;

  const { error } = await unmergeSnag(supabase, snagId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}
