import type { Metadata } from 'next';
import Link from 'next/link';
import ResetPasswordForm from './ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Set a new password',
  robots: { index: false, follow: false },
};

// Deliberately outside the (portal) route group. requireSupervisorOrAdmin()
// would bounce a worker to /unauthorized, and workers are most of the people
// who need this — the app has no reset screen of its own to send them to.
export default function ResetPasswordPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="container" style={{ maxWidth: 400 }}>
        <Link href="/" style={{ fontWeight: 700, fontSize: 'var(--text-lg)', textDecoration: 'none', color: 'var(--color-text-primary)', display: 'block', marginBottom: 'var(--space-2xl)' }}>
          SNAG
        </Link>
        <ResetPasswordForm />
      </div>
    </div>
  );
}
