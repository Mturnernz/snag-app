'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  attachInvestigationDocument, acceptInvestigationDocument,
  uploadOrgDocumentFile, createOrgDocument,
} from '@snag/supabase-queries';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

function fail(snagId: string, message: string): never {
  redirect(`/snags/${snagId}?step=investigationDocument&error=${encodeURIComponent(message)}`);
}

/** Attach something already in the org's document library. */
export async function attachInvestigationDocumentAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');
  if (!snagId || !documentId) fail(snagId, 'Choose a document from the library.');

  const { error } = await attachInvestigationDocument(supabase, snagId, documentId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}?step=investigationDocument`);
}

/**
 * Upload a new file and attach it in one step.
 *
 * It goes into the org document library on the way past rather than into a
 * per-snag hiding place. An investigation report is an organisational record —
 * the person who needs it in two years is someone who wasn't on this snag and
 * won't think to look at it.
 */
export async function uploadInvestigationDocumentAction(formData: FormData) {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const file = formData.get('file') as File | null;
  const title = String(formData.get('title') ?? '').trim();
  if (!snagId || !file || file.size === 0) fail(snagId, 'Choose a file to upload.');
  if (!title) fail(snagId, 'Give the document a title so it can be found in the library later.');

  const { path, error: uploadError } = await uploadOrgDocumentFile(
    supabase, activeMembership.org_id, file.name, file,
  );
  if (uploadError || !path) fail(snagId, `Upload failed: ${uploadError?.message ?? 'unknown error'}`);

  const { id: documentId, error: createError } = await createOrgDocument(
    supabase, path, title, 'investigation',
  );
  if (createError || !documentId) fail(snagId, createError?.message ?? 'Could not file the document.');

  const { error } = await attachInvestigationDocument(supabase, snagId, documentId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  revalidatePath('/documents');
  redirect(`/snags/${snagId}?step=investigationDocument`);
}

/**
 * Sign the document off — a separate act from attaching it, but not necessarily
 * by a separate person. The acceptor-cannot-be-the-attacher rule was reverted in
 * 20260729000200: it only ever bit the case where a supervisor did the work
 * themselves, and there it deadlocked a one-supervisor org. Both
 * `document_attached_by` and `document_accepted_by` are recorded and shown, so a
 * self-signed investigation is visible in the record rather than prevented.
 */
export async function acceptInvestigationDocumentAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  if (!snagId) return;

  const { error } = await acceptInvestigationDocument(supabase, snagId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}?step=investigationDocument`);
}
