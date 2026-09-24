'use server';

import { redirect } from 'next/navigation';
import { createStaffClient } from '@/lib/supabase';

/** Local scope: signing out of the portal on this browser means this browser. */
export async function signOut() {
  const supabase = await createStaffClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/sign-in');
}
