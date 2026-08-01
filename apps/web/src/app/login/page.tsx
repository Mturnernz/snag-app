import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { safeNextPath } from '@/lib/nextPath';
import { loginAction } from './actions';

// An entry point to the product, not a landing page. Left indexable it
// competes with `/` for branded searches and lands people on a password field
// instead of an explanation.
export const metadata: Metadata = {
  title: 'Log in',
  robots: { index: false, follow: true },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  // Validated here as well as in the action: this value is echoed into the
  // page, so an unchecked one would be reflected content as well as a
  // redirect target.
  const returnTo = safeNextPath(next);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="container" style={{ maxWidth: 400 }}>
        <Link href="/" style={{ fontWeight: 700, fontSize: 'var(--text-lg)', textDecoration: 'none', color: 'var(--color-text-primary)', display: 'block', marginBottom: 'var(--space-2xl)' }}>
          SNAG
        </Link>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-sm)' }}>Log in</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2xl)' }}>
          Same account as the SNAG mobile app.
        </p>

        <form action={loginAction}>
          {returnTo && <input type="hidden" name="next" value={returnTo} />}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" autoFocus />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>

          {error && <p className="error-text">{error}</p>}

          <Button type="submit" variant="primary" style={{ width: '100%', marginTop: 8 }}>
            Log in
          </Button>
        </form>

        <p style={{ marginTop: 'var(--space-2xl)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          No account yet? <Link href="/sign-up" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Create an organisation</Link>
        </p>
      </div>
    </div>
  );
}
