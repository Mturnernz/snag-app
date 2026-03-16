import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Profile, VoteValue } from '../types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env and fill in your credentials.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    // Disable Web Locks API on web — prevents "Lock broken by another request
    // with the 'steal' option" AbortErrors on page load/reload.
    ...(Platform.OS === 'web' && {
      lock: (_name: string, _acquireTimeout: number, fn: () => Promise<unknown>) => fn(),
    }),
  },
});

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUpWithEmail(email: string, password: string) {
  return supabase.auth.signUp({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ─── Profile helpers ──────────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*, organisation:organisations(*)')
    .eq('id', userId)
    .maybeSingle();
  return data as Profile | null;
}

export async function updateProfile(userId: string, updates: Partial<Pick<Profile, 'name' | 'avatar_url'>>) {
  return supabase.from('profiles').update(updates).eq('id', userId);
}

// ─── Organisation helpers ─────────────────────────────────────────────────────

export async function createOrganisation(name: string, _userId: string) {
  const { data, error } = await supabase.rpc('create_organisation', { org_name: name });
  return { orgId: data, error };
}

export async function joinOrganisationByCode(inviteCode: string, userId: string) {
  // Find the org by invite code (stored on the admin's profile)
  const { data: adminProfile, error } = await supabase
    .from('profiles')
    .select('organisation_id')
    .eq('invite_code', inviteCode.toUpperCase())
    .single();

  if (error || !adminProfile?.organisation_id) {
    return { error: { message: 'Invalid invite code. Please check and try again.' } };
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ organisation_id: adminProfile.organisation_id, role: 'worker' })
    .eq('id', userId);

  return { error: updateError };
}

// ─── Vote helpers ─────────────────────────────────────────────────────────────

export async function upsertVote(issueId: string, userId: string, value: VoteValue) {
  return supabase
    .from('votes')
    .upsert({ issue_id: issueId, user_id: userId, value }, { onConflict: 'issue_id,user_id' });
}

export async function deleteVote(issueId: string, userId: string) {
  return supabase
    .from('votes')
    .delete()
    .eq('issue_id', issueId)
    .eq('user_id', userId);
}

export async function getUserVote(issueId: string, userId: string): Promise<VoteValue | null> {
  const { data } = await supabase
    .from('votes')
    .select('value')
    .eq('issue_id', issueId)
    .eq('user_id', userId)
    .single();
  return data ? data.value as VoteValue : null;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const ISSUE_PHOTOS_BUCKET = 'issue-photos';

export async function uploadIssuePhoto(
  localUri: string,
  fileName: string
): Promise<string | null> {
  const response = await fetch(localUri);
  const blob = await response.blob();

  const { data, error } = await supabase.storage
    .from(ISSUE_PHOTOS_BUCKET)
    .upload(`public/${fileName}`, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error || !data) {
    console.error('Photo upload error:', error);
    return null;
  }

  const { data: { publicUrl } } = supabase.storage
    .from(ISSUE_PHOTOS_BUCKET)
    .getPublicUrl(data.path);

  return publicUrl;
}
