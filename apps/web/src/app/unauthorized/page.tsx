import { LinkButton } from '@/components/Button';
import Icon from '@/components/Icon';

export default function UnauthorizedPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="container" style={{ maxWidth: 440, textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', width: 56, height: 56, borderRadius: '50%', background: 'var(--color-danger-bg)', color: 'var(--color-danger)', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-lg)' }}>
          <Icon name="ShieldAlert" size="lg" />
        </div>
        <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-md)' }}>This portal is for supervisors and admins</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2xl)' }}>
          Your account is signed in, but doesn&apos;t have supervisor or officer admin access in
          this organisation. Report and track issues from the SNAG mobile app instead.
        </p>
        <LinkButton href="/" variant="secondary">Back to snag.app</LinkButton>
      </div>
    </div>
  );
}
