import Link from 'next/link';
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
        <h1 style={{ marginBottom: 8 }}>Log in</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 32 }}>
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

          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 8 }}>
            Log in
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: 14, color: 'var(--color-text-secondary)' }}>
          No account yet? <Link href="/sign-up" style={{ color: 'var(--color-primary)' }}>Create an organisation</Link>
        </p>
      </div>
    </div>
  );
}
