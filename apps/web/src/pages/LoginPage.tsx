import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/errors';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(friendlyError('signIn', error));
      setLoading(false);
    } else {
      navigate(from, { replace: true });
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form
        onSubmit={handleSubmit}
        className="card"
        style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}
      >
        <h1 style={{ textAlign: 'center', color: 'var(--color-accent)' }}>Snag</h1>
        <p className="meta" style={{ margin: 0, textAlign: 'center' }}>
          Report in 30 seconds. Everyone knows. Sorted.
        </p>
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <input
          className="input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <div className="error-banner">{error}</div>}
        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="meta" style={{ margin: 0, textAlign: 'center' }}>
          Joining a team? Use the invite link you were emailed.
        </p>
      </form>
    </div>
  );
}
