import Link from 'next/link';

export default function PricingPage() {
  return (
    <section className="container" style={{ padding: '64px 32px', maxWidth: 640 }}>
      <h1 style={{ marginBottom: 12 }}>Pricing</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 32 }}>
        SNAG is in early access. Every organisation that signs up today gets the full platform —
        unlimited reports, investigations, and the supervisor portal — at no cost while we're
        onboarding early customers.
      </p>
      <div className="card">
        <h3 style={{ margin: '0 0 8px' }}>Early access</h3>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 20 }}>
          Full platform access. We'll talk with you directly about pricing before anything changes
          for your organisation.
        </p>
        <Link href="/sign-up" className="btn-primary">Create your organisation</Link>
      </div>
    </section>
  );
}
