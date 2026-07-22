import Icon from '@/components/Icon';

export default function CheckEmailPage() {
  return (
    <section className="container" style={{ padding: 'var(--space-5xl) 0', maxWidth: 440, textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', width: 56, height: 56, borderRadius: '50%', background: 'var(--color-primary-light)', color: 'var(--color-primary)', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-lg)' }}>
        <Icon name="Mail" size="lg" />
      </div>
      <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-md)' }}>Check your email</h1>
      <p style={{ color: 'var(--color-text-secondary)' }}>
        We&apos;ve sent you a confirmation link. Once you confirm and log in, your organisation
        will be set up automatically — no extra steps.
      </p>
    </section>
  );
}
