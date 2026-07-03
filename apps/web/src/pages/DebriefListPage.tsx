import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, type Enums } from '../lib/supabase';
import { friendlyError } from '../lib/errors';
import { DEBRIEF_FORMAT_LABELS, formatDate, formatDateTime } from '../lib/labels';
import { useSnag } from '../hooks/useSnag';
import { useDebriefs } from '../hooks/useDebriefs';
import { useMembers } from '../hooks/useMembers';

export default function DebriefListPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { snag, loading: snagLoading, canEdit } = useSnag(id);
  const { debriefs, loading } = useDebriefs(id);
  const { memberName } = useMembers();

  const [format, setFormat] = useState<Enums<'debrief_format'>>('hot');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!snag) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('start_debrief', {
      p_snag_id: snag.id,
      p_format: format,
    });
    setBusy(false);
    if (rpcError) {
      setError(friendlyError('startDebrief', rpcError));
    } else if (data) {
      navigate(`/snags/${snag.id}/debriefs/${data}`);
    }
  }

  if (snagLoading || loading) return <p className="meta">Loading debriefs…</p>;
  if (!snag) {
    return (
      <div className="card">
        <p>This snag could not be found, or you don't have access to its site.</p>
        <Link to="/">← Back to all snags</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <Link to={`/snags/${snag.id}`} className="meta" style={{ textDecoration: 'none' }}>
        ← {snag.reference}{snag.description ? ` — ${snag.description.slice(0, 80)}` : ''}
      </Link>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        <h2>Debriefs</h2>
        <p className="meta" style={{ margin: 0 }}>
          A hot debrief happens straight after the event; a formal debrief is the
          structured session once the dust settles. Run as many as you need.
        </p>
        {error && <div className="error-banner">{error}</div>}
        {canEdit && (
          <form onSubmit={handleStart} style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <select
              className="input"
              style={{ flex: 1 }}
              value={format}
              onChange={(e) => setFormat(e.target.value as Enums<'debrief_format'>)}
            >
              <option value="hot">Hot debrief — right after the event</option>
              <option value="formal">Formal debrief — structured session</option>
            </select>
            <button className="btn-primary" type="submit" disabled={busy}>
              Start debrief
            </button>
          </form>
        )}
      </div>

      {debriefs.length === 0 ? (
        <div className="card">
          <p className="empty-state">
            No debriefs yet{canEdit ? ' — start the first one above.' : '.'}
          </p>
        </div>
      ) : (
        debriefs.map((d) => (
          <Link
            key={d.id}
            to={`/snags/${snag.id}/debriefs/${d.id}`}
            className="card"
            style={{ textDecoration: 'none', color: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span>
              <strong>{DEBRIEF_FORMAT_LABELS[d.format]}</strong>
              <span className="meta" style={{ marginLeft: 8 }}>
                started by {memberName(d.started_by)} · {formatDateTime(d.started_at)}
              </span>
            </span>
            <span
              className="pill"
              style={
                d.status === 'completed'
                  ? { background: 'var(--color-success-bg)', color: 'var(--color-success)' }
                  : { background: 'var(--color-warn-bg)', color: 'var(--color-warn)' }
              }
            >
              {d.status === 'completed' ? `Completed ${formatDate(d.completed_at)}` : 'In progress'}
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
