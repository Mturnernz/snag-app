import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/errors';
import { DEBRIEF_FORMAT_LABELS, formatDate, formatDateTime } from '../lib/labels';
import { useSnag } from '../hooks/useSnag';
import { useDebrief } from '../hooks/useDebriefs';
import { useMembers } from '../hooks/useMembers';

// Hot debriefs structure the findings as three prompts; formal debriefs
// keep free-form findings. Both feed add_debrief_finding.
const HOT_PROMPTS = [
  'What was supposed to happen',
  'What actually happened',
  "What we'll do differently right now",
];

export default function DebriefPage() {
  const { id, debriefId } = useParams<{ id: string; debriefId: string }>();
  const { snag, loading: snagLoading, canEdit } = useSnag(id);
  const {
    debrief, reloadDebrief,
    findings, reloadFindings,
    attendees, reloadAttendees,
    lessons, reloadLessons,
    loading,
  } = useDebrief(debriefId);
  const { members, memberName } = useMembers();

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [findingText, setFindingText] = useState('');
  const [hotFindings, setHotFindings] = useState<string[]>(['', '', '']);
  const [attendeeId, setAttendeeId] = useState('');
  const [lessonText, setLessonText] = useState('');

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

  async function addFinding(text: string) {
    if (!debrief || !text.trim()) return;
    await run('finding', async () => {
      await rpcOrThrow(supabase.rpc('add_debrief_finding', {
        p_debrief_id: debrief.id,
        p_finding_text: text.trim(),
      }));
      await reloadFindings();
    });
  }

  async function handleHotFindings(e: React.FormEvent) {
    e.preventDefault();
    for (let i = 0; i < HOT_PROMPTS.length; i++) {
      if (hotFindings[i].trim()) {
        await addFinding(`${HOT_PROMPTS[i]}: ${hotFindings[i]}`);
      }
    }
    setHotFindings(['', '', '']);
  }

  async function handleFormalFinding(e: React.FormEvent) {
    e.preventDefault();
    await addFinding(findingText);
    setFindingText('');
  }

  async function handleAddAttendee(e: React.FormEvent) {
    e.preventDefault();
    if (!debrief || !attendeeId) return;
    await run('attendee', async () => {
      await rpcOrThrow(supabase.rpc('add_debrief_attendee', {
        p_debrief_id: debrief.id,
        p_profile_id: attendeeId,
      }));
      setAttendeeId('');
      await reloadAttendees();
    });
  }

  async function handleAddLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!debrief || !lessonText.trim()) return;
    await run('lesson', async () => {
      await rpcOrThrow(supabase.rpc('add_debrief_lesson', {
        p_debrief_id: debrief.id,
        p_lesson_text: lessonText.trim(),
      }));
      setLessonText('');
      await reloadLessons();
    });
  }

  async function handleComplete() {
    if (!debrief) return;
    if (!window.confirm('Complete this debrief? It can’t be edited afterwards — start a new one if more comes up.')) return;
    await run('completeDebrief', async () => {
      await rpcOrThrow(supabase.rpc('complete_debrief', { p_debrief_id: debrief.id }));
      await reloadDebrief();
    }, 'Debrief completed and on the record.');
  }

  if (snagLoading || loading) return <p className="meta">Loading debrief…</p>;
  if (!snag || !debrief) {
    return (
      <div className="card">
        <p>This debrief could not be found, or you don't have access to it.</p>
        <Link to="/">← Back to all snags</Link>
      </div>
    );
  }

  const open = debrief.status === 'in_progress';
  const editable = open && canEdit;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <Link to={`/snags/${snag.id}/debriefs`} className="meta" style={{ textDecoration: 'none' }}>
        ← Debriefs for {snag.reference}
      </Link>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <h2>{DEBRIEF_FORMAT_LABELS[debrief.format]}</h2>
          <span
            className="pill"
            style={
              open
                ? { background: 'var(--color-warn-bg)', color: 'var(--color-warn)' }
                : { background: 'var(--color-success-bg)', color: 'var(--color-success)' }
            }
          >
            {open ? 'In progress' : `Completed ${formatDate(debrief.completed_at)}`}
          </span>
        </div>
        <p className="meta" style={{ margin: 0 }}>
          Started by {memberName(debrief.started_by)} · {formatDateTime(debrief.started_at)}
        </p>
        {error && <div className="error-banner">{error}</div>}
        {notice && <div className="success-banner">{notice}</div>}
      </div>

      {/* Findings */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <strong>Findings</strong>
        {findings.length === 0 ? (
          <p className="empty-state">
            No findings yet{editable ? ' — capture them below while they’re fresh.' : '.'}
          </p>
        ) : (
          findings.map((f) => (
            <div key={f.id} style={{ borderLeft: '3px solid var(--color-border)', paddingLeft: 12 }}>
              <p style={{ margin: 0 }}>{f.finding_text}</p>
              <span className="meta">{memberName(f.created_by)} · {formatDateTime(f.created_at)}</span>
            </div>
          ))
        )}
        {editable && debrief.format === 'hot' && (
          <form onSubmit={handleHotFindings} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {HOT_PROMPTS.map((prompt, i) => (
              <div key={prompt}>
                <label className="meta">{prompt}</label>
                <textarea
                  className="input"
                  rows={2}
                  value={hotFindings[i]}
                  onChange={(e) =>
                    setHotFindings((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
              </div>
            ))}
            <button
              className="btn-secondary"
              type="submit"
              disabled={busy || hotFindings.every((f) => !f.trim())}
            >
              Add findings
            </button>
          </form>
        )}
        {editable && debrief.format === 'formal' && (
          <form onSubmit={handleFormalFinding} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <textarea
              className="input"
              placeholder="What did we establish?"
              rows={2}
              value={findingText}
              onChange={(e) => setFindingText(e.target.value)}
            />
            <button className="btn-secondary" type="submit" disabled={busy || !findingText.trim()}>
              Add finding
            </button>
          </form>
        )}
      </div>

      {/* Attendees */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <strong>Attendees</strong>
        {attendees.length === 0 ? (
          <p className="empty-state">No attendees recorded yet{editable ? ' — add who was in the room.' : '.'}</p>
        ) : (
          <p style={{ margin: 0 }}>
            {attendees.map((a) => memberName(a.profile_id)).join(', ')}
          </p>
        )}
        {editable && (
          <form onSubmit={handleAddAttendee} style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <select
              className="input"
              style={{ flex: 1 }}
              value={attendeeId}
              onChange={(e) => setAttendeeId(e.target.value)}
            >
              <option value="">Add attendee…</option>
              {members
                .filter((m) => !attendees.some((a) => a.profile_id === m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.email}</option>
                ))}
            </select>
            <button className="btn-secondary" type="submit" disabled={busy || !attendeeId}>
              Add
            </button>
          </form>
        )}
      </div>

      {/* Lessons */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <strong>Lessons learned</strong>
        {lessons.length === 0 ? (
          <p className="empty-state">No lessons yet{editable ? ' — what should the whole team take from this?' : '.'}</p>
        ) : (
          lessons.map((l) => (
            <div key={l.id} style={{ borderLeft: '3px solid var(--color-border)', paddingLeft: 12 }}>
              <p style={{ margin: 0 }}>{l.lesson_text}</p>
              <span className="meta">{memberName(l.created_by)} · {formatDateTime(l.created_at)}</span>
            </div>
          ))
        )}
        {editable && (
          <form onSubmit={handleAddLesson} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <textarea
              className="input"
              placeholder="Lesson learned…"
              rows={2}
              value={lessonText}
              onChange={(e) => setLessonText(e.target.value)}
            />
            <button className="btn-secondary" type="submit" disabled={busy || !lessonText.trim()}>
              Add lesson
            </button>
          </form>
        )}
      </div>

      {editable && (
        <button className="btn-primary" onClick={handleComplete} disabled={busy}>
          Complete debrief
        </button>
      )}
    </div>
  );
}
