import { Button } from '@/components/Button';
import { signUpAction } from './actions';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <section className="container" style={{ padding: 'var(--space-5xl) 0', maxWidth: 440 }}>
      <h1 style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-sm)' }}>Create your organisation</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2xl)' }}>
        You&apos;ll be the first officer admin — you can invite supervisors and workers once you&apos;re in.
      </p>

      <form action={signUpAction}>
        <div className="field">
          <label htmlFor="orgName">Organisation name</label>
          <input id="orgName" name="orgName" type="text" required autoComplete="organization" />
        </div>
        <div className="field">
          <label htmlFor="ownerName">Your name</label>
          <input id="ownerName" name="ownerName" type="text" required autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="new-password" minLength={8} />
        </div>

        {error && <p className="error-text">{error}</p>}

        <Button type="submit" variant="primary" style={{ width: '100%', marginTop: 8 }}>
          Create organisation
        </Button>
      </form>
    </section>
  );
}
