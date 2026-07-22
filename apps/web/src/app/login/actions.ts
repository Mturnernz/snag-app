'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createOrganisationAndOwner } from '@snag/supabase-queries';
import { createClient } from '@/lib/supabase/server';
import { PENDING_ORG_COOKIE, type PendingOrg } from '@/lib/pendingOrg';

export async function loginAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    redirect('/login?error=' + encodeURIComponent('Enter your email and password.'));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect('/login?error=' + encodeURIComponent('Incorrect email or password.'));
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

  redirect('/dashboard');
}
