import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type Snag } from '../lib/supabase';
import { KindPill, SeverityPill, StatusPill, NotifiablePill } from '../components/Pills';
import { formatDateTime } from '../lib/labels';
import { useMembers } from '../hooks/useMembers';

type LaneFilter = 'all' | 'serious' | 'niggle' | 'open';

export default function SnagListPage() {
  const [snags, setSnags] = useState<Snag[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<LaneFilter>('open');
  const { memberName } = useMembers();

  useEffect(() => {
    supabase
      .from('snags')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setSnags(data ?? []);
        setLoading(false);
      });
  }, []);

  const filtered = snags.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'serious') return s.lane === 'serious';
    if (filter === 'niggle') return s.lane === 'niggle';
    return s.status !== 'sorted'; // open
  });

  const FILTERS: { key: LaneFilter; label: string }[] = [
    { key: 'open', label: 'Open' },
    { key: 'serious', label: 'Serious' },
    { key: 'niggle', label: 'Niggles' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className="btn-secondary"
            style={
              filter === f.key
                ? { background: 'var(--color-accent-light)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }
                : undefined
            }
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="meta">Loading snags…</p>
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="empty-state">
            {filter === 'open'
              ? 'Nothing open right now — when someone reports a snag it will appear here.'
              : 'No snags match this filter.'}
          </p>
        </div>
      ) : (
        filtered.map((snag) => (
          <Link
            key={snag.id}
            to={`/snags/${snag.id}`}
            className="card"
            style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
              <strong>{snag.reference}</strong>
              <KindPill kind={snag.kind} />
              {snag.severity && <SeverityPill severity={snag.severity} />}
              {snag.is_notifiable && <NotifiablePill />}
              <span style={{ marginLeft: 'auto' }}><StatusPill status={snag.status} /></span>
            </div>
            {snag.description && (
              <div style={{ fontSize: 'var(--font-base)', color: 'var(--color-text-secondary)' }}>
                {snag.description.length > 140 ? snag.description.slice(0, 140) + '…' : snag.description}
              </div>
            )}
            <div className="meta">
              Reported by {memberName(snag.reporter_id)} · {formatDateTime(snag.created_at)}
              {snag.owner_id ? <> · held by {memberName(snag.owner_id)}</> : null}
              {snag.escalated_at ? ' · flagged for attention' : null}
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
