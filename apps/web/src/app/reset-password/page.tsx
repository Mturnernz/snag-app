import type { Metadata } from 'next';
import Link from 'next/link';
import ResetPasswordForm from './ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Set a new password',
  robots: { index: false, follow: false },
};

// The app has no reset screen of its own, so every recovery link lands here,
// whichever browser opens it. See ./ResetPasswordForm for why it reads the
// fragment.
export default function ResetPasswordPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="container" style={{ maxWidth: 400 }}>
        <Link href="/" style={{ fontWeight: 700, fontSize: 'var(--text-lg)', textDecoration: 'none', color: 'var(--color-text-primary)', display: 'block', marginBottom: 'var(--space-2xl)' }}>
          Snag
        </Link>
        <ResetPasswordForm />
      </div>
    </div>
  );
}
