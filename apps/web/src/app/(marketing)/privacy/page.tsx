import type { Metadata } from 'next';
import { canonical } from '@/lib/seo';

// Indexable on purpose: procurement and H&S officers look for these two pages
// before they look at the product.
export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    "How SnagHQ handles your organisation's data. Full policy in progress — get in touch and we'll answer directly in the meantime.",
  ...canonical('/privacy'),
};

export default function PrivacyPage() {
  return (
    <section className="container" style={{ padding: 'var(--space-5xl) 0', maxWidth: 640 }}>
      <h1 style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-md)' }}>Privacy Policy</h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-lg)' }}>
        Our full privacy policy is in progress. In the meantime, if you have questions about how
        SNAG handles your data, get in touch and we&apos;ll answer directly.
      </p>
    </section>
  );
}
