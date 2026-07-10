import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  Profile, UserRole, Snag, SnagStatus, SnagKind, SnagSeverity, VoteValue,
  ChecklistStep, WitnessStatement, EvidenceItem,
} from '../types';

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

// profiles.org_id/role mirror the user's ACTIVE membership (kept in sync by
// set_active_org and the membership RPCs), so this shape stays correct across
// org switches. Org-membership lockout is enforced server-side by RLS, not by
// the deprecated profiles.removed_at column.
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, org_id, name, email, role, created_at, organisation:organisations(id, name, industry, plan_tier, join_code, is_public, public_intake_site_id, created_at)')
    .eq('id', userId)
    .maybeSingle();
  if (error) console.error('getProfile error:', error);
  return data as unknown as Profile | null;
}

export async function updateProfile(userId: string, updates: Partial<Pick<Profile, 'name'>>) {
  return supabase.from('profiles').update(updates).eq('id', userId);
}

// ─── Organisation / site / invite helpers ────────────────────────────────────

export async function createOrganisationAndOwner(orgName: string, ownerName: string) {
  const { data, error } = await supabase.rpc('create_organisation_and_owner', {
    p_org_name: orgName,
    p_name: ownerName,
  });
  return { orgId: data as string | null, error };
}

export interface InvitePreview {
  org_name: string;
  site_name: string | null;
  role: UserRole;
  email: string;
  status: string;
  expires_at: string;
}

export async function getInvitePreview(token: string) {
  const { data, error } = await supabase.rpc('get_invite_preview', { p_token: token }).single();
  return { data: data as InvitePreview | null, error };
}

export async function acceptInvite(token: string, name: string) {
  const { error } = await supabase.rpc('accept_invite', { p_token: token, p_name: name });
  if (error) {
    return { error: { message: 'This invite is invalid or has expired.' } };
  }
  return { error: null };
}

export async function inviteUser(email: string, role: UserRole, siteId: string | null) {
  const { data, error } = await supabase.rpc('invite_user', {
    p_email: email,
    p_role: role,
    p_site_id: siteId,
  });
  return { inviteId: data as string | null, error };
}

export async function getPendingInvites(orgId: string) {
  const { data } = await supabase
    .from('invites')
    .select('id, email, role, status, created_at, expires_at')
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return data ?? [];
}

// ─── QR join code ─────────────────────────────────────────────────────────────

export async function regenerateOrgJoinCode() {
  const { data, error } = await supabase.rpc('regenerate_org_join_code');
  return { code: data as string | null, error };
}

export interface OrgJoinPreview {
  org_id: string;
  org_name: string;
}

export async function getOrgByJoinCode(code: string) {
  const { data, error } = await supabase.rpc('get_org_by_join_code', { p_code: code }).single();
  return { data: data as OrgJoinPreview | null, error };
}

export async function joinOrgViaCode(code: string, name: string) {
  const { error } = await supabase.rpc('join_org_via_code', { p_code: code, p_name: name });
  return { error };
}

// A real site picker is a Phase 4 feature (multi-site isn't in this pass's
// scope). Reports still need a valid site_id, so resolve the user's first
// site membership — falling back to the org's first site if they have none —
// rather than blocking reporting on a UI that doesn't exist yet.
export async function getDefaultSiteId(orgId: string): Promise<string | null> {
  const { data: memberSiteIds } = await supabase.rpc('my_member_site_ids');
  if (memberSiteIds && memberSiteIds.length > 0) {
    return memberSiteIds[0] as string;
  }

  const { data: orgSites } = await supabase
    .from('sites')
    .select('id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1);
  return orgSites?.[0]?.id ?? null;
}

// ─── Admin helpers ────────────────────────────────────────────────────────────

// Member lists come from org_memberships (via RPC), not profiles.org_id —
// that column mirrors each user's *active* org, which for multi-org members
// may be a different organisation right now.
export async function getOrgMembers(_orgId?: string): Promise<Profile[]> {
  const { data } = await supabase.rpc('get_org_members');
  return (data ?? []) as Profile[];
}

export async function updateMemberRole(memberId: string, role: UserRole) {
  return supabase.rpc('update_member_role', { p_member_id: memberId, p_role: role });
}

export async function removeOrgMember(memberId: string) {
  return supabase.rpc('remove_org_member', { p_member_id: memberId });
}

// ─── Multi-org membership helpers ─────────────────────────────────────────────

export interface Membership {
  org_id: string;
  org_name: string;
  role: UserRole;
  is_active: boolean;
}

export async function getMemberships(): Promise<Membership[]> {
  const { data } = await supabase.rpc('get_my_memberships');
  return (data ?? []) as Membership[];
}

export async function setActiveOrg(orgId: string) {
  return supabase.rpc('set_active_org', { p_org_id: orgId });
}

// ─── Public organisations ─────────────────────────────────────────────────────

export interface PublicOrg {
  org_id: string;
  org_name: string;
}

export async function searchPublicOrgs(query?: string): Promise<PublicOrg[]> {
  const { data } = await supabase.rpc('search_public_orgs', { p_query: query ?? null });
  return (data ?? []) as PublicOrg[];
}

export async function createPublicSnag(params: {
  orgId: string;
  description: string;
  photoPaths: string[];
  isHazard: boolean;
  reporterName?: string | null;
}) {
  const { data, error } = await supabase.rpc('create_public_snag', {
    p_org_id: params.orgId,
    p_description: params.description,
    p_photo_paths: params.photoPaths,
    p_is_hazard: params.isHazard,
    p_reporter_name: params.reporterName ?? null,
  }).single();
  return { data: data as { id: string; reference: string } | null, error };
}

export async function setOrgPublicMode(enabled: boolean, intakeSiteId?: string | null) {
  return supabase.rpc('set_org_public_mode', {
    p_enabled: enabled,
    p_intake_site_id: intakeSiteId ?? null,
  });
}

export async function blockPublicReporter(snagId: string) {
  return supabase.rpc('block_public_reporter', { p_snag_id: snagId });
}

export async function getOrgSites(orgId: string): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase
    .from('sites')
    .select('id, name')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  return data ?? [];
}

// ─── Site & organisation management (admin) ───────────────────────────────────

export interface SiteDetail {
  id: string;
  name: string;
  location: string | null;
  memberIds: string[];
  supervisorIds: string[];
  defaultOwnerId: string | null;
}

// Sites for the active org, each with its member/supervisor/default-owner ids.
// Everything is org-scoped by RLS via current_org_id().
export async function getSitesWithDetail(): Promise<SiteDetail[]> {
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, location')
    .order('created_at', { ascending: true });
  if (!sites || sites.length === 0) return [];

  const siteIds = sites.map((s) => s.id);
  const [membersRes, supsRes, ownersRes] = await Promise.all([
    supabase.from('site_members').select('site_id, user_id').in('site_id', siteIds),
    supabase.from('site_supervisors').select('site_id, user_id').in('site_id', siteIds),
    supabase.from('site_default_owners').select('site_id, owner_id').in('site_id', siteIds),
  ]);
  const members = membersRes.data ?? [];
  const sups = supsRes.data ?? [];
  const owners = ownersRes.data ?? [];

  return sites.map((s: any) => ({
    id: s.id,
    name: s.name,
    location: s.location,
    memberIds: members.filter((m: any) => m.site_id === s.id).map((m: any) => m.user_id),
    supervisorIds: sups.filter((m: any) => m.site_id === s.id).map((m: any) => m.user_id),
    defaultOwnerId: owners.find((o: any) => o.site_id === s.id)?.owner_id ?? null,
  }));
}

export async function createSite(name: string, location?: string | null) {
  return supabase.rpc('create_site', { p_name: name, p_location: location ?? null });
}

export async function addSiteMember(siteId: string, userId: string) {
  return supabase.rpc('add_site_member', { p_site_id: siteId, p_user_id: userId });
}

export async function removeSiteMember(siteId: string, userId: string) {
  return supabase.rpc('remove_site_member', { p_site_id: siteId, p_user_id: userId });
}

export async function assignSiteSupervisor(siteId: string, userId: string) {
  return supabase.rpc('assign_site_supervisor', { p_site_id: siteId, p_user_id: userId });
}

export async function removeSiteSupervisor(siteId: string, userId: string) {
  return supabase.rpc('remove_site_supervisor', { p_site_id: siteId, p_user_id: userId });
}

export async function setSiteDefaultOwner(siteId: string, ownerId: string) {
  return supabase.rpc('set_site_default_owner', { p_site_id: siteId, p_owner_id: ownerId });
}

export async function renameOrganisation(name: string) {
  return supabase.rpc('rename_organisation', { p_name: name });
}

export interface OrgStats {
  totalMembers: number;
  totalSnags: number;
  byStatus: Record<SnagStatus, number>;
  byKind: Record<SnagKind, number>;
  bySeverity: Record<SnagSeverity, number>;
}

export async function getOrgStats(orgId: string): Promise<OrgStats> {
  const [membersRes, snagsRes] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    supabase.from('snags').select('status, kind, severity').eq('org_id', orgId),
  ]);

  const totalMembers = membersRes.count ?? 0;
  const snags = (snagsRes.data ?? []) as { status: SnagStatus; kind: SnagKind; severity: SnagSeverity | null }[];

  const byStatus: Record<SnagStatus, number> = { flagged: 0, in_progress: 0, resolved: 0, rca_pending: 0 };
  const byKind: Record<SnagKind, number> = { fixit: 0, improvement: 0, hazard: 0, incident: 0 };
  const bySeverity: Record<SnagSeverity, number> = { minor: 0, moderate: 0, injury: 0, critical: 0 };

  for (const snag of snags) {
    byStatus[snag.status]++;
    byKind[snag.kind]++;
    if (snag.severity) bySeverity[snag.severity]++;
  }

  return { totalMembers, totalSnags: snags.length, byStatus, byKind, bySeverity };
}

// ─── Snag helpers ─────────────────────────────────────────────────────────────

export async function createSnag(params: {
  kind: SnagKind;
  description: string | null;
  severity: SnagSeverity | null;
  photoPaths: string[];
  latitude: number | null;
  longitude: number | null;
  siteId: string;
}) {
  const { data, error } = await supabase.rpc('create_snag', {
    p_kind: params.kind,
    p_description: params.description,
    p_severity: params.severity,
    p_photo_paths: params.photoPaths,
    p_latitude: params.latitude,
    p_longitude: params.longitude,
    p_site_id: params.siteId,
  }).single();
  return { data: data as { id: string; reference: string } | null, error };
}

export async function updateSnagStatus(snagId: string, status: SnagStatus, note?: string | null) {
  return supabase.rpc('update_snag_status', { p_snag_id: snagId, p_status: status, p_note: note ?? null });
}

export async function recategoriseSnag(snagId: string, kind: SnagKind, severity: SnagSeverity | null) {
  return supabase.rpc('recategorise_snag', { p_snag_id: snagId, p_kind: kind, p_severity: severity });
}

export async function assignSnagOwner(snagId: string, ownerId: string | null) {
  return supabase.rpc('assign_snag_owner', { p_snag_id: snagId, p_owner_id: ownerId });
}

// ─── Resolution & investigation ───────────────────────────────────────────────
// Niggles resolve via resolve_snag (a note is required server-side). Serious
// snags resolve via update_snag_status('resolved'), which the server gates behind
// a completed investigation (see getInvestigationState / update_snag_status).

export async function resolveSnag(snagId: string, note: string) {
  return supabase.rpc('resolve_snag', { p_snag_id: snagId, p_note: note });
}

export async function completeChecklistStep(snagId: string, step: ChecklistStep) {
  return supabase.rpc('complete_checklist_step', { p_snag_id: snagId, p_step: step });
}

export async function addWitnessStatement(snagId: string, witnessName: string, statementText: string) {
  return supabase.rpc('add_witness_statement', {
    p_snag_id: snagId,
    p_witness_name: witnessName,
    p_statement_text: statementText,
  });
}

export async function addEvidenceItem(snagId: string, mediaPath: string, caption?: string | null) {
  return supabase.rpc('add_evidence_item', {
    p_snag_id: snagId,
    p_media_path: mediaPath,
    p_caption: caption ?? null,
  });
}

export async function setRootCause(snagId: string, rootCauseText: string) {
  return supabase.rpc('set_root_cause', { p_snag_id: snagId, p_root_cause_text: rootCauseText });
}

export interface InvestigationState {
  completedSteps: ChecklistStep[];
  witnesses: WitnessStatement[];
  evidence: EvidenceItem[];
  rootCause: string | null;
  openCorrectiveActions: number;
}

// Reads the five investigation tables for a serious snag — all org-scoped by RLS.
// Drives the live progress display and the serious-lane resolve gate.
export async function getInvestigationState(snagId: string): Promise<InvestigationState> {
  const [stepsRes, witnessRes, evidenceRes, investigationRes, actionsRes] = await Promise.all([
    supabase.from('checklist_completions').select('step').eq('snag_id', snagId),
    supabase.from('witness_statements').select('*').eq('snag_id', snagId).order('taken_at', { ascending: true }),
    supabase.from('evidence_items').select('*').eq('snag_id', snagId).order('sort_index', { ascending: true }),
    supabase.from('investigations').select('root_cause_text').eq('snag_id', snagId).maybeSingle(),
    supabase.from('corrective_actions').select('id', { count: 'exact', head: true }).eq('snag_id', snagId).eq('status', 'open'),
  ]);

  return {
    completedSteps: (stepsRes.data ?? []).map((r: any) => r.step as ChecklistStep),
    witnesses: (witnessRes.data ?? []) as WitnessStatement[],
    evidence: (evidenceRes.data ?? []) as EvidenceItem[],
    rootCause: (investigationRes.data as any)?.root_cause_text ?? null,
    openCorrectiveActions: actionsRes.count ?? 0,
  };
}

export async function markSnagSeen(snagId: string) {
  return supabase.rpc('mark_snag_seen', { p_snag_id: snagId });
}

// ─── Comment helpers ──────────────────────────────────────────────────────────

export async function addComment(snagId: string, body: string) {
  const { data, error } = await supabase.rpc('add_comment', { p_snag_id: snagId, p_body: body });
  return { commentId: data as string | null, error };
}

// ─── Vote helpers ─────────────────────────────────────────────────────────────

export async function upsertVote(snagId: string, _userId: string, value: VoteValue) {
  return supabase.rpc('cast_vote', { p_snag_id: snagId, p_value: value });
}

export async function deleteVote(snagId: string, _userId: string) {
  return supabase.rpc('remove_vote', { p_snag_id: snagId });
}

export async function getUserVote(snagId: string, userId: string): Promise<VoteValue | null> {
  const { data } = await supabase
    .from('votes')
    .select('value')
    .eq('snag_id', snagId)
    .eq('user_id', userId)
    .maybeSingle();
  return data ? (data.value as VoteValue) : null;
}

// ─── Gamification helpers ─────────────────────────────────────────────────────

export async function awardPoints(event: string, points: number, snagId?: string | null) {
  return supabase.rpc('award_points', { p_event: event, p_points: points, p_snag_id: snagId ?? null });
}

// ─── Storage helpers ──────────────────────────────────────────────────────────
// snag-photos is a PRIVATE bucket — store the storage path (not a public URL)
// and resolve a short-lived signed URL whenever a photo needs to be displayed.

const SNAG_PHOTOS_BUCKET = 'snag-photos';
const SNAG_EVIDENCE_BUCKET = 'snag-evidence';

export async function uploadSnagPhoto(
  localUri: string,
  fileName: string,
  bucket: string = SNAG_PHOTOS_BUCKET,
): Promise<string | null> {
  const response = await fetch(localUri);
  const blob = await response.blob();

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(fileName, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error || !data) {
    console.error('Photo upload error:', error);
    return null;
  }

  return data.path;
}

export async function getSnagPhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(SNAG_PHOTOS_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}

// Evidence photos live in the private snag-evidence bucket (org-folder scoped).
export async function getEvidencePhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(SNAG_EVIDENCE_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}
