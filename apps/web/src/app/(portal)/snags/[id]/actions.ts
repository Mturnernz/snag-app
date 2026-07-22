'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  updateSnagStatus, resolveSnag, assignSnagOwner, recategoriseSnag, addComment,
  setNotifiableFlag, unmergeSnag,
} from '@snag/supabase-queries';
import { SnagKind, SnagSeverity, SnagStatus } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

function fail(snagId: string, message: string): never {
  redirect(`/snags/${snagId}?error=${encodeURIComponent(message)}`);
}

export async function changeStatusAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const status = String(formData.get('status') ?? '') as SnagStatus;
  if (!snagId || !status) return;

  const { error } = await updateSnagStatus(supabase, snagId, status);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function resolveNiggleAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  if (!snagId || !note) fail(snagId, 'A resolution note is required.');

  const { error } = await resolveSnag(supabase, snagId, note);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function assignOwnerAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const ownerId = String(formData.get('ownerId') ?? '') || null;
  if (!snagId) return;

  const { error } = await assignSnagOwner(supabase, snagId, ownerId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function recategoriseAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const kind = String(formData.get('kind') ?? '') as SnagKind;
  const severityRaw = String(formData.get('severity') ?? '');
  const severity = (severityRaw || null) as SnagSeverity | null;
  if (!snagId || !kind) return;

  const { error } = await recategoriseSnag(supabase, snagId, kind, severity);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function addCommentAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (!snagId || !body) return;

  const { error } = await addComment(supabase, snagId, body);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function toggleNotifiableAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const value = formData.get('value') === 'true';
  if (!snagId) return;

  const { error } = await setNotifiableFlag(supabase, snagId, value);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function unmergeAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  if (!snagId) return;

  const { error } = await unmergeSnag(supabase, snagId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}
