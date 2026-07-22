import { notFound } from 'next/navigation';
import {
  getSnagRca, getSnagDebriefs, getInvestigationState, getCorrectiveActions,
  getSnagAuditLog, describeAuditAction,
} from '@snag/supabase-queries';
import { STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS, CHECKLIST_STEP_LABELS, CHECKLIST_STEPS, type SnagStatus } from '@snag/shared-types';
import { requireSupervisorOrAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export default async function SnagDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSupervisorOrAdmin();
  const supabase = await createClient();

  const { data: snag } = await supabase
    .from('snags_with_details')
    .select('id, reference, description, status, kind, lane, severity, site_name, owner_name, reporter_name, created_at, is_notifiable')
    .eq('id', id)
    .maybeSingle();

  if (!snag) notFound();

  const isSerious = snag.lane === 'serious';

  const [comments, rca, debriefs, investigation, actions, auditLog] = await Promise.all([
    supabase.from('comments').select('id, body, created_at, author:profiles(id, name)').eq('snag_id', id).order('created_at', { ascending: true }),
    isSerious ? getSnagRca(supabase, id) : Promise.resolve(null),
    isSerious ? getSnagDebriefs(supabase, id) : Promise.resolve([]),
    isSerious ? getInvestigationState(supabase, id) : Promise.resolve(null),
    isSerious ? getCorrectiveActions(supabase, id) : Promise.resolve([]),
    getSnagAuditLog(supabase, id),
  ]);

  return (
    <div style={{ maxWidth: 760 }}>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>{snag.site_name}</p>
      <h1 style={{ marginBottom: 8 }}>{snag.reference}</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, fontSize: 14 }}>
        <Pill>{STATUS_LABELS[snag.status as SnagStatus]}</Pill>
        <Pill>{KIND_LABELS[snag.kind as keyof typeof KIND_LABELS]}</Pill>
        {snag.severity && <Pill>{SEVERITY_LABELS[snag.severity as keyof typeof SEVERITY_LABELS]}</Pill>}
        {snag.is_notifiable && <Pill tone="danger">Notifiable</Pill>}
      </div>

      <p style={{ marginBottom: 8 }}>{snag.description ?? '(no description)'}</p>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 32 }}>
        Reported by {snag.reporter_name} · {snag.owner_name ? `assigned to ${snag.owner_name}` : 'unassigned'}
      </p>

      {isSerious && investigation && (
        <Section title="Investigation">
          <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>
            {CHECKLIST_STEPS.map((step) => (
              <li key={step} style={{ color: investigation.completedSteps.includes(step) ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                {CHECKLIST_STEP_LABELS[step]} {investigation.completedSteps.includes(step) ? '— done' : ''}
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>
            {investigation.witnesses.length} witness statement(s) · {investigation.evidence.length} evidence item(s)
            {investigation.rootCause ? ` · root cause recorded` : ' · root cause not yet recorded'}
          </p>
        </Section>
      )}

      {isSerious && rca && (
        <Section title="Root cause analysis">
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>Status: {rca.status}</p>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {rca.whys.map((why) => (
              <li key={why.whyIndex} style={{ marginBottom: 8 }}>
                <strong>{why.whyText}</strong>
                <br />
                <span style={{ color: 'var(--color-text-secondary)' }}>{why.answerText || '(not answered yet)'}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {isSerious && actions.length > 0 && (
        <Section title="Corrective actions">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {actions.map((action) => (
              <div key={action.id} className="card" style={{ padding: 12 }}>
                <p style={{ margin: '0 0 4px', fontWeight: 500 }}>{action.description}</p>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {action.owner_name ?? 'unassigned'} · due {action.due_date} · {action.verified_at ? 'verified' : action.status}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {isSerious && debriefs.length > 0 && (
        <Section title="Debriefs">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {debriefs.map((d) => (
              <div key={d.id} className="card" style={{ padding: 12 }}>
                <p style={{ margin: '0 0 8px', fontWeight: 500 }}>{d.format === 'hot' ? 'Hot debrief' : 'Formal debrief'} · {d.status}</p>
                {d.findings.map((f) => (
                  <p key={f.id} style={{ margin: '0 0 4px', fontSize: 14 }}>• {f.finding_text}</p>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Comments">
        {(!comments.data || comments.data.length === 0) && <p style={{ color: 'var(--color-text-muted)' }}>No comments yet.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(comments.data ?? []).map((c: any) => (
            <div key={c.id}>
              <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 600 }}>{c.author?.name ?? 'Unknown'}</p>
              <p style={{ margin: 0 }}>{c.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Activity">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {auditLog.map((entry) => (
            <p key={entry.id} style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              <strong>{entry.actor_name ?? 'System'}</strong> {describeAuditAction(entry.action)}
            </p>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: 20,
        background: tone === 'danger' ? 'var(--color-status-rca-pending-bg)' : 'var(--color-primary-light)',
        color: tone === 'danger' ? 'var(--color-status-rca-pending)' : 'var(--color-primary)',
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}
