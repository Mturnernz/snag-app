import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="container" style={{ maxWidth: 440, textAlign: 'center' }}>
        <h1 style={{ marginBottom: 12 }}>This portal is for supervisors and admins</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 24 }}>
          Your account is signed in, but doesn't have supervisor or officer admin access in this
          organisation. Report and track issues from the SNAG mobile app instead.
        </p>
        <Link href="/" className="btn-secondary">Back to snag.app</Link>
      </div>
    </div>
  );
}
