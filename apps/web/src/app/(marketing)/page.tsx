import Link from 'next/link';
import { LinkButton } from '@/components/Button';
import Icon from '@/components/Icon';
import styles from './page.module.css';

const WORKSAFE_NOTIFIABLE_EVENTS_URL = 'https://www.worksafe.govt.nz/notifications/what-events-need-to-be-notified/';

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
              <p className={styles.builtFor}>
                Built for construction, trades, manufacturing, logistics, and other field-based teams.
              </p>
            </div>

            <SeriousSnagMockup />
          </div>
        </div>
      </section>

      <section className="container">
        <HowItWorks />
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
              Every action is logged. Records can&apos;t be deleted. Five-year retention, enforced
              at the database level — not by policy someone has to remember.
            </Feature>
          </div>
        </div>
      </section>

      <section className="container">
        <WhyItMatters />
      </section>

      <section className="container">
        <TrustSection />
      </section>

      <section className="container">
        <PricingTeaser />
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

// A stylised preview of the real snag-review UI, drawn from the product's
// own gate rather than generic imagery — and deliberately the serious lane,
// not a niggle, since the point is to show in two seconds that a serious
// incident can't be fake-closed. Uses the same serious-lane colour identity
// (--color-serious) the app itself reserves exclusively for the hazard/
// incident lane, echoing the two-lane split before anyone signs up.
function SeriousSnagMockup() {
  const checklist = [
    { label: 'Area made safe', done: true },
    { label: 'Evidence captured', done: true },
    { label: 'Witness statement', done: false },
    { label: 'Root cause recorded', done: false },
  ];
  const remaining = checklist.filter((c) => !c.done).length;

  return (
    <div className={styles.mockup} aria-hidden="true">
      <div className={styles.mockupHeader}>
        <span className={styles.mockupRef}>SN-0187 · Loading Dock B</span>
        <span className={styles.mockupSeriousTag}>
          <Icon name="TriangleAlert" size="sm" />
          Serious incident
        </span>
      </div>
      <div className={styles.mockupBody}>
        <div className={styles.mockupPhotoSerious}>
          <Icon name="TriangleAlert" size="md" />
        </div>
        <div>
          <p className={styles.mockupTitle}>Forklift near-miss</p>
          <p className={styles.mockupDesc}>Reversed into pedestrian walkway</p>
        </div>
      </div>

      <ul className={styles.checklist}>
        {checklist.map((item) => (
          <li key={item.label} data-done={item.done}>
            <Icon name={item.done ? 'CircleCheck' : 'Circle'} size="sm" />
            {item.label}
          </li>
        ))}
      </ul>

      <div className={styles.gateBanner}>
        <Icon name="Lock" size="sm" />
        <span>&ldquo;Resolved&rdquo; — blocked. {remaining} steps remaining.</span>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps: { icon: React.ComponentProps<typeof Icon>['name']; title: string; body: string }[] = [
    { icon: 'QrCode', title: 'Report', body: 'Photo, description, 30 seconds. No login needed for one-off reporters — scan the site QR code.' },
    { icon: 'Route', title: 'Triage', body: 'Auto-routed to the right person or work group.' },
    { icon: 'GitFork', title: 'Niggle → resolved. Serious → gated.', body: 'A niggle closes with a note. A serious incident needs checklist, witness, evidence, and root cause first.' },
    { icon: 'FileCheck', title: 'Closed, with a record that holds up', body: 'Full audit trail, exportable file.' },
  ];

  return (
    <div className={styles.howItWorks}>
      <p className={styles.sectionEyebrow}>How it works</p>
      <div className={styles.stepsGrid}>
        {steps.map((step, i) => (
          <div key={step.title} className={styles.stepCard}>
            <div className={styles.stepTop}>
              <span className={styles.stepNumber}>{i + 1}</span>
              <Icon name={step.icon} size="md" color="var(--color-primary)" />
            </div>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WhyItMatters() {
  return (
    <div className={styles.whyCard}>
      <div className={styles.whyIcon}><Icon name="Scale" size="lg" /></div>
      <div>
        <p className={styles.whyStat}>
          Under the Health and Safety at Work Act 2015, a notifiable event must be reported to
          WorkSafe — and failing to notify is itself an offence, with fines of up to $50,000 for
          a business and $10,000 for an individual.
        </p>
        <p className={styles.whyDisclaimer}>
          General guidance, not legal advice — confirm with your own adviser.{' '}
          <a href={WORKSAFE_NOTIFIABLE_EVENTS_URL} target="_blank" rel="noreferrer">Source: WorkSafe NZ</a>.
        </p>
        <Link href="/sign-up" className={styles.whyCta}>
          This is exactly the kind of record Snag builds automatically <Icon name="ArrowRight" size="sm" />
        </Link>
      </div>
    </div>
  );
}

function TrustSection() {
  const points = [
    'Row-level security scopes every query to the org and site.',
    'Every write runs through a permission-checked server function — never a raw edit.',
    "Every meaningful action writes to an append-only audit log. Once created, a record can't be deleted.",
  ];

  return (
    <div className={styles.trust}>
      <p className={styles.sectionEyebrow}>Trust &amp; record-keeping</p>
      <h2 className={styles.trustHeadline}>Built to survive scrutiny, not just look tidy.</h2>
      <ul className={styles.trustList}>
        {points.map((point) => (
          <li key={point}>
            <Icon name="ShieldCheck" size="sm" color="var(--color-success)" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PricingTeaser() {
  return (
    <div className={styles.pricingTeaser}>
      <div>
        <h2 className={styles.pricingHeadline}>Free for single-site teams.</h2>
        <p className={styles.pricingBody}>
          Straightforward per-organisation pricing as you grow — invite your whole team at no
          extra cost. Full pricing on the <Link href="/pricing">Pricing page</Link>.
        </p>
      </div>
      <LinkButton href="/pricing" variant="secondary">See pricing</LinkButton>
    </div>
  );
}
