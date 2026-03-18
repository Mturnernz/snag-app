export function getUserTitle(points: number): string {
  if (points >= 5000) return '🏆 Site Legend';
  if (points >= 1500) return 'Snag Hunter';
  if (points >= 500) return 'Site Regular';
  if (points >= 100) return 'On the Tools';
  return 'New Boot';
}

export interface UserPointsRow {
  user_id: string;
  org_id: string;
  points: number;
  updated_at: string;
}

export interface PointsLogRow {
  id: string;
  user_id: string;
  org_id: string;
  event: string;
  points: number;
  issue_id: string | null;
  created_at: string;
}
