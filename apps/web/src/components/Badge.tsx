import {
  STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS,
  type SnagStatus, type SnagKind, type SnagSeverity,
} from '@snag/shared-types';
import styles from './Badge.module.css';

// Centralises the status/kind/severity colour logic that used to be
// duplicated inline across the snags list, snag detail, and reports pages —
// mirrors apps/mobile's StatusBadge/CategoryBadge/PriorityBadge split.

const STATUS_VARIANTS: Record<SnagStatus, string> = {
  flagged: 'flagged',
  in_progress: 'in-progress',
  resolved: 'resolved',
  rca_pending: 'rca-pending',
};

export function StatusBadge({ status }: { status: SnagStatus }) {
  return <span className={styles.badge} data-variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</span>;
}

export function KindBadge({ kind }: { kind: SnagKind }) {
  return <span className={styles.badge} data-variant="neutral">{KIND_LABELS[kind]}</span>;
}

// Only injury/critical carry an alert colour, mirroring theme.ts's
// priority.high — minor/moderate render neutral so they don't collide with
// status badge hues.
export function SeverityBadge({ severity }: { severity: SnagSeverity }) {
  const isHigh = severity === 'critical' || severity === 'injury';
  return <span className={styles.badge} data-variant={isHigh ? 'danger' : 'neutral'}>{SEVERITY_LABELS[severity]}</span>;
}

export function NotifiableBadge() {
  return <span className={styles.badge} data-variant="danger">Notifiable</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'primary' | 'success' | 'danger' }) {
  return <span className={styles.badge} data-variant={tone}>{children}</span>;
}
