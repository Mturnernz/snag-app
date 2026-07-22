'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  completeChecklistStep, addWitnessStatement, addEvidenceItem, setRootCause, uploadSnagEvidenceFile,
} from '@snag/supabase-queries';
import { ChecklistStep } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

function fail(snagId: string, message: string): never {
  redirect(`/snags/${snagId}?error=${encodeURIComponent(message)}`);
}

export async function completeChecklistStepAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const step = String(formData.get('step') ?? '') as ChecklistStep;
  if (!snagId || !step) return;

  const { error } = await completeChecklistStep(supabase, snagId, step);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function addWitnessStatementAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const witnessName = String(formData.get('witnessName') ?? '').trim();
  const statementText = String(formData.get('statementText') ?? '').trim();
  if (!snagId || !witnessName || !statementText) fail(snagId, 'Witness name and statement are both required.');

  const { error } = await addWitnessStatement(supabase, snagId, witnessName, statementText);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function addEvidenceAction(formData: FormData) {
  const { activeMembership } = await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const caption = String(formData.get('caption') ?? '').trim() || null;
  const file = formData.get('file') as File | null;
  if (!snagId || !file || file.size === 0) fail(snagId, 'Choose a file to upload as evidence.');

  const { path, error: uploadError } = await uploadSnagEvidenceFile(supabase, activeMembership.org_id, file.name, file);
  if (uploadError || !path) fail(snagId, `Upload failed: ${uploadError?.message ?? 'unknown error'}`);

  const { error } = await addEvidenceItem(supabase, snagId, path, caption);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function setRootCauseAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const rootCauseText = String(formData.get('rootCauseText') ?? '').trim();
  if (!snagId || !rootCauseText) fail(snagId, 'Enter the root cause before saving.');

  const { error } = await setRootCause(supabase, snagId, rootCauseText);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}
