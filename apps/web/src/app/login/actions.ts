'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createOrganisationAndOwner } from '@snag/supabase-queries';
import { createClient } from '@/lib/supabase/server';
import { PENDING_ORG_COOKIE, type PendingOrg } from '@/lib/pendingOrg';
import { PENDING_INVITE_COOKIE, type PendingInvite } from '@/lib/pendingInvite';
import { safeNextPath } from '@/lib/nextPath';

export async function loginAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  // Where to land afterwards. /go/snag/[id] sends a signed-out supervisor here
  // with the snag they were trying to reach, so that dropping them on the
  // dashboard would lose the very thing the notification was about.
  // safeNextPath keeps this from becoming an open redirect.
  const next = safeNextPath(String(formData.get('next') ?? '')) ?? '/dashboard';

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent('Enter your email and password.')}`
      + (next === '/dashboard' ? '' : `&next=${encodeURIComponent(next)}`));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent('Incorrect email or password.')}`
      + (next === '/dashboard' ? '' : `&next=${encodeURIComponent(next)}`));
  }

  // Consume a pending org-creation intent from sign-up (see
  // (marketing)/sign-up/actions.ts) — this is where it lands when email
  // confirmation was required, so this is the first authenticated moment.
  const cookieStore = await cookies();
  const pendingRaw = cookieStore.get(PENDING_ORG_COOKIE)?.value;
  if (pendingRaw) {
    cookieStore.delete(PENDING_ORG_COOKIE);
    try {
      const pending = JSON.parse(pendingRaw) as PendingOrg;
      await createOrganisationAndOwner(supabase, pending.orgName, pending.ownerName);
    } catch {
      // Malformed cookie — nothing to recover, the user can be invited to
      // an org another way if this was actually lost.
    }
  }

  // Consume a pending invite the same way. This is the confirmation-on path
  // from /join/<token>: accept_invite compares auth.email(), so it could not
  // have run at sign-up time when there was no session. This is the first
  // moment there is one.
  const pendingInviteRaw = cookieStore.get(PENDING_INVITE_COOKIE)?.value;
  if (pendingInviteRaw) {
    cookieStore.delete(PENDING_INVITE_COOKIE);

    // Parsed in isolation, and nothing else goes in this try. redirect() works
    // by throwing NEXT_REDIRECT, so a bare `catch` around it swallows the
    // redirect and silently falls through to the next one.
    let pending: PendingInvite | null = null;
    try {
      pending = JSON.parse(pendingInviteRaw) as PendingInvite;
    } catch {
      // Malformed cookie. The invite itself is untouched, so the link in their
      // email still works — nothing is lost by falling through.
    }

    if (pending?.token) {
      const { error: acceptError } = await supabase.rpc('accept_invite', {
        p_token: pending.token,
        p_name: pending.name,
      });
      // On failure, send them to the invite page rather than the dashboard —
      // it can explain *why* (expired, cancelled, wrong address), which a
      // dashboard they have no membership for cannot.
      if (acceptError) redirect(`/join/${pending.token}`);
    }
  }

  redirect(next);
}
