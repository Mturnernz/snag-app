'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createOrganisationAndOwner } from '@snag/supabase-queries';
import { createClient } from '@/lib/supabase/server';
import { PENDING_ORG_COOKIE } from '@/lib/pendingOrg';

// Mirrors apps/mobile's pendingIntent.ts pattern: the org name is captured up
// front, before auth.signUp, so that whether or not email confirmation is
// required, the organisation gets created automatically the moment we have
// an authenticated session — either right here (confirmation off) or on the
// first subsequent login (confirmation on, consumed in login/actions.ts).

export async function signUpAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const ownerName = String(formData.get('ownerName') ?? '').trim();
  const orgName = String(formData.get('orgName') ?? '').trim();

  if (!email || !password || !ownerName || !orgName) {
    redirect('/sign-up?error=' + encodeURIComponent('All fields are required.'));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect('/sign-up?error=' + encodeURIComponent(error.message));
  }

  const cookieStore = await cookies();

  if (data.session) {
    // Email confirmation is off — we already have an authenticated session,
    // so create the org immediately instead of waiting for a login that
    // will never come (the user is already signed in).
    const { error: orgError } = await createOrganisationAndOwner(supabase, orgName, ownerName);
    if (orgError) {
      redirect('/sign-up?error=' + encodeURIComponent('Account created, but the organisation could not be created: ' + orgError.message));
    }
    redirect('/dashboard');
  }

  // Confirmation required — stash the org details for login/actions.ts to
  // pick up once the user confirms and signs in.
  cookieStore.set(PENDING_ORG_COOKIE, JSON.stringify({ orgName, ownerName }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // a week — plenty of time to check email and confirm
    path: '/',
  });

  redirect('/sign-up/check-email');
}
