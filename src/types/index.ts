// ─── Enums ──────────────────────────────────────────────────────────────────

export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type IssuePriority = 'low' | 'medium' | 'high';
export type IssueCategory =
  | 'niggle'
  | 'broken_equipment'
  | 'health_and_safety'
  | 'other';

// ─── Database row types ──────────────────────────────────────────────────────

export interface Organisation {
  id: string;
  name: string;
  created_at: string;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  organisation_id: string;
  invite_code: string;
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

// ─── Navigation param lists ──────────────────────────────────────────────────

export type RootStackParamList = {
  Main: undefined;
  IssueDetail: { issueId: string };
};

export type MainTabParamList = {
  Issues: undefined;
  Report: undefined;
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
