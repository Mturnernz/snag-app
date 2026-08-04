'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/Button';
import { createRecoveryClient } from '@/lib/supabase/recovery';

const APP_URL = process.env.NEXT_PUBLIC_SNAG_APP_URL ?? 'https://app.snaghq.co.nz';
const MIN_LENGTH = 8;

type Stage = 'checking' | 'ready' | 'noLink' | 'done';

/**
 * A client component because the recovery tokens arrive in the URL *fragment*,
 * which browsers never send to the server — a server component would see a bare
 * `/reset-password` and conclude the link was invalid.
 *
 * It uses `createRecoveryClient`, not the `@supabase/ssr` browser client. That
 * one is hardcoded to `flowType: 'pkce'` and auth-js throws on the mismatch
 * with an implicit-flow fragment, leaving `getSession()` null and this page
 * announcing that a link the server had just verified had expired. The full
 * mechanism is in `@/lib/supabase/recovery`.
 *
 * The instance is held in a ref because that client keeps its session in
 * memory only — `handleSubmit` has to update through the *same* client that
 * read the fragment, not a fresh one.
 */
export default function ResetPasswordForm() {
  const [stage, setStage] = useState<Stage>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const clientRef = useRef<SupabaseClient | null>(null);

  useEffect(() => {
    const supabase = createRecoveryClient();
    clientRef.current = supabase;

    // Synchronous callback only. Awaiting a Supabase call inside
    // onAuthStateChange deadlocks the client for the life of the page — see
    // the note in CLAUDE.md and src/lib/authEvents.ts on the mobile side.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setStage('ready');
    });

    // The fragment may already have been consumed before the listener attached,
    // so ask outright rather than waiting for an event that has been and gone.
    supabase.auth.getSession().then(({ data }) => {
      setStage((prev) => (prev === 'ready' ? prev : data.session ? 'ready' : 'noLink'));
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two don't match.");
      return;
    }

    // The same instance the effect built — see the note above on why a fresh
    // one would carry no session.
    const supabase = clientRef.current;
    if (!supabase) {
      setError('That link is no longer active. Ask for a new one.');
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setStage('done');
  }

  if (stage === 'checking') {
    return <p style={{ color: 'var(--color-text-secondary)' }}>Checking your link…</p>;
  }

  if (stage === 'noLink') {
    return (
      <>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-sm)' }}>This link has expired</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2xl)' }}>
          Reset links can only be used once, and they don&apos;t last long. Ask for a new one and it
          will work the same way.
        </p>
        <Link href="/forgot-password" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
          Send another link
        </Link>
      </>
    );
  }

  if (stage === 'done') {
    return (
      <>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-sm)' }}>Password updated</h1>
        {/* Both destinations, because this page cannot know which one the
            person came from — and a worker sent to the portal would only be
            bounced to /unauthorized. */}
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2xl)' }}>
          Use it wherever you work: the supervisor portal, or the SNAG app.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <Link href="/dashboard"><Button variant="primary">Open the portal</Button></Link>
          <a href={APP_URL}><Button variant="secondary">Open the app</Button></a>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-sm)' }}>Set a new password</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2xl)' }}>
        This changes the password for the portal and the SNAG app together.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm">Type it again</label>
          <input
            id="confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        {error && <p className="error-text">{error}</p>}

        <Button type="submit" variant="primary" disabled={saving} style={{ width: '100%', marginTop: 8 }}>
          {saving ? 'Saving…' : 'Save the new password'}
        </Button>
      </form>
    </>
  );
}
