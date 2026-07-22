'use server';

import { redirect } from 'next/navigation';
import { mergeSnags } from '@snag/supabase-queries';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function mergeSelectedAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();

  const snagIds = formData.getAll('snagIds').map(String).filter(Boolean);
  if (snagIds.length < 2) {
    redirect('/snags?error=' + encodeURIComponent('Select at least two snags to merge.'));
  }

  const { data, error } = await mergeSnags(supabase, { snagIds });
  if (error || !data) {
    redirect('/snags?error=' + encodeURIComponent(error?.message ?? 'Could not merge those snags.'));
  }

  redirect(`/snags/${data.id}`);
}
