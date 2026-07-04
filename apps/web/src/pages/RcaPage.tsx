import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, type Profile } from '../lib/supabase';
import { friendlyError } from '../lib/errors';
import { RCA_STATUS_LABELS, formatDateTime } from '../lib/labels';
import { useSession } from '../hooks/useSession';
import { useSnag } from '../hooks/useSnag';
import { useRca } from '../hooks/useRca';
import { useMembers } from '../hooks/useMembers';
import { downloadWorksheet, importWorksheet } from '../lib/worksheet';

// A worksheet value that clashes with already-typed text: the user picks,
// nothing is overwritten silently.
function ConflictPicker({ worksheetValue, onPick }: { worksheetValue: string; onPick: (useWorksheet: boolean) => void }) {
  return (
    <div
      className="error-banner"
      style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', flexWrap: 'wrap' }}
    >
      <span style={{ flex: 1 }}>Worksheet says: “{worksheetValue}”</span>
      <button type="button" className="btn-secondary" onClick={() => onPick(true)}>Use worksheet</button>
      <button type="button" className="btn-secondary" onClick={() => onPick(false)}>Keep mine</button>
    </div>
  );
}

// The focused page an RCA assignee lands on (deep-linked from email).
// Shows only what the RCA needs — the full investigation stays on SnagDetail.
export default function RcaPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useSession();
  const { snag, loading: snagLoading, canEdit } = useSnag(id);
  const { rca, whySteps, loading: rcaLoading, reload } = useRca(id);
  const { memberName } = useMembers();

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Assign form — assignees are scoped to people who can access this
  // snag's site (members + site supervisors + org admins).
  const [assignees, setAssignees] = useState<Profile[]>([]);
  const [assignee, setAssignee] = useState('');

  // 5-Whys local state: [why, answer] x5
  const [steps, setSteps] = useState<{ why: string; answer: string }[]>(
    Array.from({ length: 5 }, () => ({ why: '', answer: '' }))
  );
  const [rejectNote, setRejectNote] = useState('');

  // Worksheet round-trip: values read from an uploaded PDF that CONFLICT
  // with what's already typed — the user picks per field, never a silent
  // overwrite. Keyed "why_1".."answer_5".
  const [worksheetConflicts, setWorksheetConflicts] = useState<Record<string, string>>({});
  const [worksheetBanner, setWorksheetBanner] = useState<string | null>(null);

  const rcaOpen = rca != null && !['accepted', 'cancelled'].includes(rca.status);
  const needAssigneeList = canEdit && rca?.status !== 'accepted';

  useEffect(() => {
    if (!snag || !needAssigneeList) return;
    async function loadAssignees() {
      const [memberRes, supervisorRes, adminRes] = await Promise.all([
        supabase.from('site_members').select('user_id').eq('site_id', snag!.site_id),
        supabase.from('site_supervisors').select('user_id').eq('site_id', snag!.site_id),
        supabase.from('profiles').select('id').eq('role', 'officer_admin'),
      ]);
      const ids = new Set<string>([
        ...(memberRes.data ?? []).map((r) => r.user_id),
        ...(supervisorRes.data ?? []).map((r) => r.user_id),
        ...(adminRes.data ?? []).map((r) => r.id),
      ]);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', [...ids])
        .order('name');
      setAssignees(profiles ?? []);
    }
    loadAssignees();
  }, [snag, needAssigneeList]);

  // Seed the form from saved steps; pre-fill Why 1 from the snag
  // description, and chain Answer N -> Why N+1 (both editable) — this is
  // how the 5-Whys method is meant to flow.
  useEffect(() => {
    if (!snag) return;
    setSteps((prev) => {
      const next = prev.map((_, i) => {
        const saved = whySteps.find((s) => s.why_index === i + 1);
        return saved
          ? { why: saved.why_text, answer: saved.answer_text }
          : { why: '', answer: '' };
      });
      if (!next[0].why && snag.description) {
        next[0] = { ...next[0], why: `Why did this happen: ${snag.description}?` };
      }
      for (let i = 1; i < 5; i++) {
        if (!next[i].why && next[i - 1].answer) {
          next[i] = { ...next[i], why: `Why: ${next[i - 1].answer}?` };
        }
      }
      return next;
    });
  }, [whySteps, snag]);

  function updateStep(index: number, field: 'why' | 'answer', value: string) {
    setSteps((prev) => {
      const next = prev.map((s, i) => (i === index ? { ...s, [field]: value } : s));
      // Chain: finishing Answer N pre-fills an empty Why N+1 (editable).
      if (field === 'answer' && index < 4 && !prev[index + 1].why) {
        next[index + 1] = { ...next[index + 1], why: value ? `Why: ${value}?` : '' };
      }
      return next;
    });
  }

  async function run(action: string, fn: () => Promise<unknown>, doneMessage?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (doneMessage) {
        setNotice(doneMessage);
        setTimeout(() => setNotice(null), 4000);
      }
    } catch (err) {
      setNotice(null);
      setError(friendlyError(action, err));
    } finally {
      setBusy(false);
    }
  }

  async function rpcOrThrow<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignee) return;
    await run('assignRca', async () => {
      await rpcOrThrow(supabase.rpc('assign_rca', { p_snag_id: snag!.id, p_assignee_id: assignee }));
      await reload();
    }, 'RCA assigned — they have been emailed a link to this page.');
  }

  async function handleSaveStep(index: number) {
    const step = steps[index];
    if (!rca || !step.why.trim() || !step.answer.trim()) return;
    await run('saveWhy', async () => {
      await rpcOrThrow(supabase.rpc('save_rca_why', {
        p_rca_id: rca.id,
        p_why_index: index + 1,
        p_why_text: step.why.trim(),
        p_answer_text: step.answer.trim(),
      }));
      await reload();
    }, `Why ${index + 1} saved.`);
  }

  async function handleSubmit() {
    if (!rca) return;
    if (!window.confirm('Submit this RCA for review? You can’t edit it while it’s being reviewed.')) return;
    await run('submitRca', async () => {
      // Save any edited-but-unsaved steps first so nothing typed is lost.
      for (let i = 0; i < 5; i++) {
        const step = steps[i];
        const saved = whySteps.find((s) => s.why_index === i + 1);
        if (
          step.why.trim() && step.answer.trim() &&
          (saved?.why_text !== step.why.trim() || saved?.answer_text !== step.answer.trim())
        ) {
          await rpcOrThrow(supabase.rpc('save_rca_why', {
            p_rca_id: rca.id,
            p_why_index: i + 1,
            p_why_text: step.why.trim(),
            p_answer_text: step.answer.trim(),
          }));
        }
      }
      await rpcOrThrow(supabase.rpc('submit_rca', { p_rca_id: rca.id }));
      await reload();
    }, 'Submit RCA — done. The supervisor has been notified.');
  }

  async function handleAccept() {
    if (!rca) return;
    if (!window.confirm('Accept this RCA? This closes it and returns the snag to sorted.')) return;
    await run('acceptRca', async () => {
      await rpcOrThrow(supabase.rpc('accept_rca', { p_rca_id: rca.id }));
      await reload();
    }, 'RCA accepted.');
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rca || !rejectNote.trim()) return;
    await run('rejectRca', async () => {
      await rpcOrThrow(supabase.rpc('reject_rca', { p_rca_id: rca.id, p_rejection_note: rejectNote.trim() }));
      setRejectNote('');
      await reload();
    }, 'Sent back to the assignee with your note.');
  }

  async function handleReassign(e: React.FormEvent) {
    e.preventDefault();
    if (!rca || !assignee) return;
    await run('reassignRca', async () => {
      await rpcOrThrow(supabase.rpc('reassign_rca', { p_rca_id: rca.id, p_new_assignee_id: assignee }));
      setAssignee('');
      await reload();
    }, 'RCA reassigned — the new assignee has been emailed.');
  }

  async function handleCancel() {
    if (!rca) return;
    if (!window.confirm('Cancel this RCA? The snag returns to sorted; a new RCA can be assigned later.')) return;
    await run('cancelRca', async () => {
      await rpcOrThrow(supabase.rpc('cancel_rca', { p_rca_id: rca.id }));
      await reload();
    }, 'RCA cancelled — the snag is back to sorted.');
  }

  async function handleDownloadWorksheet() {
    await run('worksheet', () => downloadWorksheet(snag!.id, 'rca'));
  }

  async function handleUploadWorksheet(file: File) {
    await run('worksheetImport', async () => {
      const { parsed } = await importWorksheet(snag!.id, 'rca', file);
      const hasFields = Object.keys(parsed).some((k) => /^(why|answer)_[1-5]$/.test(k));
      if (!hasFields) {
        setWorksheetBanner(
          'Worksheet saved to the record (see Evidence on the snag). No typed fields were found — type the answers into the form below.'
        );
        return;
      }
      const conflicts: Record<string, string> = {};
      setSteps((prev) =>
        prev.map((step, i) => {
          const next = { ...step };
          for (const field of ['why', 'answer'] as const) {
            const value = parsed[`${field}_${i + 1}`]?.trim();
            if (!value) continue;
            if (!next[field].trim()) {
              next[field] = value;
            } else if (next[field].trim() !== value) {
              conflicts[`${field}_${i + 1}`] = value;
            }
          }
          return next;
        })
      );
      setWorksheetConflicts(conflicts);
      setWorksheetBanner(
        Object.keys(conflicts).length > 0
          ? 'Loaded from your uploaded worksheet — some fields already had different text; pick which version to keep, check each answer, then save.'
          : 'Loaded from your uploaded worksheet — check each answer, then save. The PDF itself is on the record as evidence.'
      );
    });
  }

  function resolveConflict(key: string, useWorksheet: boolean) {
    const value = worksheetConflicts[key];
    if (useWorksheet && value) {
      const [field, indexStr] = key.split('_') as ['why' | 'answer', string];
      const index = Number(indexStr) - 1;
      setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
    }
    setWorksheetConflicts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  if (snagLoading || rcaLoading) return <p className="meta">Loading RCA…</p>;
  if (!snag) {
    return (
      <div className="card">
        <p>This snag could not be found, or you don't have access to its site.</p>
        <Link to="/">← Back to all snags</Link>
      </div>
    );
  }

  const isAssignee = profile?.id === rca?.assigned_to;
  const editable = rca != null && ['assigned', 'in_progress', 'rejected'].includes(rca.status) && (isAssignee || canEdit);
  const reviewable = rca?.status === 'submitted' && canEdit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <Link to={`/snags/${snag.id}`} className="meta" style={{ textDecoration: 'none' }}>
        ← {snag.reference}{snag.description ? ` — ${snag.description.slice(0, 80)}` : ''}
      </Link>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <h2>Root Cause Analysis</h2>
          {rca && (
            <span className="pill" style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)' }}>
              {RCA_STATUS_LABELS[rca.status]}
            </span>
          )}
        </div>
        {rca && (
          <p className="meta" style={{ margin: 0 }}>
            Assigned to {memberName(rca.assigned_to)} by {memberName(rca.assigned_by)} · {formatDateTime(rca.created_at)}
            {rca.accepted_at ? ` · accepted by ${memberName(rca.accepted_by)} ${formatDateTime(rca.accepted_at)}` : ''}
          </p>
        )}
        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="success-banner">{notice}</div>}
      </div>

      {/* No RCA yet (or last one cancelled): assign form (supervisors, sorted snags only) */}
      {(!rca || rca.status === 'cancelled') && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {canEdit && snag.status === 'sorted' ? (
            <form onSubmit={handleAssign} style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
              <select
                className="input"
                style={{ flex: 1, minWidth: 200 }}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Delegate the 5-Whys to…</option>
                {assignees.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.email}</option>
                ))}
              </select>
              <button className="btn-primary" type="submit" disabled={busy || !assignee}>
                Assign RCA
              </button>
            </form>
          ) : (
            <p className="meta" style={{ margin: 0 }}>
              No RCA yet. A supervisor can delegate one once the snag is sorted.
            </p>
          )}
        </div>
      )}

      {/* Rejection note */}
      {rca?.status === 'rejected' && rca.rejection_note && (
        <div className="error-banner">
          Sent back: {rca.rejection_note}
        </div>
      )}

      {/* Worksheet round-trip */}
      {rca && editable && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <strong>Prefer paper or a PDF reader?</strong>
          <p className="meta" style={{ margin: 0 }}>
            Download the worksheet, fill it in (typed or by hand), then upload it here.
            The upload always goes on the record as evidence; typed answers pre-fill
            the form below for you to check and save.
          </p>
          {worksheetBanner && <div className="success-banner">{worksheetBanner}</div>}
          <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn-secondary" onClick={handleDownloadWorksheet} disabled={busy}>
              Download worksheet (PDF)
            </button>
            <label className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center' }}>
              Upload completed worksheet
              <input
                type="file"
                accept="application/pdf"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadWorksheet(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
      )}

      {/* 5-Whys form */}
      {rca && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <strong>Why {i + 1}</strong>
              <input
                className="input"
                placeholder={`Why ${i + 1}…`}
                value={step.why}
                onChange={(e) => updateStep(i, 'why', e.target.value)}
                disabled={!editable}
              />
              {worksheetConflicts[`why_${i + 1}`] && (
                <ConflictPicker
                  worksheetValue={worksheetConflicts[`why_${i + 1}`]}
                  onPick={(useWorksheet) => resolveConflict(`why_${i + 1}`, useWorksheet)}
                />
              )}
              <textarea
                className="input"
                placeholder="Because…"
                rows={2}
                value={step.answer}
                onChange={(e) => updateStep(i, 'answer', e.target.value)}
                onBlur={() => editable && handleSaveStep(i)}
                disabled={!editable}
              />
              {worksheetConflicts[`answer_${i + 1}`] && (
                <ConflictPicker
                  worksheetValue={worksheetConflicts[`answer_${i + 1}`]}
                  onPick={(useWorksheet) => resolveConflict(`answer_${i + 1}`, useWorksheet)}
                />
              )}
            </div>
          ))}

          {editable && (
            <button className="btn-primary" onClick={handleSubmit} disabled={busy}>
              Submit RCA
            </button>
          )}
        </div>
      )}

      {/* Supervisor review */}
      {reviewable && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <strong>Review</strong>
          <button className="btn-primary" onClick={handleAccept} disabled={busy}>
            Accept RCA
          </button>
          <form onSubmit={handleReject} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <textarea
              className="input"
              placeholder="What needs another look? (required to send back)"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={2}
            />
            <button className="btn-secondary self-start" type="submit" disabled={busy || !rejectNote.trim()}>
              Send back
            </button>
          </form>
        </div>
      )}

      {/* Supervisor: reassign / cancel an unfinished RCA */}
      {canEdit && rcaOpen && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <strong>Reassign or cancel</strong>
          {rca!.status !== 'submitted' && (
            <form onSubmit={handleReassign} style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <select
                className="input"
                style={{ flex: 1 }}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Reassign to…</option>
                {assignees
                  .filter((m) => m.id !== rca!.assigned_to)
                  .map((m) => (
                    <option key={m.id} value={m.id}>{m.name || m.email}</option>
                  ))}
              </select>
              <button className="btn-secondary" type="submit" disabled={busy || !assignee}>
                Reassign
              </button>
            </form>
          )}
          <button className="btn-secondary" onClick={handleCancel} disabled={busy}>
            Cancel RCA (snag returns to sorted)
          </button>
        </div>
      )}
    </div>
  );
}
