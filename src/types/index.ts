// ─── Enums ──────────────────────────────────────────────────────────────────

export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type IssuePriority = 'low' | 'medium' | 'high';
export type IssueCategory =
  | 'niggle'
  | 'broken_equipment'
  | 'health_and_safety'
  | 'other';
export type UserRole = 'worker' | 'manager' | 'admin';
export type VoteValue = 1 | -1;

// ─── Database row types ──────────────────────────────────────────────────────

export interface Organisation {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  organisation_id: string | null;
  invite_code: string;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
  organisation?: Organisation;
}

export interface Issue {
  id: string;
  title: string;
  description: string | null;
  photo_url: string | null;
  category: IssueCategory;
  priority: IssuePriority;
  status: IssueStatus;
  reporter_id: string;
  assignee_id: string | null;
  organisation_id: string;
  created_at: string;
  updated_at: string;
  // Joined relations
  reporter?: Pick<Profile, 'id' | 'name' | 'avatar_url'>;
  assignee?: Pick<Profile, 'id' | 'name' | 'avatar_url'> | null;
  comment_count?: number;
  vote_score?: number;
  upvote_count?: number;
  downvote_count?: number;
}

export interface Comment {
  id: string;
  issue_id: string;
  author_id: string;
  body: string;
  created_at: string;
  // Joined
  author?: Pick<Profile, 'id' | 'name' | 'avatar_url'>;
}

export interface Vote {
  id: string;
  issue_id: string;
  user_id: string;
  value: VoteValue;
  created_at: string;
}

// ─── Navigation param lists ──────────────────────────────────────────────────

export type RootStackParamList = {
  Main: undefined;
  IssueDetail: { issueId: string };
  Reports: undefined;
  Leaderboard: undefined;
};

export type MainTabParamList = {
  Issues: undefined;
  Report: undefined;
  Admin: undefined;
  Profile: undefined;
};

// ─── Display helpers ─────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  niggle: 'Niggle',
  broken_equipment: 'Broken Equipment',
  health_and_safety: 'Health & Safety',
  other: 'Other',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  worker: 'Worker',
  manager: 'Manager',
  admin: 'Admin',
};
