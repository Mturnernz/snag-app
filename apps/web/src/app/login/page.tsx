import Link from 'next/link';
import { Button } from '@/components/Button';
import { loginAction } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

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
