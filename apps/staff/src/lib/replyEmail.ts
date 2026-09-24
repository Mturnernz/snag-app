import {
  staffMarkEmailed,
  staffReplyEmailTarget,
  supportReplyEmail,
} from '@snag/supabase-queries/staff';
import type { StaffClient } from '@/lib/supabase';

export type EmailOutcome = { emailed: true } | { emailed: false; reason: string };

const APP_URL = process.env.NEXT_PUBLIC_SNAG_APP_URL ?? 'https://app.snaghq.co.nz';

/**
 * The one email a reply sends, through Resend. Server-only: the key and the
 * household's address never reach a browser.
 *
 * **It is recorded only once Resend has accepted it.** The retired product's
 * invite screen said "sent" for the whole life of a feature that never sent
 * anything, and the rule that came out of it is that a screen only claims what
 * it can check. So the reply is saved first, whatever happens here, and
 * `emailed_at` is set only on a 2xx; anything else comes back as a sentence
 * the portal shows beside the reply with a way to try again.
 *
 * The message id is the idempotency key, so a retry after a timeout that did
 * in fact deliver cannot send the household a second copy.
 */
export async function sendReplyEmail(
  supabase: StaffClient,
  requestId: string,
  messageId: string
): Promise<EmailOutcome> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { emailed: false, reason: "Email isn't set up on this site yet (RESEND_API_KEY)." };

  let target;
  try {
    target = await staffReplyEmailTarget(supabase, requestId);
  } catch (err) {
    return { emailed: false, reason: (err as Error).message };
  }
  if (!target?.email) {
    return { emailed: false, reason: 'The person who asked has no email address on their account any more.' };
  }

  const email = supportReplyEmail({
    headline: target.headline,
    snagId: target.snagId,
    askedByName: target.askedByName,
    appUrl: APP_URL,
  });

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `support-reply-${messageId}`,
      },
      body: JSON.stringify({
        from: process.env.SUPPORT_EMAIL_FROM ?? 'SnagHQ <help@snaghq.co.nz>',
        to: [target.email],
        subject: email.subject,
        text: email.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { emailed: false, reason: "Couldn't reach the email service." };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return {
      emailed: false,
      reason: `The email service said no (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}.`,
    };
  }

  try {
    await staffMarkEmailed(supabase, messageId);
  } catch {
    // It went. Failing to write that down is not a reason to send it again,
    // and the idempotency key would refuse a second send anyway.
    return { emailed: false, reason: 'The email went, but recording that it did failed — refresh to check.' };
  }
  return { emailed: true };
}
