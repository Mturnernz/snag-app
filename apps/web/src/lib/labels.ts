import type { Enums } from './supabase';

export const KIND_LABELS: Record<Enums<'snag_kind'>, string> = {
  fixit: 'Fix-it',
  improvement: 'Improvement',
  hazard: 'Hazard',
  incident: 'Incident',
};

export const SEVERITY_LABELS: Record<Enums<'snag_severity'>, string> = {
  minor: 'Minor',
  moderate: 'Moderate',
  injury: 'Injury',
  critical: 'Critical',
};

export const STATUS_LABELS: Record<Enums<'snag_status'>, string> = {
  flagged: 'Flagged',
  in_progress: 'In progress',
  sorted: 'Sorted',
  resolved: 'Resolved',
  rca_pending: 'RCA pending',
};

export const STEP_LABELS: Record<Enums<'checklist_step'>, string> = {
  make_safe: 'Make the area safe',
  preserve_scene: 'Preserve the scene',
  capture_evidence: 'Capture evidence',
  identify_witnesses: 'Identify witnesses',
  find_root_cause: 'Find the root cause',
};

export const RCA_STATUS_LABELS: Record<Enums<'rca_status'>, string> = {
  assigned: 'Assigned',
  in_progress: 'In progress',
  submitted: 'Awaiting review',
  accepted: 'Accepted',
  rejected: 'Sent back',
};

export const DEBRIEF_FORMAT_LABELS: Record<Enums<'debrief_format'>, string> = {
  hot: 'Hot debrief',
  formal: 'Formal debrief',
};

export const ROLE_LABELS: Record<Enums<'user_role'>, string> = {
  worker: 'Worker',
  supervisor: 'Supervisor',
  officer_admin: 'Admin',
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
