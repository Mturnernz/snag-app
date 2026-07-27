'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assignRca, saveRcaWhy, submitRca, acceptRca, rejectRca, reassignRca, cancelRca } from '@snag/supabase-queries';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const WHY_INDICES = [1, 2, 3, 4, 5];

function fail(snagId: string, message: string): never {
  redirect(`/snags/${snagId}?error=${encodeURIComponent(message)}`);
}

export async function assignRcaAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const assigneeId = String(formData.get('assigneeId') ?? '');
  if (!snagId || !assigneeId) fail(snagId, 'Choose who to assign the RCA to.');

  const { error } = await assignRca(supabase, snagId, assigneeId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

// One why at a time, so the chain can be asked in order.
//
// This replaced a bulk save over all five indices, which existed because the
// page rendered ten inputs at once. The 5 Whys is a chain — why #2 is asked of
// the answer to #1 — and a form showing all five invites five parallel guesses
// at the same question instead of one line of reasoning.
export async function saveRcaWhyAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const rcaId = String(formData.get('rcaId') ?? '');
  const whyIndex = Number(formData.get('whyIndex') ?? 0);
  const whyText = String(formData.get('whyText') ?? '').trim();
  const answerText = String(formData.get('answerText') ?? '').trim();

  if (!snagId || !rcaId) return;
  if (!WHY_INDICES.includes(whyIndex)) fail(snagId, 'That is not one of the five whys.');
  if (!whyText || !answerText) fail(snagId, 'Add both the question and the answer.');

  const { error } = await saveRcaWhy(supabase, rcaId, whyIndex, whyText, answerText);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}?step=rca`);
}

export async function submitRcaAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const rcaId = String(formData.get('rcaId') ?? '');
  if (!snagId || !rcaId) return;

  const { error } = await submitRca(supabase, rcaId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function acceptRcaAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const rcaId = String(formData.get('rcaId') ?? '');
  if (!snagId || !rcaId) return;

  const { error } = await acceptRca(supabase, rcaId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function rejectRcaAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const rcaId = String(formData.get('rcaId') ?? '');
  const rejectionNote = String(formData.get('rejectionNote') ?? '').trim();
  if (!snagId || !rcaId || !rejectionNote) fail(snagId, 'A rejection note is required.');

  const { error } = await rejectRca(supabase, rcaId, rejectionNote);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function reassignRcaAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const rcaId = String(formData.get('rcaId') ?? '');
  const newAssigneeId = String(formData.get('newAssigneeId') ?? '');
  if (!snagId || !rcaId || !newAssigneeId) fail(snagId, 'Choose who to reassign the RCA to.');

  const { error } = await reassignRca(supabase, rcaId, newAssigneeId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function cancelRcaAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const rcaId = String(formData.get('rcaId') ?? '');
  if (!snagId || !rcaId) return;

  const { error } = await cancelRca(supabase, rcaId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}
