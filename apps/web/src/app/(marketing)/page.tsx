import { LinkButton } from '@/components/Button';
import Icon from '@/components/Icon';
import styles from './page.module.css';

export default function LandingPage() {
  return (
    <>
      <section className="container">
        <div className={styles.hero}>
          <div className={styles.heroGrid}>
            <div>
              <p className={styles.eyebrow}>Workplace H&amp;S reporting</p>
              <h1 className={styles.headline}>
                Every workplace hazard,<br />tracked from photo to fix.
              </h1>
              <p className={styles.subhead}>
                Workers report niggles and hazards from their phone in seconds. Supervisors
                triage, investigate, and close the loop — with a guided root-cause process for
                anything serious enough to need one.
              </p>
              <div className={styles.ctaRow}>
                <LinkButton href="/sign-up" variant="primary">Start reporting</LinkButton>
                <LinkButton href="/login" variant="secondary">Log in to your org</LinkButton>
              </div>
            </div>

            <SnagCardMockup />
          </div>
        </div>
      </section>

      <section className="container">
        <div className={styles.features}>
          <div className={styles.featureGrid}>
            <Feature icon="HardHat" title="Two lanes, one system">
              Everyday niggles (broken gear, small fixes) move fast through triage and
              resolution. Hazards and incidents route into a guided investigation — make safe,
              preserve the scene, capture evidence, find the root cause — before they can be
              closed out.
            </Feature>
            <Feature icon="Microscope" title="Root cause, not just a ticket">
              Serious snags carry a structured 5-whys root-cause analysis and corrective actions
              through to independent verification — closure isn&apos;t a single tap.
            </Feature>
            <Feature icon="ShieldCheck" title="Reporting your officers can stand behind">
              Site-by-site breakdowns, governance exports, and a full audit trail on every snag —
              built for the person who has to answer for what happened, not just log it.
            </Feature>
          </div>
        </div>
      </section>
    </>
  );
}

function Feature({ icon, title, children }: { icon: React.ComponentProps<typeof Icon>['name']; title: string; children: React.ReactNode }) {
  return (
    <div className={styles.featureCard}>
      <div className={styles.featureIcon}><Icon name={icon} size="md" /></div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

// A stylised preview of the real snag-review card (see apps/web's own
// (portal)/snags/page.tsx) — the hero visual is drawn from the product's
// own UI rather than generic imagery, per the "ground decisions in the
// subject" principle.
function SnagCardMockup() {
  return (
    <div className={styles.mockup} aria-hidden="true">
      <div className={styles.mockupHeader}>
        <span className={styles.mockupRef}>SN-0142 · Loading Dock</span>
        <Icon name="TriangleAlert" size="sm" color="var(--color-category-broken-equipment)" />
      </div>
      <div className={styles.mockupBody}>
        <div className={styles.mockupPhoto}>
          <Icon name="Wrench" size="md" />
        </div>
        <div>
          <p className={styles.mockupTitle}>Pallet jack — front wheel jammed</p>
          <p className={styles.mockupDesc}>Reported by J. Ngata, 8 minutes ago</p>
        </div>
      </div>
      <div className={styles.stepper}>
        <div className={styles.step} data-done="true" />
        <div className={styles.step} data-current="true" />
        <div className={styles.step} />
      </div>
      <div className={styles.stepLabels}>
        <span>Flagged</span>
        <span>In progress</span>
        <span>Resolved</span>
      </div>
    </div>
  );
}
