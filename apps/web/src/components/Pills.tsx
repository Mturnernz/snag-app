import type { Enums } from '../lib/supabase';
import { KIND_LABELS, SEVERITY_LABELS, STATUS_LABELS } from '../lib/labels';

export function KindPill({ kind }: { kind: Enums<'snag_kind'> }) {
  const serious = kind === 'hazard' || kind === 'incident';
  return (
    <span
      className="pill"
      style={{
        background: serious ? 'var(--color-danger-bg)' : 'var(--color-accent-light)',
        color: serious ? 'var(--color-danger)' : 'var(--color-accent)',
      }}
    >
      {KIND_LABELS[kind]}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: Enums<'snag_severity'> }) {
  const strong = severity === 'injury' || severity === 'critical';
  return (
    <span
      className="pill"
      style={{
        background: strong ? 'var(--color-danger-bg)' : 'var(--color-warn-bg)',
        color: strong ? 'var(--color-danger)' : 'var(--color-warn)',
      }}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

export function StatusPill({ status }: { status: Enums<'snag_status'> }) {
  const styles: Record<Enums<'snag_status'>, { bg: string; fg: string }> = {
    flagged: { bg: 'var(--color-accent-light)', fg: 'var(--color-accent)' },
    in_progress: { bg: 'var(--color-warn-bg)', fg: 'var(--color-warn)' },
    resolved: { bg: 'var(--color-warn-bg)', fg: 'var(--color-warn)' },
    rca_pending: { bg: 'var(--color-warn-bg)', fg: 'var(--color-warn)' },
    sorted: { bg: 'var(--color-success-bg)', fg: 'var(--color-success)' },
  };
  const s = styles[status];
  return (
    <span className="pill" style={{ background: s.bg, color: s.fg }}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function NotifiablePill() {
  return (
    <span className="pill" style={{ background: 'var(--color-danger)', color: '#fff' }}>
      Notifiable
    </span>
  );
}
