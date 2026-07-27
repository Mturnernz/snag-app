'use server';

import { redirect } from 'next/navigation';
import { setActiveOrg } from '@snag/supabase-queries';
import { createClient } from '@/lib/supabase/server';

export async function signOutAction() {
  const supabase = await createClient();
  // Local scope, not the supabase-js default of 'global'. Global revokes every
  // refresh token the user has, so signing out of the portal on a desktop also
  // signed them out of the SNAG app on their phone — which nobody pressing
  // "Sign out" in a browser is asking for. This ends this session only.
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}

export async function switchOrgAction(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  if (!orgId) return;
  const supabase = await createClient();
  await setActiveOrg(supabase, orgId);
  redirect('/dashboard');
}
