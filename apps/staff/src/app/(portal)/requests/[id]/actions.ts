'use server';

import { revalidatePath } from 'next/cache';
import {
  staffAddNote,
  staffAssign,
  staffCloseRequest,
  staffReply,
} from '@snag/supabase-queries/staff';
import type { AdviceDraft, SupportCloseReason } from '@snag/shared-types';
import { createStaffClient } from '@/lib/supabase';
import { sendReplyEmail, type EmailOutcome } from '@/lib/replyEmail';

/**
 * Every write on the request page. Each one is a `staff_*` function that
 * checks, server-side, that the caller is staff and the question is still
 * open — so these are thin, and trust nothing about who called them.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };
export type ReplyResult = { ok: true; email: EmailOutcome } | { ok: false; error: string };

const pathFor = (id: string) => `/requests/${id}`;
const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');

export async function assign(requestId: string, staffId: string | null): Promise<ActionResult> {
  try {
    await staffAssign(await createStaffClient(), requestId, staffId);
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  revalidatePath(pathFor(requestId));
  return { ok: true };
}

export async function addNote(requestId: string, body: string): Promise<ActionResult> {
  try {
    await staffAddNote(await createStaffClient(), requestId, body);
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  revalidatePath(pathFor(requestId));
  return { ok: true };
}

/**
 * The reply is saved, then emailed. The two are reported separately because
 * they can fail separately, and a reply that exists but was not emailed must
 * say exactly that.
 */
export async function reply(
  requestId: string,
  body: string | null,
  advice: AdviceDraft | null
): Promise<ReplyResult> {
  const supabase = await createStaffClient();
  let messageId: string;
  try {
    messageId = await staffReply(supabase, requestId, body, advice);
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  const email = await sendReplyEmail(supabase, requestId, messageId);
  revalidatePath(pathFor(requestId));
  return { ok: true, email };
}

export async function resendEmail(requestId: string, messageId: string): Promise<EmailOutcome> {
  const outcome = await sendReplyEmail(await createStaffClient(), requestId, messageId);
  revalidatePath(pathFor(requestId));
  return outcome;
}

export async function close(requestId: string, reason: SupportCloseReason): Promise<ActionResult> {
  try {
    await staffCloseRequest(await createStaffClient(), requestId, reason);
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  revalidatePath('/');
  return { ok: true };
}
