import { Card } from '@/components/Card';
import { LinkButton } from '@/components/Button';

export default function PricingPage() {
  return (
    <section className="container" style={{ padding: 'var(--space-5xl) 0', maxWidth: 640 }}>
      <h1 style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-md)' }}>Pricing</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2xl)', fontSize: 'var(--text-lg)' }}>
        SNAG is in early access. Every organisation that signs up today gets the full platform —
        unlimited reports, investigations, and the supervisor portal — at no cost while we&apos;re
        onboarding early customers.
      </p>
      <Card elevated>
        <h3 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-sm)' }}>Early access</h3>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xl)' }}>
          Full platform access. We&apos;ll talk with you directly about pricing before anything
          changes for your organisation.
        </p>
        <LinkButton href="/sign-up" variant="primary">Create your organisation</LinkButton>
      </Card>
    </section>
  );
}
