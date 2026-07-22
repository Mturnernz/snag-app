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

export async function saveRcaWhysAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const rcaId = String(formData.get('rcaId') ?? '');
  if (!snagId || !rcaId) return;

  const results = await Promise.all(
    WHY_INDICES.map((i) => {
      const why = String(formData.get(`why${i}`) ?? '').trim();
      const answer = String(formData.get(`answer${i}`) ?? '').trim();
      if (!why || !answer) return { error: null };
      return saveRcaWhy(supabase, rcaId, i, why, answer);
    })
  );
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) fail(snagId, firstError.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
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
