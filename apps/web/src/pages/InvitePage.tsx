import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/errors';
import { ROLE_LABELS } from '../lib/labels';
import type { Database } from '../lib/database.types';

type Preview = Database['public']['Functions']['get_invite_preview']['Returns'][number];

// Invite acceptance: preview the invite by token, sign up (or in) with the
// invited email, then accept_invite creates the profile + site membership.
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    supabase.rpc('get_invite_preview', { p_token: token }).then(({ data }) => {
      const row = data?.[0] ?? null;
      if (!row) setNotFound(true);
      else setPreview(row);
    });
  }, [token]);

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !preview) return;
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (password.length < 6) {
      setError('Please choose a password of at least 6 characters.');
      return;
    }
    setWorking(true);
    setError(null);

    // Sign up with the invited email; if the account already exists, sign in.
    const { error: signUpError } = await supabase.auth.signUp({
      email: preview.email,
      password,
    });
    if (signUpError) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: preview.email,
        password,
      });
      if (signInError) {
        setError(friendlyError('invite', signInError));
        setWorking(false);
        return;
      }
    }

    const { error: acceptError } = await supabase.rpc('accept_invite', {
      p_token: token,
      p_name: name.trim(),
    });
    if (acceptError) {
      setError(friendlyError('acceptInvite', acceptError));
      setWorking(false);
      return;
    }
    navigate('/', { replace: true });
    // Full reload so useSession picks up the new profile.
    window.location.reload();
  }

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ width: 380 }}>
          <p>This invite link is invalid or has been used already. Ask whoever invited you to send a new one.</p>
        </div>
      </div>
    );
  }

  if (!preview) {
    return <p style={{ padding: 24 }} className="meta">Loading invite…</p>;
  }

  const expired = new Date(preview.expires_at) < new Date();
  const unusable = preview.status !== 'pending' || expired;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form
        onSubmit={handleAccept}
        className="card"
        style={{ width: 380, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}
      >
        <h1 style={{ textAlign: 'center', color: 'var(--color-accent)' }}>Snag</h1>
        <p style={{ margin: 0, textAlign: 'center' }}>
          Join <strong>{preview.org_name}</strong>
          {preview.site_name ? <> at <strong>{preview.site_name}</strong></> : null} as{' '}
          <strong>{ROLE_LABELS[preview.role]}</strong>
        </p>
        <p className="meta" style={{ margin: 0, textAlign: 'center' }}>{preview.email}</p>

        {unusable ? (
          <div className="error-banner">
            {expired
              ? 'This invite has expired. Ask whoever invited you to send a new one.'
              : 'This invite has already been used or was revoked.'}
          </div>
        ) : (
          <>
            <input
              className="input"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
            <input
              className="input"
              type="password"
              placeholder="Choose a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            {error && <div className="error-banner">{error}</div>}
            <button className="btn-primary" type="submit" disabled={working}>
              {working ? 'Joining…' : 'Join team'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
