import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, signedUrl, type Enums } from '../lib/supabase';
import { friendlyError } from '../lib/errors';
import {
  KIND_LABELS, SEVERITY_LABELS, STEP_LABELS, RCA_STATUS_LABELS,
  DEBRIEF_FORMAT_LABELS, formatDate, formatDateTime,
} from '../lib/labels';
import { useSession } from '../hooks/useSession';
import { useSnag } from '../hooks/useSnag';
import { useSnagRecord } from '../hooks/useSnagRecord';
import { useRca } from '../hooks/useRca';
import { useDebriefs } from '../hooks/useDebriefs';
import { useMembers } from '../hooks/useMembers';
import { KindPill, SeverityPill, StatusPill, NotifiablePill } from '../components/Pills';
import ProgressStrip from '../components/ProgressStrip';
import Section from '../components/Section';

const CHECKLIST_STEPS: Enums<'checklist_step'>[] = [
  'make_safe', 'preserve_scene', 'capture_evidence', 'identify_witnesses', 'find_root_cause',
];

export default function SnagDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useSession();
  const { snag, loading, canEdit, reload } = useSnag(id);
  const record = useSnagRecord(id);
  const { rca } = useRca(id);
  const { debriefs } = useDebriefs(id);
  const { members, memberName } = useMembers();

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  // Forms
  const [witnessName, setWitnessName] = useState('');
  const [witnessText, setWitnessText] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceCaption, setEvidenceCaption] = useState('');
  const [rootCauseText, setRootCauseText] = useState('');
  const [actionText, setActionText] = useState('');
  const [actionOwner, setActionOwner] = useState('');
  const [actionDue, setActionDue] = useState('');
  const [resolveNote, setResolveNote] = useState('');
  const [recatKind, setRecatKind] = useState<Enums<'snag_kind'> | ''>('');
  const [recatSeverity, setRecatSeverity] = useState<Enums<'snag_severity'> | ''>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    supabase.rpc('mark_snag_seen', { p_snag_id: id }).then(() => {});
  }, [id]);

  useEffect(() => {
    if (snag?.photo_path) {
      signedUrl('snag-photos', snag.photo_path).then(setPhotoUrl);
    }
  }, [snag?.photo_path]);

  useEffect(() => {
    if (record.investigation) setRootCauseText(record.investigation.root_cause_text);
  }, [record.investigation]);

  function fail(action: string, err: unknown) {
    setNotice(null);
    setError(friendlyError(action, err));
  }

  function ok(message: string) {
    setError(null);
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  }

  async function run(action: string, fn: () => Promise<unknown>, doneMessage?: string) {
    setBusy(true);
    try {
      await fn();
      if (doneMessage) ok(doneMessage);
    } catch (err) {
      fail(action, err);
    } finally {
      setBusy(false);
    }
  }

  async function rpcOrThrow<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  if (loading) return <p className="meta">Loading snag…</p>;
  if (!snag) {
    return (
      <div className="card">
        <p>This snag could not be found, or you don't have access to its site.</p>
        <Link to="/">← Back to all snags</Link>
      </div>
    );
  }

  const serious = snag.lane === 'serious';
  const isReporter = profile?.id === snag.reporter_id;
  const isOwner = profile?.id === snag.owner_id;
  const checklistDone = record.checklist.length >= 5;
  const hasRootCause = record.investigation != null;
  const openActions = record.actions.filter((a) => a.status === 'open');
  const latestDebrief = debriefs[0];

  // Exactly one section defaults open: the current step for this user.
  const openSection: string = !checklistDone
    ? 'checklist'
    : !hasRootCause
      ? record.witnesses.length === 0 ? 'witnesses' : 'rootcause'
      : openActions.length > 0
        ? 'actions'
        : 'none';

  async function handleChecklistStep(step: Enums<'checklist_step'>) {
    await run('checklist', async () => {
      await rpcOrThrow(supabase.rpc('complete_checklist_step', { p_snag_id: snag!.id, p_step: step }));
      await record.reloadChecklist();
    });
  }

  async function handleAddWitness(e: React.FormEvent) {
    e.preventDefault();
    if (!witnessName.trim() || !witnessText.trim()) return;
    await run('witness', async () => {
      await rpcOrThrow(supabase.rpc('add_witness_statement', {
        p_snag_id: snag!.id,
        p_witness_name: witnessName.trim(),
        p_statement_text: witnessText.trim(),
      }));
      setWitnessName('');
      setWitnessText('');
      await record.reloadWitnesses();
    }, 'Witness statement added — it is now locked on the record.');
  }

  async function handleAddEvidence(e: React.FormEvent) {
    e.preventDefault();
    if (!evidenceFile || !profile) return;
    await run('evidence', async () => {
      const path = `${profile.org_id}/${snag!.id}/${Date.now()}-${evidenceFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from('snag-evidence')
        .upload(path, evidenceFile);
      if (uploadError) throw uploadError;
      await rpcOrThrow(supabase.rpc('add_evidence_item', {
        p_snag_id: snag!.id,
        p_media_path: path,
        p_caption: evidenceCaption.trim() || undefined,
      }));
      setEvidenceFile(null);
      setEvidenceCaption('');
      await record.reloadEvidence();
    }, 'Evidence added to the record.');
  }

  async function handleSetRootCause(e: React.FormEvent) {
    e.preventDefault();
    if (!rootCauseText.trim()) return;
    await run('rootCause', async () => {
      await rpcOrThrow(supabase.rpc('set_root_cause', {
        p_snag_id: snag!.id,
        p_root_cause_text: rootCauseText.trim(),
      }));
      await record.reloadInvestigation();
    }, 'Root cause recorded.');
  }

  async function handleCreateAction(e: React.FormEvent) {
    e.preventDefault();
    if (!actionText.trim() || !actionOwner || !actionDue) return;
    await run('action', async () => {
      await rpcOrThrow(supabase.rpc('create_corrective_action', {
        p_snag_id: snag!.id,
        p_description: actionText.trim(),
        p_owner_id: actionOwner,
        p_due_date: actionDue,
      }));
      setActionText('');
      setActionOwner('');
      setActionDue('');
      await record.reloadActions();
    }, 'Corrective action created.');
  }

  async function handleCompleteAction(actionId: string) {
    await run('completeAction', async () => {
      await rpcOrThrow(supabase.rpc('complete_corrective_action', { p_action_id: actionId }));
      await record.reloadActions();
    });
  }

  async function handleMarkSorted() {
    if (!window.confirm('Mark this snag as sorted? This closes the investigation.')) return;
    await run('markSorted', async () => {
      await rpcOrThrow(supabase.rpc('update_snag_status', { p_snag_id: snag!.id, p_status: 'sorted' }));
      await reload();
    }, 'Sorted. The reporter has been notified.');
  }

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    await run('resolve', async () => {
      await rpcOrThrow(supabase.rpc('resolve_snag', { p_snag_id: snag!.id, p_note: resolveNote.trim() }));
      setResolveNote('');
      await reload();
    }, 'Marked resolved — awaiting confirmation.');
  }

  async function handleConfirm() {
    await run('confirm', async () => {
      await rpcOrThrow(supabase.rpc('confirm_snag', { p_snag_id: snag!.id }));
      await reload();
    }, 'Confirmed sorted.');
  }

  async function handleEscalate() {
    await run('escalate', async () => {
      await rpcOrThrow(supabase.rpc('escalate_snag', { p_snag_id: snag!.id }));
      await reload();
    }, 'Flagged for attention — site supervisors have been notified.');
  }

  async function handleRecategorise(e: React.FormEvent) {
    e.preventDefault();
    if (!recatKind) return;
    await run('recategorise', async () => {
      await rpcOrThrow(supabase.rpc('recategorise_snag', {
        p_snag_id: snag!.id,
        p_kind: recatKind as Enums<'snag_kind'>,
        p_severity: recatSeverity ? (recatSeverity as Enums<'snag_severity'>) : undefined,
      }));
      setRecatKind('');
      setRecatSeverity('');
      await reload();
    }, 'Snag recategorised.');
  }

  async function handleToggleNotifiable() {
    await run('notifiable', async () => {
      await rpcOrThrow(supabase.rpc('set_notifiable_flag', {
        p_snag_id: snag!.id,
        p_value: !snag!.is_notifiable,
      }));
      await reload();
    });
  }

  async function handleExport() {
    await run('export', async () => {
      const { data, error: fnError } = await supabase.functions.invoke('export-investigation', {
        body: { snag_id: snag!.id },
      });
      if (fnError) throw fnError;
      const url = (data as { signedUrl?: string })?.signedUrl;
      if (url) window.open(url, '_blank');
    }, 'Investigation file exported and logged on the record.');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <Link to="/" className="meta" style={{ textDecoration: 'none' }}>← All snags</Link>

      {/* Header */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <h2>{snag.reference}</h2>
          <KindPill kind={snag.kind} />
          {snag.severity && <SeverityPill severity={snag.severity} />}
          {snag.is_notifiable && <NotifiablePill />}
          <span style={{ marginLeft: 'auto' }}><StatusPill status={snag.status} /></span>
        </div>

        {serious && (
          <ProgressStrip
            snag={snag}
            checklistCount={record.checklist.length}
            hasRootCause={hasRootCause}
            rca={rca}
            openActionCount={openActions.length}
          />
        )}

        {photoUrl && (
          <img
            src={photoUrl}
            alt="Snag photo"
            style={{ maxWidth: '100%', borderRadius: 'var(--radius-button)', maxHeight: 320, objectFit: 'cover' }}
          />
        )}
        {snag.description && <p style={{ margin: 0 }}>{snag.description}</p>}
        <div className="meta">
          Reported by {memberName(snag.reporter_id)} · {formatDateTime(snag.created_at)}
          {snag.owner_id ? <> · held by {memberName(snag.owner_id)}</> : null}
          {snag.retained_until ? <> · retained until {formatDate(snag.retained_until)}</> : null}
        </div>

        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="success-banner">{notice}</div>}
      </div>

      {/* Niggle lane: resolve / confirm / escalate */}
      {!serious && (
        <Section title="Sort it" defaultOpen>
          {snag.status === 'sorted' ? (
            <p className="meta">
              Sorted{snag.confirmed_by ? ` — confirmed by ${memberName(snag.confirmed_by)}` : ''}.
              {snag.resolution_note ? ` "${snag.resolution_note}"` : ''}
            </p>
          ) : snag.status === 'resolved' ? (
            <>
              <p style={{ margin: 0 }}>
                Resolved by {memberName(snag.resolved_by)}: "{snag.resolution_note}"
              </p>
              {(canEdit || profile?.id === snag.approver_id) ? (
                <button className="btn-primary" onClick={handleConfirm} disabled={busy}>
                  Confirm it's sorted
                </button>
              ) : (
                <p className="meta">Waiting for a supervisor to confirm.</p>
              )}
            </>
          ) : (
            <>
              {(isOwner || canEdit) ? (
                <form onSubmit={handleResolve} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                  <textarea
                    className="input"
                    placeholder="What was done to fix it?"
                    value={resolveNote}
                    onChange={(e) => setResolveNote(e.target.value)}
                  />
                  <button className="btn-primary" type="submit" disabled={busy || !resolveNote.trim()}>
                    Mark resolved
                  </button>
                </form>
              ) : (
                <p className="meta">
                  {snag.owner_id ? `${memberName(snag.owner_id)} is on it.` : 'Waiting to be picked up.'}
                </p>
              )}
              {isReporter && !snag.escalated_at && (
                <button className="btn-secondary" onClick={handleEscalate} disabled={busy}>
                  This needs more attention
                </button>
              )}
            </>
          )}
        </Section>
      )}

      {/* Serious lane: guided investigation */}
      {serious && (
        <>
          <Section
            title="First response"
            subtitle={`${record.checklist.length}/5 done`}
            defaultOpen={openSection === 'checklist'}
          >
            {CHECKLIST_STEPS.map((step) => {
              const done = record.checklist.find((c) => c.step === step);
              return (
                <div key={step} className="list-row">
                  <span>
                    {done ? '✓ ' : ''}{STEP_LABELS[step]}
                    {done && (
                      <span className="meta" style={{ marginLeft: 8 }}>
                        {memberName(done.completed_by)}, {formatDateTime(done.completed_at)}
                      </span>
                    )}
                  </span>
                  {!done && canEdit && (
                    <button className="btn-secondary" onClick={() => handleChecklistStep(step)} disabled={busy}>
                      Done
                    </button>
                  )}
                </div>
              );
            })}
          </Section>

          <Section
            title="Witness statements"
            subtitle={`${record.witnesses.length}`}
            defaultOpen={openSection === 'witnesses'}
          >
            {record.witnesses.length === 0 ? (
              <p className="empty-state">No witness statements yet — add the first one below.</p>
            ) : (
              record.witnesses.map((w) => (
                <div key={w.id} style={{ borderLeft: '3px solid var(--color-border)', paddingLeft: 12 }}>
                  <strong>{w.witness_name}</strong>{' '}
                  <span className="meta">taken by {memberName(w.taken_by)}, {formatDateTime(w.taken_at)} · locked</span>
                  <p style={{ margin: '4px 0 0' }}>{w.statement_text}</p>
                </div>
              ))
            )}
            {canEdit && (
              <form onSubmit={handleAddWitness} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <input
                  className="input"
                  placeholder="Witness name"
                  value={witnessName}
                  onChange={(e) => setWitnessName(e.target.value)}
                />
                <textarea
                  className="input"
                  placeholder="What they saw, in their words. Statements lock when saved."
                  value={witnessText}
                  onChange={(e) => setWitnessText(e.target.value)}
                />
                <button className="btn-secondary self-start" type="submit" disabled={busy || !witnessName.trim() || !witnessText.trim()}>
                  Add statement
                </button>
              </form>
            )}
          </Section>

          <Section title="Evidence" subtitle={`${record.evidence.length}`} defaultOpen={false}>
            {record.evidence.length === 0 ? (
              <p className="empty-state">No evidence yet — photos and files added here stay on the record permanently.</p>
            ) : (
              record.evidence.map((e) => <EvidenceRow key={e.id} path={e.media_path} caption={e.caption} />)
            )}
            {canEdit && (
              <form onSubmit={handleAddEvidence} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <input
                  className="input"
                  type="file"
                  onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
                />
                <input
                  className="input"
                  placeholder="Caption (what does this show?)"
                  value={evidenceCaption}
                  onChange={(e) => setEvidenceCaption(e.target.value)}
                />
                <button className="btn-secondary self-start" type="submit" disabled={busy || !evidenceFile}>
                  Add evidence
                </button>
              </form>
            )}
          </Section>

          <Section
            title="Root cause"
            subtitle={hasRootCause ? 'recorded' : 'not yet recorded'}
            defaultOpen={openSection === 'rootcause'}
          >
            {hasRootCause && (
              <p className="meta" style={{ margin: 0 }}>
                Lead investigator: {memberName(record.investigation!.lead_investigator_id)} ·{' '}
                {formatDateTime(record.investigation!.completed_at)}
              </p>
            )}
            {canEdit ? (
              <form onSubmit={handleSetRootCause} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <textarea
                  className="input"
                  placeholder="What actually caused this? (A delegated 5-Whys RCA can refine it later.)"
                  value={rootCauseText}
                  onChange={(e) => setRootCauseText(e.target.value)}
                  rows={4}
                />
                <button className="btn-secondary self-start" type="submit" disabled={busy || !rootCauseText.trim()}>
                  Save root cause
                </button>
              </form>
            ) : (
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {record.investigation?.root_cause_text ?? <span className="empty-state">Not yet recorded.</span>}
              </p>
            )}
          </Section>

          <Section
            title="Corrective actions"
            subtitle={`${openActions.length} open`}
            defaultOpen={openSection === 'actions'}
          >
            {record.actions.length === 0 ? (
              <p className="empty-state">No corrective actions yet — add what needs to change below.</p>
            ) : (
              record.actions.map((a) => (
                <div key={a.id} className="list-row">
                  <span className={a.status === 'done' ? 'done-item' : undefined}>
                    {a.status === 'done' ? '✓ ' : ''}{a.description}
                    <span className="meta" style={{ marginLeft: 8 }}>
                      {memberName(a.owner_id)} · due {formatDate(a.due_date)}
                    </span>
                  </span>
                  {a.status === 'open' && (canEdit || profile?.id === a.owner_id) && (
                    <button className="btn-secondary" onClick={() => handleCompleteAction(a.id)} disabled={busy}>
                      Done
                    </button>
                  )}
                </div>
              ))
            )}
            {canEdit && (
              <form onSubmit={handleCreateAction} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <input
                  className="input"
                  placeholder="What needs to be done?"
                  value={actionText}
                  onChange={(e) => setActionText(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                  <select className="input" value={actionOwner} onChange={(e) => setActionOwner(e.target.value)}>
                    <option value="">Owner…</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name || m.email}</option>
                    ))}
                  </select>
                  <input
                    className="input"
                    type="date"
                    value={actionDue}
                    onChange={(e) => setActionDue(e.target.value)}
                  />
                </div>
                <button
                  className="btn-secondary self-start"
                  type="submit"
                  disabled={busy || !actionText.trim() || !actionOwner || !actionDue}
                >
                  Add action
                </button>
              </form>
            )}
          </Section>

          {/* RCA summary card */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Root Cause Analysis (5 Whys)</strong>
              {rca && (
                <span className="pill" style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)' }}>
                  {RCA_STATUS_LABELS[rca.status]}
                </span>
              )}
            </div>
            {rca ? (
              <>
                <p className="meta" style={{ margin: 0 }}>
                  Assigned to {memberName(rca.assigned_to)} by {memberName(rca.assigned_by)} ·{' '}
                  {formatDateTime(rca.created_at)}
                </p>
                <Link to={`/snags/${snag.id}/rca`}>Open RCA →</Link>
              </>
            ) : (
              <p className="meta" style={{ margin: 0 }}>
                {snag.status === 'sorted' && canEdit
                  ? <>No RCA yet. <Link to={`/snags/${snag.id}/rca`}>Assign one →</Link></>
                  : 'An RCA can be delegated once this snag is sorted.'}
              </p>
            )}
          </div>

          {/* Debriefs summary card */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <strong>Debriefs</strong>
            <p className="meta" style={{ margin: 0 }}>
              {debriefs.length === 0
                ? 'No debriefs yet.'
                : `${debriefs.length} debrief${debriefs.length === 1 ? '' : 's'} — latest: ${
                    DEBRIEF_FORMAT_LABELS[latestDebrief.format]
                  }${latestDebrief.status === 'completed'
                    ? ` completed ${formatDate(latestDebrief.completed_at)}`
                    : ' in progress'}`}
            </p>
            <Link to={`/snags/${snag.id}/debriefs`}>Open debriefs →</Link>
          </div>

          {/* Close out */}
          {canEdit && snag.status !== 'sorted' && snag.status !== 'rca_pending' && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <strong>Close out</strong>
              <p className="meta" style={{ margin: 0 }}>
                Requires: full first response, a witness statement, evidence, a root cause, and no open actions.
              </p>
              <button className="btn-primary" onClick={handleMarkSorted} disabled={busy}>
                Mark sorted
              </button>
            </div>
          )}
        </>
      )}

      {/* Supervisor tools */}
      {canEdit && (
        <Section title="Supervisor tools" defaultOpen={false}>
          <form onSubmit={handleRecategorise} style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <select
              className="input"
              style={{ flex: 1, minWidth: 140 }}
              value={recatKind}
              onChange={(e) => setRecatKind(e.target.value as Enums<'snag_kind'> | '')}
            >
              <option value="">Recategorise to…</option>
              {(Object.keys(KIND_LABELS) as Enums<'snag_kind'>[]).map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
            {(recatKind === 'hazard' || recatKind === 'incident') && (
              <select
                className="input"
                style={{ flex: 1, minWidth: 140 }}
                value={recatSeverity}
                onChange={(e) => setRecatSeverity(e.target.value as Enums<'snag_severity'> | '')}
              >
                <option value="">Severity…</option>
                {(Object.keys(SEVERITY_LABELS) as Enums<'snag_severity'>[]).map((s) => (
                  <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
                ))}
              </select>
            )}
            <button
              className="btn-secondary"
              type="submit"
              disabled={busy || !recatKind || ((recatKind === 'hazard' || recatKind === 'incident') && !recatSeverity)}
            >
              Recategorise
            </button>
          </form>

          <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={handleToggleNotifiable} disabled={busy}>
              {snag.is_notifiable ? 'Unmark notifiable' : 'Mark as notifiable event'}
            </button>
            {serious && (
              <button className="btn-secondary" onClick={handleExport} disabled={busy}>
                Export investigation file (PDF)
              </button>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

function EvidenceRow({ path, caption }: { path: string; caption: string | null }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    signedUrl('snag-evidence', path).then(setUrl);
  }, [path]);

  return (
    <div className="list-row">
      <span>{caption || path.split('/').pop()}</span>
      {url && <a href={url} target="_blank" rel="noreferrer">View</a>}
    </div>
  );
}
