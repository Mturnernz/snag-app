import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { requestPasswordResetAction } from './actions';

export const metadata: Metadata = {
  title: 'Reset your password',
  robots: { index: false, follow: true },
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="container" style={{ maxWidth: 400 }}>
        <Link href="/" style={{ fontWeight: 700, fontSize: 'var(--text-lg)', textDecoration: 'none', color: 'var(--color-text-primary)', display: 'block', marginBottom: 'var(--space-2xl)' }}>
          SNAG
        </Link>

        {sent ? (
          <>
            <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-sm)' }}>Check your email</h1>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2xl)' }}>
              If that address has a SNAG account, a link to set a new password is on its way. It
              works in any browser, so opening it on your phone is fine.
            </p>
            <Link href="/login" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
              Back to log in
            </Link>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-sm)' }}>Reset your password</h1>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2xl)' }}>
              The same account covers the portal and the SNAG app — resetting here changes both.
            </p>

            <form action={requestPasswordResetAction}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" required autoComplete="email" autoFocus />
              </div>

              {error && <p className="error-text">{error}</p>}

              <Button type="submit" variant="primary" style={{ width: '100%', marginTop: 8 }}>
                Send the link
              </Button>
            </form>

            <p style={{ marginTop: 'var(--space-2xl)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              Remembered it? <Link href="/login" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Log in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
