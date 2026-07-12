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
      lock: <R,>(_name: string, _acquireTimeout: number, fn: () => Promise<R>) => fn(),
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
    .select('id, org_id, name, email, role, created_at, organisation:organisations!profiles_org_id_fkey(id, name, industry, plan_tier, join_code, is_public, public_intake_site_id, created_at)')
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

export async function cancelInvite(inviteId: string) {
  return supabase.rpc('cancel_invite', { p_invite_id: inviteId });
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
  /** This is the user's current active-org pick — NOT whether the org itself
   *  is enabled. See org_active for that. */
  is_active: boolean;
  /** Whether the organisation itself is active (not deactivated by its
   *  officer_admin). Deactivated orgs are excluded from pickers/switchers
   *  everywhere except the admin tab's own management list. */
  org_active: boolean;
}

export async function getMemberships(): Promise<Membership[]> {
  const { data } = await supabase.rpc('get_my_memberships');
  return (data ?? []) as Membership[];
}

export async function setActiveOrg(orgId: string) {
  return supabase.rpc('set_active_org', { p_org_id: orgId });
}

export async function setOrganisationActive(orgId: string, active: boolean) {
  return supabase.rpc('set_organisation_active', { p_org_id: orgId, p_active: active });
}

// Resolve which org the user reports into, driven by the membership RPC rather
// than the (embed-heavy, occasionally-null) profiles read. Returns the active
// org; if none is active but the user belongs to exactly one (active) org,
// defaults to it (set_active_org). Returns null if the user has no usable
// (active-org) membership at all — either genuinely no membership, or every
// org they belong to has been deactivated.
export async function resolveActiveOrg(): Promise<{ orgId: string; orgName: string } | null> {
  const memberships = await getMemberships();
  const usable = memberships.filter((m) => m.org_active);
  if (usable.length === 0) return null;

  const active = usable.find((m) => m.is_active);
  if (active) return { orgId: active.org_id, orgName: active.org_name };

  if (usable.length === 1) {
    await setActiveOrg(usable[0].org_id);
    return { orgId: usable[0].org_id, orgName: usable[0].org_name };
  }
  return null; // multi-org, none active — let the user choose
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

// The sites a worker is personally assigned to (as opposed to every site in
// the org, which officer_admin/supervisor see) — used to scope the Snags
// list's Site filter for non-staff.
export async function getMySiteIds(): Promise<string[]> {
  const { data } = await supabase.rpc('my_member_site_ids');
  return (data ?? []) as string[];
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

// ─── Work groups ────────────────────────────────────────────────────────────
// Org-defined sub-teams a worker can route a snag to at report time. Mirrors
// getSitesWithDetail's shape: work groups + their supervisor ids, read
// directly (RLS-scoped) rather than through an RPC.

export interface WorkGroupDetail {
  id: string;
  name: string;
  color: string | null;
  isDefault: boolean;
  supervisorIds: string[];
  // null = the group applies to every site in the org.
  siteId: string | null;
  siteName: string | null;
}

export async function getWorkGroupsWithDetail(): Promise<WorkGroupDetail[]> {
  const { data: groups } = await supabase
    .from('work_groups')
    .select('id, name, color, is_default, site_id, site:sites(name)')
    .order('is_default', { ascending: true })
    .order('created_at', { ascending: true });
  if (!groups || groups.length === 0) return [];

  const ids = groups.map((g) => g.id);
  const { data: sups } = await supabase
    .from('work_group_supervisors')
    .select('work_group_id, user_id')
    .in('work_group_id', ids);

  return groups.map((g: any) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    isDefault: g.is_default,
    supervisorIds: (sups ?? []).filter((s: any) => s.work_group_id === g.id).map((s: any) => s.user_id),
    siteId: g.site_id,
    siteName: g.site?.name ?? null,
  }));
}

export async function createWorkGroup(name: string, color?: string | null, siteId?: string | null) {
  return supabase.rpc('create_work_group', {
    p_name: name, p_color: color ?? null, p_site_id: siteId ?? null,
  });
}

export async function updateWorkGroup(
  workGroupId: string, name: string, color?: string | null, siteId?: string | null
) {
  return supabase.rpc('update_work_group', {
    p_work_group_id: workGroupId, p_name: name, p_color: color ?? null, p_site_id: siteId ?? null,
  });
}

export async function assignWorkGroupSupervisor(workGroupId: string, userId: string) {
  return supabase.rpc('assign_work_group_supervisor', { p_work_group_id: workGroupId, p_user_id: userId });
}

export async function removeWorkGroupSupervisor(workGroupId: string, userId: string) {
  return supabase.rpc('remove_work_group_supervisor', { p_work_group_id: workGroupId, p_user_id: userId });
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

// Aggregated server-side in one pass (get_org_stats) — previously this
// selected every snag row in the org and counted on the phone.
export async function getOrgStats(orgId: string): Promise<OrgStats> {
  const empty: OrgStats = {
    totalMembers: 0,
    totalSnags: 0,
    byStatus: { flagged: 0, in_progress: 0, resolved: 0, rca_pending: 0 },
    byKind: { fixit: 0, improvement: 0, hazard: 0, incident: 0 },
    bySeverity: { minor: 0, moderate: 0, injury: 0, critical: 0 },
  };
  const { data, error } = await supabase.rpc('get_org_stats', { p_org_id: orgId });
  if (error || !data) {
    if (error) console.error('getOrgStats error:', error);
    return empty;
  }
  return {
    totalMembers: data.total_members ?? 0,
    totalSnags: data.total_snags ?? 0,
    byStatus: { ...empty.byStatus, ...data.by_status },
    byKind: { ...empty.byKind, ...data.by_kind },
    bySeverity: { ...empty.bySeverity, ...data.by_severity },
  };
}

export interface OrgSnagSummary {
  total: number;
  flagged: number;
  in_progress: number;
  resolved: number;
  rca_pending: number;
}

// snags' RLS only exposes the active org's rows, so this RPC is needed to
// summarise a non-active org you belong to (e.g. the Profile screen's org
// list) — it re-checks real membership itself rather than relying on RLS.
export async function getOrgSnagSummary(orgId: string): Promise<OrgSnagSummary | null> {
  const { data, error } = await supabase.rpc('get_org_snag_summary', { p_org_id: orgId }).maybeSingle();
  if (error) {
    console.error('getOrgSnagSummary error:', error);
    return null;
  }
  return data as OrgSnagSummary | null;
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
  workGroupId?: string | null;
}) {
  const { data, error } = await supabase.rpc('create_snag', {
    p_kind: params.kind,
    p_description: params.description,
    p_severity: params.severity,
    p_photo_paths: params.photoPaths,
    p_latitude: params.latitude,
    p_longitude: params.longitude,
    p_site_id: params.siteId,
    p_work_group_id: params.workGroupId ?? null,
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

export async function assignSnagWorkGroup(snagId: string, workGroupId: string | null) {
  return supabase.rpc('assign_snag_work_group', { p_snag_id: snagId, p_work_group_id: workGroupId });
}

// People who can own a snag at a given site: the site's members + supervisors,
// plus the org's admins. Used to scope the owner picker to the snag's site.
export interface SiteAssignee {
  id: string;
  name: string;
  role: UserRole;
}

export async function getSiteAssignees(siteId: string): Promise<{ data: SiteAssignee[]; error: any }> {
  const { data, error } = await supabase.rpc('get_site_assignees', { p_site_id: siteId });
  return { data: (data ?? []) as SiteAssignee[], error };
}

// ─── Resolution & investigation ───────────────────────────────────────────────
// Niggles resolve via resolve_snag (a note is required server-side). Serious
// snags resolve via update_snag_status('resolved'), which the server gates behind
// a completed investigation (see getInvestigationState / update_snag_status).

export async function resolveSnag(snagId: string, note: string) {
  return supabase.rpc('resolve_snag', { p_snag_id: snagId, p_note: note });
}

// ─── Root cause analysis (5 Whys) ──────────────────────────────────────────────
// A supervisor/admin can delegate a formal RCA on a resolved serious snag to
// any site assignee (moves it to rca_pending, emails the assignee). The
// assignee answers 5 Whys and submits; a supervisor/admin then accepts
// (returns the snag to resolved) or rejects (reopens it for edits).

export type RcaStatus = 'assigned' | 'in_progress' | 'submitted' | 'accepted' | 'rejected';

export interface RcaWhyStep {
  whyIndex: number;
  whyText: string;
  answerText: string;
}

export interface SnagRca {
  id: string;
  status: RcaStatus;
  assignedTo: string;
  assignedBy: string;
  rejectionNote: string | null;
  submittedAt: string | null;
  acceptedAt: string | null;
  whys: RcaWhyStep[];
}

// The most recent RCA round for a snag (a new one can be assigned after an
// earlier one was accepted, so this is never assumed to be the only row).
export async function getSnagRca(snagId: string): Promise<SnagRca | null> {
  const { data: rca } = await supabase
    .from('snag_rca')
    .select('id, status, assigned_to, assigned_by, rejection_note, submitted_at, accepted_at')
    .eq('snag_id', snagId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rca) return null;

  const { data: whys } = await supabase
    .from('rca_why_steps')
    .select('why_index, why_text, answer_text')
    .eq('rca_id', rca.id)
    .order('why_index', { ascending: true });

  return {
    id: rca.id,
    status: rca.status,
    assignedTo: rca.assigned_to,
    assignedBy: rca.assigned_by,
    rejectionNote: rca.rejection_note,
    submittedAt: rca.submitted_at,
    acceptedAt: rca.accepted_at,
    whys: (whys ?? []).map((w: any) => ({ whyIndex: w.why_index, whyText: w.why_text, answerText: w.answer_text })),
  };
}

export async function assignRca(snagId: string, assigneeId: string) {
  return supabase.rpc('assign_rca', { p_snag_id: snagId, p_assignee_id: assigneeId });
}

export async function saveRcaWhy(rcaId: string, whyIndex: number, whyText: string, answerText: string) {
  return supabase.rpc('save_rca_why', {
    p_rca_id: rcaId, p_why_index: whyIndex, p_why_text: whyText, p_answer_text: answerText,
  });
}

export async function submitRca(rcaId: string) {
  return supabase.rpc('submit_rca', { p_rca_id: rcaId });
}

export async function acceptRca(rcaId: string) {
  return supabase.rpc('accept_rca', { p_rca_id: rcaId });
}

export async function rejectRca(rcaId: string, rejectionNote: string) {
  return supabase.rpc('reject_rca', { p_rca_id: rcaId, p_rejection_note: rejectionNote });
}

// ─── Merge (parent/child) ───────────────────────────────────────────────────
// Creates (or reuses) a parent snag and attaches the rest of the selection as
// its children — see merge_snags for the disambiguation rules around
// kind/severity/site when the selection doesn't already agree.
export async function mergeSnags(params: {
  snagIds: string[];
  description?: string | null;
  kind?: SnagKind | null;
  severity?: SnagSeverity | null;
  siteId?: string | null;
}) {
  const { data, error } = await supabase.rpc('merge_snags', {
    p_snag_ids: params.snagIds,
    p_description: params.description ?? null,
    p_kind: params.kind ?? null,
    p_severity: params.severity ?? null,
    p_site_id: params.siteId ?? null,
  }).single();
  return { data: data as { id: string; reference: string } | null, error };
}

export async function unmergeSnag(snagId: string) {
  return supabase.rpc('unmerge_snag', { p_snag_id: snagId });
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
  if (error) console.error('getSnagPhotoUrl error:', path, error);
  if (error || !data) return null;
  return data.signedUrl;
}

// Batched sibling of getSnagPhotoUrl for list views — one request for every
// visible card's cover photo instead of one signed-URL call per card, which
// was cheap to trip up (a slow/rate-limited response for any single card
// silently left it on the "No photo" placeholder forever).
export async function getSnagPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(SNAG_PHOTOS_BUCKET)
    .createSignedUrls(unique, 60 * 60);
  if (error) console.error('getSnagPhotoUrls error:', error);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.signedUrl && !row.error) map[row.path ?? ''] = row.signedUrl;
  }
  return map;
}

// Evidence photos live in the private snag-evidence bucket (org-folder scoped).
export async function getEvidencePhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(SNAG_EVIDENCE_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}
