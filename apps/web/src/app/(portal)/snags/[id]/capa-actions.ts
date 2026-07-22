'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createCorrectiveAction, completeCorrectiveAction, verifyCorrectiveAction } from '@snag/supabase-queries';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

function fail(snagId: string, message: string): never {
  redirect(`/snags/${snagId}?error=${encodeURIComponent(message)}`);
}

export async function createCorrectiveActionAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const ownerId = String(formData.get('ownerId') ?? '');
  const dueDate = String(formData.get('dueDate') ?? '');
  if (!snagId || !description || !ownerId || !dueDate) fail(snagId, 'Description, owner, and due date are all required.');

  const { error } = await createCorrectiveAction(supabase, snagId, description, ownerId, dueDate);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function completeCorrectiveActionAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const actionId = String(formData.get('actionId') ?? '');
  if (!snagId || !actionId) return;

  const { error } = await completeCorrectiveAction(supabase, actionId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function verifyCorrectiveActionAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const actionId = String(formData.get('actionId') ?? '');
  if (!snagId || !actionId) return;

  const { error } = await verifyCorrectiveAction(supabase, actionId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}
