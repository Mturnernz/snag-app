import { Link, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { ROLE_LABELS } from '../lib/labels';

export default function Layout() {
  const { profile } = useSession();
  const navigate = useNavigate();

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-md) var(--space-xl)',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <Link
          to="/"
          style={{
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 'var(--font-lg)',
            color: 'var(--color-text-primary)',
          }}
        >
          Snag
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          {profile && (
            <span className="meta">
              {profile.name || profile.email} · {ROLE_LABELS[profile.role]}
            </span>
          )}
          <button className="btn-secondary" onClick={handleSignOut}>Sign out</button>
        </div>
      </header>
      <main style={{ maxWidth: 820, margin: '0 auto', padding: 'var(--space-xl)' }}>
        <Outlet />
      </main>
    </div>
  );
}
