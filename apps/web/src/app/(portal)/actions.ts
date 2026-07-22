'use server';

import { redirect } from 'next/navigation';
import { setActiveOrg } from '@snag/supabase-queries';
import { createClient } from '@/lib/supabase/server';

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function switchOrgAction(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '');
  if (!orgId) return;
  const supabase = await createClient();
  await setActiveOrg(supabase, orgId);
  redirect('/dashboard');
}
