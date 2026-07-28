import type { SupabaseClient } from '@supabase/supabase-js';
import { UserRole, SnagStatus, SnagKind, SnagSeverity, ChecklistStep, WitnessStatement, EvidenceItem, CorrectiveAction } from '@snag/shared-types';

// Platform-agnostic Supabase RPC/query wrappers, shared between apps/mobile
// and apps/web — see SNAG_WEB_APP_PLAN.md §1. Each function takes the
// caller's own SupabaseClient rather than closing over a singleton, since
// the two apps construct their clients differently (AsyncStorage vs.
// @supabase/ssr cookies). Everything here is a direct port of the matching
// function that used to live in apps/mobile/src/lib/supabase.ts — mobile
// now re-exports these bound to its own client instead of redefining them.

// ─── Multi-org membership ──────────────────────────────────────────────────

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

export async function getMemberships(client: SupabaseClient): Promise<Membership[]> {
  const { data } = await client.rpc('get_my_memberships');
  return (data ?? []) as Membership[];
}

export async function setActiveOrg(client: SupabaseClient, orgId: string) {
  return client.rpc('set_active_org', { p_org_id: orgId });
}

export async function createOrganisationAndOwner(client: SupabaseClient, orgName: string, ownerName: string) {
  const { data, error } = await client.rpc('create_organisation_and_owner', {
    p_org_name: orgName,
    p_name: ownerName,
  });
  return { orgId: data as string | null, error };
}

// ─── Org members ───────────────────────────────────────────────────────────

// Member lists come from org_memberships (via RPC), not profiles.org_id —
// that column mirrors each user's *active* org, which for multi-org members
// may be a different organisation right now.
export async function getOrgMembers(client: SupabaseClient) {
  const { data } = await client.rpc('get_org_members');
  return data ?? [];
}

// ─── Org/site snapshot stats ───────────────────────────────────────────────

export interface OrgStats {
  totalMembers: number;
  totalSnags: number;
  byStatus: Record<SnagStatus, number>;
  byKind: Record<SnagKind, number>;
  bySeverity: Record<SnagSeverity, number>;
}

export const EMPTY_ORG_STATS: OrgStats = {
  totalMembers: 0,
  totalSnags: 0,
  byStatus: { flagged: 0, in_progress: 0, resolved: 0, rca_pending: 0 },
  byKind: { fixit: 0, improvement: 0, hazard: 0, incident: 0 },
  bySeverity: { minor: 0, moderate: 0, injury: 0, critical: 0 },
};

// Aggregated server-side in one pass (get_org_stats) rather than selecting
// every snag row in the org and counting client-side.
//
// Returns { data, error } rather than swallowing failures into zeros. The RPC
// throws hard when p_org_id isn't the caller's active org, and a screen that
// can't tell "no snags" from "the call failed" renders a confidently wrong
// dashboard — see PRODUCT_REVIEW.md §3.4.
export async function getOrgStats(
  client: SupabaseClient,
  orgId: string
): Promise<{ data: OrgStats; error: any }> {
  const { data, error } = await client.rpc('get_org_stats', { p_org_id: orgId });
  if (error || !data) {
    return { data: EMPTY_ORG_STATS, error: error ?? new Error('No stats returned') };
  }
  return {
    data: {
      totalMembers: data.total_members ?? 0,
      totalSnags: data.total_snags ?? 0,
      byStatus: { ...EMPTY_ORG_STATS.byStatus, ...data.by_status },
      byKind: { ...EMPTY_ORG_STATS.byKind, ...data.by_kind },
      bySeverity: { ...EMPTY_ORG_STATS.bySeverity, ...data.by_severity },
    },
    error: null,
  };
}

export interface SiteBreakdown {
  siteId: string;
  siteName: string;
  openInvestigations: number;
  unassigned: number;
  overdueActions: number;
  /** Serious snags resolved (or mid-RCA) with no accepted analysis and no
   *  waiver. RCA is post-resolution work by design, so this is the only
   *  column that catches it — see PRODUCT_REVIEW.md §3.1. */
  rcaOutstanding: number;
}

// Per-site counts for the supervisor "outstanding work" dashboard —
// get_org_stats is org-wide only, this is the site-grouped sibling.
// Same { data, error } contract as getOrgStats, and for the same reason: this
// RPC raising was being rendered as "No sites yet."
export async function getSiteBreakdown(
  client: SupabaseClient,
  orgId: string
): Promise<{ data: SiteBreakdown[]; error: any }> {
  const { data, error } = await client.rpc('get_site_breakdown', { p_org_id: orgId });
  if (error || !data) return { data: [], error: error ?? null };
  return {
    data: (data as any[]).map((row) => ({
      siteId: row.site_id,
      siteName: row.site_name,
      openInvestigations: row.open_investigations ?? 0,
      unassigned: row.unassigned ?? 0,
      overdueActions: row.overdue_actions ?? 0,
      rcaOutstanding: row.rca_outstanding ?? 0,
    })),
    error: null,
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
// summarise a non-active org you belong to — it re-checks real membership
// itself rather than relying on RLS.
export async function getOrgSnagSummary(client: SupabaseClient, orgId: string): Promise<OrgSnagSummary | null> {
  const { data, error } = await client.rpc('get_org_snag_summary', { p_org_id: orgId }).maybeSingle();
  if (error) {
    console.error('getOrgSnagSummary error:', error);
    return null;
  }
  return data as OrgSnagSummary | null;
}

// ─── Assignment ─────────────────────────────────────────────────────────────

// People who can own a snag at a given site: the site's members + supervisors,
// plus the org's admins. Used to scope the owner picker to the snag's site.
export interface SiteAssignee {
  id: string;
  name: string;
  role: UserRole;
}

export async function getSiteAssignees(client: SupabaseClient, siteId: string): Promise<{ data: SiteAssignee[]; error: any }> {
  const { data, error } = await client.rpc('get_site_assignees', { p_site_id: siteId });
  return { data: (data ?? []) as SiteAssignee[], error };
}

// ─── Root cause analysis (5 Whys) ──────────────────────────────────────────

// Mirrors the rca_status Postgres enum exactly. 'cancelled' was added by
// 20260703000100_rca_cancelled_enum.sql — omitting it here meant TypeScript
// believed a state that occurs in production was impossible, so RcaPanel had no
// branch for it and cancelled rounds rendered as "Not started" with the
// abandoned analysis invisible (PRODUCT_REVIEW.md §3.3).
export type RcaStatus = 'assigned' | 'in_progress' | 'submitted' | 'accepted' | 'rejected' | 'cancelled';

/** An RCA round that is over: no further action is possible on it. */
export function isRcaClosed(status: RcaStatus): boolean {
  return status === 'accepted' || status === 'cancelled';
}

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
export async function getSnagRca(client: SupabaseClient, snagId: string): Promise<SnagRca | null> {
  const { data: rca } = await client
    .from('snag_rca')
    .select('id, status, assigned_to, assigned_by, rejection_note, submitted_at, accepted_at')
    .eq('snag_id', snagId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rca) return null;

  const { data: whys } = await client
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

// ─── Debriefs ───────────────────────────────────────────────────────────────

export interface DebriefFinding {
  id: string;
  finding_text: string;
  created_by: string;
  created_at: string;
}

export interface DebriefLesson {
  id: string;
  lesson_text: string;
  created_by: string;
  created_at: string;
}

export interface SnagDebrief {
  id: string;
  /** Historic only: debriefs used to be hot or formal. New ones don't ask. */
  format: 'hot' | 'formal';
  status: 'in_progress' | 'completed';
  startedBy: string;
  startedAt: string;
  completedAt: string | null;
  findings: DebriefFinding[];
  attendeeIds: string[];
  lessons: DebriefLesson[];
}

// Reads every debrief on a snag (any number allowed, any status), newest first.
export async function getSnagDebriefs(client: SupabaseClient, snagId: string): Promise<SnagDebrief[]> {
  const { data } = await client
    .from('snag_debriefs')
    .select('id, format, status, started_by, started_at, completed_at, debrief_findings(id, finding_text, created_by, created_at), debrief_attendees(profile_id), debrief_lessons(id, lesson_text, created_by, created_at)')
    .eq('snag_id', snagId)
    .order('started_at', { ascending: false });

  return (data ?? []).map((d: any) => ({
    id: d.id,
    format: d.format,
    status: d.status,
    startedBy: d.started_by,
    startedAt: d.started_at,
    completedAt: d.completed_at,
    findings: d.debrief_findings ?? [],
    attendeeIds: (d.debrief_attendees ?? []).map((a: any) => a.profile_id),
    lessons: d.debrief_lessons ?? [],
  }));
}

// ─── Investigation (serious lane) ──────────────────────────────────────────

export type InvestigationMode = 'snag' | 'document';

export interface InvestigationState {
  completedSteps: ChecklistStep[];
  witnesses: WitnessStatement[];
  evidence: EvidenceItem[];
  rootCause: string | null;
  openCorrectiveActions: number;
  /** 'document' = the org runs its own process and evidences it with a file. */
  mode: InvestigationMode;
  leadInvestigatorId: string | null;
  documentId: string | null;
  documentAccepted: boolean;
}

// Reads the five investigation tables for a serious snag — all org-scoped by
// RLS. Drives the live progress display and the serious-lane resolve gate.
export async function getInvestigationState(client: SupabaseClient, snagId: string): Promise<InvestigationState> {
  const [stepsRes, witnessRes, evidenceRes, investigationRes, actionsRes] = await Promise.all([
    client.from('checklist_completions').select('step').eq('snag_id', snagId),
    client.from('witness_statements').select('*').eq('snag_id', snagId).order('taken_at', { ascending: true }),
    client.from('evidence_items').select('*').eq('snag_id', snagId).is('corrective_action_id', null).order('sort_index', { ascending: true }),
    client.from('investigations')
      .select('root_cause_text, mode, lead_investigator_id, document_id, document_accepted_at')
      .eq('snag_id', snagId).maybeSingle(),
    // "Blocking" mirrors update_snag_status's resolve gate: done-but-unverified
    // still counts, so this pill can't show 0 while resolve is still blocked.
    client.from('corrective_actions').select('id', { count: 'exact', head: true })
      .eq('snag_id', snagId).or('status.neq.done,verified_by.is.null'),
  ]);

  return {
    completedSteps: (stepsRes.data ?? []).map((r: any) => r.step as ChecklistStep),
    witnesses: (witnessRes.data ?? []) as WitnessStatement[],
    evidence: (evidenceRes.data ?? []) as EvidenceItem[],
    rootCause: (investigationRes.data as any)?.root_cause_text ?? null,
    openCorrectiveActions: actionsRes.count ?? 0,
    mode: ((investigationRes.data as any)?.mode ?? 'snag') as InvestigationMode,
    leadInvestigatorId: (investigationRes.data as any)?.lead_investigator_id ?? null,
    documentId: (investigationRes.data as any)?.document_id ?? null,
    documentAccepted: Boolean((investigationRes.data as any)?.document_accepted_at),
  };
}

export type ResolveGateKey =
  | 'notifiable' | 'checklist' | 'witnesses' | 'evidence' | 'rootCause' | 'correctiveActions'
  | 'investigationDocument' | 'documentAccepted';

export interface ResolveGateCondition {
  key: ResolveGateKey;
  unmet: boolean;
  /** Why Resolve is refused while this is outstanding, in the user's terms. */
  reason: string;
}

/**
 * The serious-lane resolve gate, in `update_snag_status`'s own order.
 *
 * The server refuses `resolved` until every one of these is satisfied and
 * raises on the first it finds, so a client that guesses a different order
 * tells people to do the wrong thing next. It lives here rather than in either
 * app because both of them need it and they were drifting: mobile disabled
 * Resolve and named the blocking condition, while the portal offered a live
 * button annotated "(requires completed investigation)" and surfaced the raw
 * Postgres exception when the server refused.
 *
 * The notifiable decision leads. It isn't enforced by the older conditions'
 * logic — it's a separate check added later — but it's first in the server
 * function and it's the one with a statutory clock on it.
 */
export function seriousResolveGate(
  inv: InvestigationState,
  notifiableDecided: boolean,
): ResolveGateCondition[] {
  const shared: ResolveGateCondition[] = [
    { key: 'notifiable', unmet: !notifiableDecided, reason: 'Decide if this is a notifiable event' },
    { key: 'checklist', unmet: inv.completedSteps.length < 5, reason: `Finish the checklist (${inv.completedSteps.length}/5)` },
    { key: 'witnesses', unmet: inv.witnesses.length === 0, reason: 'Add a witness statement' },
    { key: 'evidence', unmet: inv.evidence.length === 0, reason: 'Add evidence' },
  ];

  // An organisation running its own investigation process substitutes two
  // conditions for the last two — it does not get fewer. Everything above is
  // required either way.
  if (inv.mode === 'document') {
    return [
      ...shared,
      { key: 'investigationDocument', unmet: !inv.documentId, reason: 'Attach the investigation document' },
      { key: 'documentAccepted', unmet: !inv.documentAccepted, reason: 'A supervisor must accept the investigation document' },
    ];
  }

  return [
    ...shared,
    { key: 'rootCause', unmet: !inv.rootCause?.trim(), reason: 'Record a root cause' },
    { key: 'correctiveActions', unmet: inv.openCorrectiveActions > 0, reason: 'Close corrective actions' },
  ];
}

/** The first unmet condition's reason — why Resolve is refused, or null. */
export function resolveBlockReason(
  inv: InvestigationState,
  notifiableDecided: boolean,
): string | null {
  return seriousResolveGate(inv, notifiableDecided).find((c) => c.unmet)?.reason ?? null;
}

// ─── Corrective actions (CAPA) ─────────────────────────────────────────────

export async function getCorrectiveActions(client: SupabaseClient, snagId: string): Promise<CorrectiveAction[]> {
  const { data, error } = await client
    .from('corrective_actions')
    .select(`
      id, snag_id, description, owner_id, due_date, status, created_at, completed_at, verified_by, verified_at,
      owner:profiles!corrective_actions_owner_id_fkey(name),
      verifier:profiles!corrective_actions_verified_by_fkey(name)
    `)
    .eq('snag_id', snagId)
    .order('due_date', { ascending: true });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    id: row.id,
    snag_id: row.snag_id,
    description: row.description,
    owner_id: row.owner_id,
    owner_name: row.owner?.name,
    due_date: row.due_date,
    status: row.status,
    created_at: row.created_at,
    completed_at: row.completed_at,
    verified_by: row.verified_by,
    verifier_name: row.verifier?.name,
    verified_at: row.verified_at,
  }));
}

// ─── Activity trail ─────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
}

// Human-readable text for the action strings RPCs write against entity='snag'.
// Falls back to the raw action string for anything unmapped — new actions
// still show up, just less prettily, instead of disappearing.
const AUDIT_ACTION_LABELS: Record<string, string> = {
  created: 'reported this snag',
  created_public: 'submitted this as a public report',
  status_flagged: 'reopened this snag',
  status_in_progress: 'marked this In Progress',
  status_resolved: 'resolved this snag',
  status_rca_pending: 'marked this RCA Pending',
  status_sorted: 'marked this sorted', // retired status; kept for historical entries
  owner_assigned: 'assigned an owner',
  owner_unassigned: 'unassigned the owner',
  recategorised_to_fixit: 'recategorised this as a Fixit',
  recategorised_to_improvement: 'recategorised this as an Improvement',
  recategorised_to_hazard: 'recategorised this as a Hazard',
  recategorised_to_incident: 'recategorised this as an Incident',
  merge_created: 'merged snags into this one',
  merge_children_added: 'merged another snag into this one',
  merged_into_parent: 'merged this into another snag',
  work_group_assigned: 'assigned this to a work group',
  work_group_unassigned: 'removed this from its work group',
  marked_notifiable: 'marked this as notifiable',
  unmarked_notifiable: 'removed the notifiable flag',
  checklist_make_safe: "completed the 'Make Safe' step",
  checklist_preserve_scene: "completed the 'Preserve Scene' step",
  checklist_identify_witnesses: "completed the 'Identify Witnesses' step",
  checklist_capture_evidence: "completed the 'Capture Evidence' step",
  checklist_find_root_cause: "completed the 'Find Root Cause' step",
  witness_statement_added: 'added a witness statement',
  evidence_added: 'added evidence',
  root_cause_set: 'recorded the root cause',
  corrective_action_created: 'created a corrective action',
  rca_assigned: 'assigned the root cause analysis',
};

export function describeAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}

export async function getSnagAuditLog(client: SupabaseClient, snagId: string): Promise<AuditLogEntry[]> {
  const { data, error } = await client
    .from('audit_log')
    .select('id, action, actor_id, created_at, actor:profiles!audit_log_actor_id_fkey(name)')
    .eq('entity', 'snag')
    .eq('entity_id', snagId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return data.map((row: any) => ({
    id: row.id,
    action: row.action,
    actor_id: row.actor_id,
    actor_name: row.actor?.name ?? null,
    created_at: row.created_at,
  }));
}

// ─── Reports / exports ──────────────────────────────────────────────────────
// Builds a report PDF via the matching edge function and returns a 1-hour
// signed URL to it. The edge function re-checks the caller's role itself, so
// a failed permission check surfaces here as `error` rather than a thrown
// exception — same contract on both apps.

export async function exportInvestigation(
  client: SupabaseClient,
  snagId: string
): Promise<{ signedUrl: string | null; error: any }> {
  const { data, error } = await client.functions.invoke('export-investigation', {
    body: { snag_id: snagId },
  });
  if (error) return { signedUrl: null, error };
  return { signedUrl: data?.signedUrl ?? null, error: null };
}

// Defaults to the trailing 90 days when no period is given.
export async function exportGovernanceReport(
  client: SupabaseClient,
  periodStart?: string,
  periodEnd?: string
): Promise<{ signedUrl: string | null; error: any }> {
  const { data, error } = await client.functions.invoke('export-governance-report', {
    body: { period_start: periodStart, period_end: periodEnd },
  });
  if (error) return { signedUrl: null, error };
  return { signedUrl: data?.signedUrl ?? null, error: null };
}

// ─── Org document library ──────────────────────────────────────────────────
// Added for SNAG_WEB_APP_PLAN.md decision D2 — a general org-wide document
// library, distinct from snag-scoped evidence. Migration:
// supabase/migrations/20260722200000_org_documents.sql. Read access is any
// org member; upload/delete are supervisor/officer_admin only, enforced by
// the create_org_document/delete_org_document RPCs and mirrored in the
// org-documents storage bucket's own policies.

export interface OrgDocument {
  id: string;
  file_path: string;
  title: string;
  category: string | null;
  uploaded_by: string;
  uploader_name?: string;
  created_at: string;
}

export async function getOrgDocuments(client: SupabaseClient, orgId: string): Promise<OrgDocument[]> {
  const { data, error } = await client
    .from('org_documents')
    .select('id, file_path, title, category, uploaded_by, created_at, uploader:profiles!org_documents_uploaded_by_fkey(name)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    id: row.id,
    file_path: row.file_path,
    title: row.title,
    category: row.category,
    uploaded_by: row.uploaded_by,
    uploader_name: row.uploader?.name,
    created_at: row.created_at,
  }));
}

export async function createOrgDocument(client: SupabaseClient, filePath: string, title: string, category?: string | null) {
  const { data, error } = await client.rpc('create_org_document', {
    p_file_path: filePath, p_title: title, p_category: category ?? null,
  });
  return { id: data as string | null, error };
}

export async function deleteOrgDocument(client: SupabaseClient, documentId: string) {
  return client.rpc('delete_org_document', { p_document_id: documentId });
}

const ORG_DOCUMENTS_BUCKET = 'org-documents';

export async function uploadOrgDocumentFile(
  client: SupabaseClient,
  orgId: string,
  fileName: string,
  file: File | Blob,
): Promise<{ path: string | null; error: any }> {
  const path = `${orgId}/${Date.now()}-${fileName}`;
  const { data, error } = await client.storage.from(ORG_DOCUMENTS_BUCKET).upload(path, file, { upsert: false });
  if (error || !data) return { path: null, error: error ?? new Error('Upload failed') };
  return { path: data.path, error: null };
}

export async function getOrgDocumentUrl(client: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await client.storage.from(ORG_DOCUMENTS_BUCKET).createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}

// ─── Snag trend (reporting) ────────────────────────────────────────────────
// Added for SNAG_WEB_APP_PLAN.md decision D3. Migration:
// supabase/migrations/20260722210000_org_snag_trend_rpc.sql.

export interface SnagTrendPoint {
  period: string;
  total: number;
  flagged: number;
  inProgress: number;
  resolved: number;
  rcaPending: number;
}

export async function getOrgSnagTrend(
  client: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string,
  bucket: 'week' | 'month' = 'week',
): Promise<SnagTrendPoint[]> {
  const { data, error } = await client.rpc('get_org_snag_trend', {
    p_org_id: orgId, p_start_date: startDate, p_end_date: endDate, p_bucket: bucket,
  });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    period: row.period,
    total: row.total ?? 0,
    flagged: row.flagged ?? 0,
    inProgress: row.in_progress ?? 0,
    resolved: row.resolved ?? 0,
    rcaPending: row.rca_pending ?? 0,
  }));
}

// ─── Snag mutations ─────────────────────────────────────────────────────────
// Write-side counterparts to the read functions above, added when apps/web's
// portal grew mutation actions on the snag detail page (not just read-only
// review). Same client-param pattern; ported as-is from
// apps/mobile/src/lib/supabase.ts, which now re-exports these bound to its
// own client instead of redefining them.

export async function updateSnagStatus(client: SupabaseClient, snagId: string, status: SnagStatus, note?: string | null) {
  return client.rpc('update_snag_status', { p_snag_id: snagId, p_status: status, p_note: note ?? null });
}

// Niggles resolve via resolve_snag (a note is required server-side). Serious
// snags resolve via updateSnagStatus('resolved'), which the server gates
// behind a completed investigation.
export async function resolveSnag(client: SupabaseClient, snagId: string, note: string) {
  return client.rpc('resolve_snag', { p_snag_id: snagId, p_note: note });
}

export async function recategoriseSnag(client: SupabaseClient, snagId: string, kind: SnagKind, severity: SnagSeverity | null) {
  return client.rpc('recategorise_snag', { p_snag_id: snagId, p_kind: kind, p_severity: severity });
}

export async function assignSnagOwner(client: SupabaseClient, snagId: string, ownerId: string | null) {
  return client.rpc('assign_snag_owner', { p_snag_id: snagId, p_owner_id: ownerId });
}

export async function assignSnagWorkGroup(client: SupabaseClient, snagId: string, workGroupId: string | null) {
  return client.rpc('assign_snag_work_group', { p_snag_id: snagId, p_work_group_id: workGroupId });
}

// Creates (or reuses) a parent snag and attaches the rest of the selection as
// its children — see merge_snags for the disambiguation rules around
// kind/severity/site when the selection doesn't already agree.
export async function mergeSnags(client: SupabaseClient, params: {
  snagIds: string[];
  description?: string | null;
  kind?: SnagKind | null;
  severity?: SnagSeverity | null;
  siteId?: string | null;
}) {
  const { data, error } = await client.rpc('merge_snags', {
    p_snag_ids: params.snagIds,
    p_description: params.description ?? null,
    p_kind: params.kind ?? null,
    p_severity: params.severity ?? null,
    p_site_id: params.siteId ?? null,
  }).single();
  return { data: data as { id: string; reference: string } | null, error };
}

export async function unmergeSnag(client: SupabaseClient, snagId: string) {
  return client.rpc('unmerge_snag', { p_snag_id: snagId });
}

export async function setNotifiableFlag(client: SupabaseClient, snagId: string, value: boolean) {
  return client.rpc('set_notifiable_flag', { p_snag_id: snagId, p_value: value });
}

export async function nominateNotifyingPcbu(client: SupabaseClient, snagId: string, orgId: string | null, note: string | null) {
  return client.rpc('nominate_notifying_pcbu', { p_snag_id: snagId, p_org_id: orgId, p_note: note });
}

export async function addComment(client: SupabaseClient, snagId: string, body: string, mentionedUserIds: string[] = []) {
  const { data, error } = await client.rpc('add_comment', {
    p_snag_id: snagId,
    p_body: body,
    p_mentioned_user_ids: mentionedUserIds,
  });
  return { commentId: data as string | null, error };
}

// ─── Investigation mutations (serious lane) ────────────────────────────────

export async function completeChecklistStep(client: SupabaseClient, snagId: string, step: ChecklistStep) {
  return client.rpc('complete_checklist_step', { p_snag_id: snagId, p_step: step });
}

export async function addWitnessStatement(client: SupabaseClient, snagId: string, witnessName: string, statementText: string) {
  return client.rpc('add_witness_statement', {
    p_snag_id: snagId,
    p_witness_name: witnessName,
    p_statement_text: statementText,
  });
}

export async function addEvidenceItem(client: SupabaseClient, snagId: string, mediaPath: string, caption?: string | null) {
  return client.rpc('add_evidence_item', {
    p_snag_id: snagId,
    p_media_path: mediaPath,
    p_caption: caption ?? null,
  });
}

export async function setRootCause(client: SupabaseClient, snagId: string, rootCauseText: string) {
  return client.rpc('set_root_cause', { p_snag_id: snagId, p_root_cause_text: rootCauseText });
}

const SNAG_EVIDENCE_BUCKET = 'snag-evidence';

// Mirrors uploadOrgDocumentFile's shape — {org_id}/... path convention,
// matching apps/mobile's PhotoPicker (which builds fileName as
// `${pathPrefix}/${id}.jpg` with pathPrefix = org_id).
export async function uploadSnagEvidenceFile(
  client: SupabaseClient,
  orgId: string,
  fileName: string,
  file: File | Blob,
): Promise<{ path: string | null; error: any }> {
  const path = `${orgId}/${Date.now()}-${fileName}`;
  const { data, error } = await client.storage.from(SNAG_EVIDENCE_BUCKET).upload(path, file, { upsert: false });
  if (error || !data) return { path: null, error: error ?? new Error('Upload failed') };
  return { path: data.path, error: null };
}

/**
 * Whether an evidence item should render as a picture or as a file to open.
 *
 * Evidence has always accepted any file the storage bucket would take — the
 * portal's upload is a plain file input — but both clients rendered every item
 * with a URL as an <img>. A PDF therefore appeared as a broken image icon, and
 * the thing someone had attached as proof was unopenable.
 */
export function isImageEvidence(path: string | null | undefined): boolean {
  if (!path) return false;
  return /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i.test(path.split('?')[0]);
}

export async function getEvidencePhotoUrl(client: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await client.storage.from(SNAG_EVIDENCE_BUCKET).createSignedUrl(path, 60 * 60);
  if (error || !data) return null;
  return data.signedUrl;
}

// ─── RCA mutations ──────────────────────────────────────────────────────────

export async function assignRca(client: SupabaseClient, snagId: string, assigneeId: string) {
  return client.rpc('assign_rca', { p_snag_id: snagId, p_assignee_id: assigneeId });
}

export async function saveRcaWhy(client: SupabaseClient, rcaId: string, whyIndex: number, whyText: string, answerText: string) {
  return client.rpc('save_rca_why', {
    p_rca_id: rcaId, p_why_index: whyIndex, p_why_text: whyText, p_answer_text: answerText,
  });
}

export async function submitRca(client: SupabaseClient, rcaId: string) {
  return client.rpc('submit_rca', { p_rca_id: rcaId });
}

export async function acceptRca(client: SupabaseClient, rcaId: string) {
  return client.rpc('accept_rca', { p_rca_id: rcaId });
}

export async function rejectRca(client: SupabaseClient, rcaId: string, rejectionNote: string) {
  return client.rpc('reject_rca', { p_rca_id: rcaId, p_rejection_note: rejectionNote });
}

// Recovery for an RCA an assignee can't finish — e.g. they've left or gone
// quiet. Both are supervisor/admin actions; reassign hands the unfinished
// RCA to someone else, cancel abandons it and returns the snag to resolved.
export async function reassignRca(client: SupabaseClient, rcaId: string, newAssigneeId: string) {
  return client.rpc('reassign_rca', { p_rca_id: rcaId, p_new_assignee_id: newAssigneeId });
}

export async function cancelRca(client: SupabaseClient, rcaId: string) {
  return client.rpc('cancel_rca', { p_rca_id: rcaId });
}

// "No formal 5-Whys needed here" as an explicit, attributed decision. Without
// it, every serious snag ever resolved counts as outstanding analysis forever
// and the dashboard column becomes noise — see PRODUCT_REVIEW.md §3.1.
// Supervisor/admin only, resolved snags only, and refused while an RCA is in
// flight (cancel it first, so the abandonment is on the record).
export async function waiveRca(client: SupabaseClient, snagId: string, reason: string) {
  return client.rpc('waive_rca', { p_snag_id: snagId, p_reason: reason });
}

export async function unwaiveRca(client: SupabaseClient, snagId: string) {
  return client.rpc('unwaive_rca', { p_snag_id: snagId });
}

// ─── Escalation (niggle lane) ──────────────────────────────────────────────
// Reporter-only, by design: escalate_snag checks `reporter_id = auth.uid()`,
// so this is the person who raised a fixit/improvement saying "this is
// actually unsafe" — not a supervisor action. Open niggles only, once each.
export async function escalateSnag(client: SupabaseClient, snagId: string) {
  return client.rpc('escalate_snag', { p_snag_id: snagId });
}

// ─── Investigation assignment and mode ──────────────────────────────────────

export async function assignInvestigation(
  client: SupabaseClient, snagId: string, assigneeId: string, mode: InvestigationMode
) {
  return client.rpc('assign_investigation', {
    p_snag_id: snagId, p_assignee_id: assigneeId, p_mode: mode,
  });
}

/** Always an org_documents row, whether it was already in the library or
 *  uploaded for this investigation — one register, discoverable later. */
export async function attachInvestigationDocument(client: SupabaseClient, snagId: string, documentId: string) {
  return client.rpc('attach_investigation_document', { p_snag_id: snagId, p_document_id: documentId });
}

export async function acceptInvestigationDocument(client: SupabaseClient, snagId: string) {
  return client.rpc('accept_investigation_document', { p_snag_id: snagId });
}

// ─── Debrief mutations ──────────────────────────────────────────────────────

// Idempotent: returns the existing debrief if there is one. A snag has at most
// one, enforced by a unique index — the old two-argument form let each tap of
// the hot/formal selector start another, and one snag reached 13.
export async function startDebrief(client: SupabaseClient, snagId: string) {
  return client.rpc('start_debrief', { p_snag_id: snagId });
}

export async function addDebriefFinding(client: SupabaseClient, debriefId: string, findingText: string) {
  return client.rpc('add_debrief_finding', { p_debrief_id: debriefId, p_finding_text: findingText });
}

export async function addDebriefAttendee(client: SupabaseClient, debriefId: string, profileId: string) {
  return client.rpc('add_debrief_attendee', { p_debrief_id: debriefId, p_profile_id: profileId });
}

export async function addDebriefLesson(client: SupabaseClient, debriefId: string, lessonText: string) {
  return client.rpc('add_debrief_lesson', { p_debrief_id: debriefId, p_lesson_text: lessonText });
}

export async function completeDebrief(client: SupabaseClient, debriefId: string) {
  return client.rpc('complete_debrief', { p_debrief_id: debriefId });
}

// ─── Corrective actions (CAPA) mutations ───────────────────────────────────

export async function createCorrectiveAction(
  client: SupabaseClient, snagId: string, description: string, ownerId: string, dueDate: string
) {
  const { data, error } = await client.rpc('create_corrective_action', {
    p_snag_id: snagId, p_description: description, p_owner_id: ownerId, p_due_date: dueDate,
  });
  return { id: data as string | null, error };
}

export async function completeCorrectiveAction(client: SupabaseClient, actionId: string) {
  return client.rpc('complete_corrective_action', { p_action_id: actionId });
}

export async function verifyCorrectiveAction(client: SupabaseClient, actionId: string) {
  return client.rpc('verify_corrective_action', { p_action_id: actionId });
}

export async function addCorrectiveActionEvidence(client: SupabaseClient, actionId: string, mediaPath: string, caption?: string | null) {
  return client.rpc('add_corrective_action_evidence', {
    p_action_id: actionId, p_media_path: mediaPath, p_caption: caption ?? null,
  });
}

// Completion-evidence photos for one corrective action, resolved to
// signed-URL rows for display — mirrors getEvidencePhotoUrl's bucket/RLS.
export async function getCorrectiveActionEvidence(client: SupabaseClient, actionId: string): Promise<EvidenceItem[]> {
  const { data, error } = await client
    .from('evidence_items')
    .select('*')
    .eq('corrective_action_id', actionId)
    .order('sort_index', { ascending: true });
  if (error || !data) return [];
  return data as EvidenceItem[];
}

// Logs a governance-artefact export (officer_admin only, server-side
// checked) — the established "generate file, upload it, then log it"
// pattern (SNAG_WEB_APP_PLAN.md §4). The PDF export goes through the
// export-governance-report edge function, which calls this internally;
// the CSV export has no edge function, so apps/web calls it directly after
// uploading the CSV to the governance-reports bucket itself.
export async function recordGovernanceExport(client: SupabaseClient, filePath: string, periodStart: string, periodEnd: string) {
  const { data, error } = await client.rpc('record_governance_export', {
    p_file_path: filePath, p_period_start: periodStart, p_period_end: periodEnd,
  });
  return { id: data as string | null, error };
}
