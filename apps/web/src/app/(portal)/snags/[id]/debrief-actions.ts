'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { startDebrief, addDebriefFinding, addDebriefAttendee, addDebriefLesson, completeDebrief } from '@snag/supabase-queries';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

function fail(snagId: string, message: string): never {
  redirect(`/snags/${snagId}?error=${encodeURIComponent(message)}`);
}

export async function startDebriefAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const format = String(formData.get('format') ?? 'hot') as 'hot' | 'formal';
  if (!snagId) return;

  const { error } = await startDebrief(supabase, snagId, format);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function addDebriefFindingAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const debriefId = String(formData.get('debriefId') ?? '');
  const findingText = String(formData.get('findingText') ?? '').trim();
  if (!snagId || !debriefId || !findingText) return;

  const { error } = await addDebriefFinding(supabase, debriefId, findingText);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function addDebriefLessonAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const debriefId = String(formData.get('debriefId') ?? '');
  const lessonText = String(formData.get('lessonText') ?? '').trim();
  if (!snagId || !debriefId || !lessonText) return;

  const { error } = await addDebriefLesson(supabase, debriefId, lessonText);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function addDebriefAttendeeAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const debriefId = String(formData.get('debriefId') ?? '');
  const profileId = String(formData.get('profileId') ?? '');
  if (!snagId || !debriefId || !profileId) return;

  const { error } = await addDebriefAttendee(supabase, debriefId, profileId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}

export async function completeDebriefAction(formData: FormData) {
  await requireSupervisorOrAdmin();
  const supabase = await createClient();
  const snagId = String(formData.get('snagId') ?? '');
  const debriefId = String(formData.get('debriefId') ?? '');
  if (!snagId || !debriefId) return;

  const { error } = await completeDebrief(supabase, debriefId);
  if (error) fail(snagId, error.message);

  revalidatePath(`/snags/${snagId}`);
  redirect(`/snags/${snagId}`);
}
