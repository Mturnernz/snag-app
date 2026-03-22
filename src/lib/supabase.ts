import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Profile, UserRole, IssueStatus, IssuePriority, IssueCategory, VoteValue } from '../types';

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
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, organisation_id, invite_code, role, avatar_url, created_at, organisation:organisations(id, name, invite_code, created_at)')
    .eq('id', userId)
    .maybeSingle();
  if (error) console.error('getProfile error:', error);
  return data as Profile | null;
}

export async function updateProfile(userId: string, updates: Partial<Pick<Profile, 'name' | 'avatar_url'>>) {
  return supabase.from('profiles').update(updates).eq('id', userId);
}

// ─── Organisation helpers ─────────────────────────────────────────────────────

export async function createOrganisation(name: string, userId: string) {
  const { data, error } = await supabase.rpc('create_organisation', { org_name: name, calling_user_id: userId });
  return { orgId: data, error };
}

export async function joinOrganisationByCode(inviteCode: string, _userId: string) {
  const { error } = await supabase.rpc('join_organisation_by_code', { invite_code: inviteCode });
  if (error) {
    return { error: { message: 'Invalid invite code. Please check and try again.' } };
  }
  return { error: null };
}

// ─── Admin helpers ────────────────────────────────────────────────────────────

export async function getOrgMembers(orgId: string): Promise<Profile[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id, name, email, role, avatar_url, organisation_id, invite_code, created_at')
    .eq('organisation_id', orgId)
    .order('created_at', { ascending: true });
  return (data ?? []) as Profile[];
}

export async function updateMemberRole(memberId: string, role: UserRole) {
  return supabase.from('profiles').update({ role }).eq('id', memberId);
}

export interface OrgStats {
  totalMembers: number;
  totalIssues: number;
  byStatus: Record<IssueStatus, number>;
  byPriority: Record<IssuePriority, number>;
  byCategory: Record<IssueCategory, number>;
}

export async function getOrgStats(orgId: string): Promise<OrgStats> {
  const [membersRes, issuesRes] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organisation_id', orgId),
    supabase.from('issues').select('status, priority, category').eq('organisation_id', orgId),
  ]);

  const totalMembers = membersRes.count ?? 0;
  const issues = (issuesRes.data ?? []) as { status: IssueStatus; priority: IssuePriority; category: IssueCategory }[];

  const byStatus: Record<IssueStatus, number> = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
  const byPriority: Record<IssuePriority, number> = { low: 0, medium: 0, high: 0 };
  const byCategory: Record<IssueCategory, number> = { niggle: 0, broken_equipment: 0, health_and_safety: 0, other: 0 };

  for (const issue of issues) {
    byStatus[issue.status]++;
    byPriority[issue.priority]++;
    byCategory[issue.category]++;
  }

  return { totalMembers, totalIssues: issues.length, byStatus, byPriority, byCategory };
}

// ─── Issue helpers ────────────────────────────────────────────────────────────

export async function updateIssue(
  issueId: string,
  updates: { status?: IssueStatus; priority?: IssuePriority; category?: IssueCategory; assignee_id?: string | null }
) {
  return supabase.from('issues').update(updates).eq('id', issueId);
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
