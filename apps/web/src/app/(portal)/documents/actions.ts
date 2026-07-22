'use server';

import { redirect } from 'next/navigation';
import { createOrgDocument, deleteOrgDocument } from '@snag/supabase-queries';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const BUCKET = 'org-documents';

export async function uploadDocumentAction(formData: FormData) {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const supabase = await createClient();

  const file = formData.get('file') as File | null;
  const title = String(formData.get('title') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim() || null;

  if (!file || file.size === 0 || !title) {
    redirect('/documents?error=' + encodeURIComponent('Please choose a file and enter a title.'));
  }

  const path = `${activeMembership.org_id}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (uploadError) {
    redirect('/documents?error=' + encodeURIComponent(`Upload failed: ${uploadError.message}`));
  }

  const { error: recordError } = await createOrgDocument(supabase, path, title, category);
  if (recordError) {
    // Metadata row failed — clean up the orphaned file rather than leaving
    // an unlisted object in the bucket.
    await supabase.storage.from(BUCKET).remove([path]);
    redirect('/documents?error=' + encodeURIComponent(`Could not save the document: ${recordError.message}`));
  }

  redirect('/documents');
}

export async function deleteDocumentAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();

  const documentId = String(formData.get('documentId') ?? '');
  const filePath = String(formData.get('filePath') ?? '');
  if (!documentId || !filePath) redirect('/documents');

  await deleteOrgDocument(supabase, documentId);
  await supabase.storage.from(BUCKET).remove([filePath]);

  redirect('/documents');
}
