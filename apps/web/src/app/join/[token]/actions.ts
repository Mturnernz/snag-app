'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PENDING_INVITE_COOKIE } from '@/lib/pendingInvite';
import { destinationAfterAccept } from './destination';

// Where an accepted invite drops you.
//
// This is the decision /go/snag/[id] makes per visitor, made here at the only
// moment it can be: an invitee has no account and therefore no role until the
// invite is accepted, so the answer doesn't exist before this point. Once it
// does, it's the same answer — the portal for people it will admit, the app for
// everyone else.
async function finish(supabase: Awaited<ReturnType<typeof createClient>>, token: string): Promise<never> {
  redirect(await destinationAfterAccept(supabase, token));
}

function backToJoin(token: string, message: string): never {
  redirect(`/join/${token}?error=${encodeURIComponent(message)}`);
}

/** Signed in already with the invited address — just take it up. */
export async function acceptInviteAction(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const name = String(formData.get('name') ?? '').trim();

  if (!name) backToJoin(token, 'Enter your name so your team knows who you are.');

  const supabase = await createClient();
  const { error } = await supabase.rpc('accept_invite', { p_token: token, p_name: name });

  if (error) {
    // accept_invite's messages are written for the person reading them
    // ("This invite has expired", "This invite was sent to a different email
    // address"), so they're passed through rather than flattened into one.
    backToJoin(token, error.message);
  }

  await finish(supabase, token);
}

/** No account yet — the common case, since an invite is usually someone's first
 *  contact with SNAG at all. */
export async function signUpAndAcceptAction(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  // Deliberately from the invite, never from the form. accept_invite compares
  // auth.email() against the invited address, so an editable field here could
  // only ever produce an account that the next step refuses — and would let
  // someone burn a colleague's invite onto their own address.
  const email = String(formData.get('email') ?? '').trim();

  if (!name || !password) backToJoin(token, 'Enter your name and a password.');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    // Most likely "User already registered" — they have an account and should
    // sign in instead, which is a different button on the same page.
    backToJoin(token, error.message);
  }

  if (data.session) {
    // Confirmation is off, so this is already an authenticated session and the
    // invite can be taken up now.
    const { error: acceptError } = await supabase.rpc('accept_invite', {
      p_token: token,
      p_name: name,
    });
    if (acceptError) backToJoin(token, acceptError.message);
    await finish(supabase, token);
  }

  // Confirmation required — no session yet, so accept_invite can't run. Stash
  // it for login/actions.ts, exactly as sign-up does with the pending org.
  const cookieStore = await cookies();
  cookieStore.set(PENDING_INVITE_COOKIE, JSON.stringify({ token, name }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 14, // the invite's own lifetime — a shorter cookie would strand it
    path: '/',
  });

  redirect('/sign-up/check-email');
}
