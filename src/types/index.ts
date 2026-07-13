// ─── Enums (mirroring Snagv1's real Postgres enums) ──────────────────────────

export type SnagKind = 'fixit' | 'improvement' | 'hazard' | 'incident';
export type SnagLane = 'niggle' | 'serious'; // generated column, read-only
export type SnagSeverity = 'minor' | 'moderate' | 'injury' | 'critical';
export type SnagStatus = 'flagged' | 'in_progress' | 'resolved' | 'rca_pending';
export type ChecklistStep =
  | 'make_safe'
  | 'preserve_scene'
  | 'capture_evidence'
  | 'identify_witnesses'
  | 'find_root_cause';
export type UserRole = 'worker' | 'supervisor' | 'officer_admin';
export type InviteStatus = 'pending' | 'accepted' | 'revoked';
export type VoteValue = 1 | -1;

// ─── Database row types ──────────────────────────────────────────────────────

export interface Organisation {
  id: string;
  name: string;
  industry: string | null;
  plan_tier: string;
  join_code: string;
  is_public: boolean;
  public_intake_site_id: string | null;
  created_at: string;
  is_active: boolean;
}

export interface Site {
  id: string;
  org_id: string;
  name: string;
  location: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
  removed_at?: string | null;
  organisation?: Organisation;
}

export interface Invite {
  id: string;
  org_id: string;
  site_id: string | null;
  email: string;
  role: UserRole;
  token: string;
  invited_by: string;
  status: InviteStatus;
  created_at: string;
  accepted_at: string | null;
  expires_at: string;
}

export interface Snag {
  id: string;
  reference: string;
  org_id: string;
  site_id: string;
  reporter_id: string;
  kind: SnagKind;
  lane: SnagLane;
  severity: SnagSeverity | null;
  description: string | null;
  photo_path: string | null;
  photo_paths: string[];
  occurred_at: string;
  latitude: number | null;
  longitude: number | null;
  status: SnagStatus;
  created_at: string;
  owner_id: string | null;
  assigned_at: string | null;
  resolution_note: string | null;
  retained_until: string;
  is_notifiable: boolean;
  is_public_submission?: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  escalated_by: string | null;
  escalated_at: string | null;
  approver_id: string | null;
  // Merge (parent/child) — a status change on a parent cascades to every
  // child; a child otherwise behaves like an ordinary snag.
  parent_snag_id?: string | null;
  merged_by?: string | null;
  merged_at?: string | null;
  child_count?: number;
  // Joined relations (populated when read via the frontend's own queries)
  reporter?: Pick<Profile, 'id' | 'name'>;
  owner?: Pick<Profile, 'id' | 'name'> | null;
  site?: Pick<Site, 'id' | 'name'>;
  // From snags_with_details
  reporter_name?: string;
  reporter_email?: string;
  owner_name?: string | null;
  site_name?: string;
  checklist_completed_count?: number;
  evidence_count?: number;
  open_corrective_action_count?: number;
  comment_count?: number;
  vote_score?: number;
  upvote_count?: number;
  downvote_count?: number;
}

export interface Comment {
  id: string;
  snag_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author?: Pick<Profile, 'id' | 'name'>;
}

export interface Vote {
  id: string;
  snag_id: string;
  user_id: string;
  value: VoteValue;
  created_at: string;
}

export interface UserPoints {
  id: string;
  user_id: string;
  org_id: string;
  points: number;
  updated_at: string;
}

// ─── Investigation (serious lane) ────────────────────────────────────────────

export interface WitnessStatement {
  id: string;
  snag_id: string;
  witness_name: string;
  statement_text: string;
  taken_by: string;
  taken_at: string;
}

export interface EvidenceItem {
  id: string;
  snag_id: string;
  uploaded_by: string;
  media_path: string;
  caption: string | null;
  captured_at: string;
  sort_index: number;
}

// ─── Navigation param lists ──────────────────────────────────────────────────

export type RootStackParamList = {
  Main: undefined;
  // `issueId` here refers to a snags.id — the param name is kept for
  // minimal navigation-call churn even though the underlying entity is a Snag.
  IssueDetail: { issueId: string };
  Reports: undefined;
  ReportIncidentDetails: undefined;
  ReportIncidentReview: undefined;
  ScanOrgCode: undefined;
  ChooseReportOrg: undefined;
  ManageOrganisation: undefined;
  Mentions: undefined;
};

export type MainTabParamList = {
  Issues: undefined;
  Report: undefined;
  Admin: undefined;
  Profile: undefined;
};

// ─── Display helpers ─────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<SnagStatus, string> = {
  flagged: 'Flagged',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  rca_pending: 'RCA Pending',
};

export const SEVERITY_LABELS: Record<SnagSeverity, string> = {
  minor: 'Minor',
  moderate: 'Moderate',
  injury: 'Injury',
  critical: 'Critical',
};

export const KIND_LABELS: Record<SnagKind, string> = {
  fixit: 'Fixit',
  improvement: 'Improvement',
  hazard: 'Hazard',
  incident: 'Incident',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  worker: 'Worker',
  supervisor: 'Supervisor',
  officer_admin: 'Officer Admin',
};

// Ordered to match the server's checklist_step enum — the first-response steps
// a supervisor works through before a serious snag can be resolved.
export const CHECKLIST_STEP_LABELS: Record<ChecklistStep, string> = {
  make_safe: 'Make the area safe',
  preserve_scene: 'Preserve the scene',
  capture_evidence: 'Capture evidence',
  identify_witnesses: 'Identify witnesses',
  find_root_cause: 'Find the root cause',
};

export const CHECKLIST_STEPS: ChecklistStep[] = [
  'make_safe', 'preserve_scene', 'capture_evidence', 'identify_witnesses', 'find_root_cause',
];
