import { Card } from '@/components/Card';
import { LinkButton } from '@/components/Button';
import Icon from '@/components/Icon';
import styles from './page.module.css';

export default function PricingPage() {
  return (
    <section className="container" style={{ padding: 'var(--space-5xl) 0', maxWidth: 680 }}>
      <h1 style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-md)' }}>Pricing</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2xl)', fontSize: 'var(--text-lg)' }}>
        SNAG is in early access. Two things are settled already, even while the rest is still
        being worked out with early customers directly.
      </p>

      <div className={styles.pointGrid}>
        <div className={styles.point}>
          <Icon name="Building2" size="md" color="var(--color-primary)" />
          <div>
            <h3>Free for single-site teams</h3>
            <p>Unlimited reports, investigations, and the full supervisor portal — no cost while you&apos;re on one site.</p>
          </div>
        </div>
        <div className={styles.point}>
          <Icon name="Users" size="md" color="var(--color-primary)" />
          <div>
            <h3>Priced per organisation, not per seat</h3>
            <p>Invite your whole team — workers, supervisors, admins — without worrying about license count.</p>
          </div>
        </div>
      </div>

      <Card elevated>
        <h3 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-sm)' }}>Growing past one site?</h3>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xl)' }}>
          We&apos;ll work out straightforward per-organisation pricing with you directly before
          anything changes — no surprise bill, no per-seat math.
        </p>
        <LinkButton href="/sign-up" variant="primary">Create your organisation</LinkButton>
      </Card>
    </section>
  );
}
