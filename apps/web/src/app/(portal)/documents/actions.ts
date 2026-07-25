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
  const { activeMembership } = await requireSupervisorOrAdmin();
  const supabase = await createClient();

  const documentId = String(formData.get('documentId') ?? '');
  if (!documentId) redirect('/documents');

  // Read file_path from the row rather than trusting the hidden form field it
  // used to come from — the path was client-supplied and never cross-checked
  // against documentId (PRODUCT_REVIEW.md §3.5). RLS scopes this select to the
  // caller's org, so a foreign id simply finds nothing.
  const { data: doc } = await supabase
    .from('org_documents')
    .select('file_path')
    .eq('id', documentId)
    .eq('org_id', activeMembership.org_id)
    .maybeSingle();

  if (!doc) {
    redirect('/documents?error=' + encodeURIComponent('That document no longer exists.'));
  }

  // Check the RPC before touching storage. The old order deleted the object
  // regardless, so a rejected RPC left a metadata row pointing at nothing.
  const { error: deleteError } = await deleteOrgDocument(supabase, documentId);
  if (deleteError) {
    redirect('/documents?error=' + encodeURIComponent(`Could not delete: ${deleteError.message}`));
  }

  const { error: storageError } = await supabase.storage.from(BUCKET).remove([doc.file_path]);
  if (storageError) {
    // The row is gone, so the document is no longer listed or reachable; the
    // object is orphaned. Surface it rather than reporting a clean delete.
    redirect('/documents?error=' + encodeURIComponent(
      'Document removed, but its file could not be deleted from storage. Please report this.'
    ));
  }

  redirect('/documents');
}
