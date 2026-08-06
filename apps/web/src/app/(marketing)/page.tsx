import type { Metadata } from 'next';
import Link from 'next/link';
import { CHECKLIST_STEP_LABELS, type ChecklistStep } from '@snag/shared-types';
import { LinkButton } from '@/components/Button';
import Icon from '@/components/Icon';
import { canonical } from '@/lib/seo';
import styles from './page.module.css';

const WORKSAFE_NOTIFIABLE_EVENTS_URL = 'https://www.worksafe.govt.nz/notifications/what-events-need-to-be-notified/';

// The one page in this app that has to be findable. Target intent:
// "workplace health and safety software New Zealand" / "hazard reporting app
// NZ". The leaf title carries the exact phrase and the root layout's template
// appends "| SnagHQ" — so this string must not carry the suffix itself.
export const metadata: Metadata = {
  title: 'Workplace Health & Safety Software',
  description:
    'Report hazards and workplace niggles in seconds. SNAG streamlines triage, investigates with police-level rigor, and gives every issue an owner before it becomes an expensive fix.',
  ...canonical('/'),
};

// Both the hero card and the serious-lane card below render first-response
// steps, one screen apart. They read their wording from CHECKLIST_STEP_LABELS
// rather than retyping it: two hand-typed paraphrases of the same statutory
// checklist on one marketing page is the sort of drift a reader notices and a
// test never will. The hero shows a subset (it's a narrow card); the lane card
// shows all five, because "2 steps remaining" only means something if the
// reader can count the list it refers to.
type StepState = { step: ChecklistStep; done: boolean };

const HERO_CHECKLIST: StepState[] = [
  { step: 'make_safe', done: true },
  { step: 'capture_evidence', done: true },
  { step: 'identify_witnesses', done: false },
  { step: 'find_root_cause', done: false },
];

const SERIOUS_LANE_CHECKLIST: StepState[] = [
  { step: 'make_safe', done: true },
  { step: 'preserve_scene', done: true },
  { step: 'capture_evidence', done: true },
  { step: 'identify_witnesses', done: false },
  { step: 'find_root_cause', done: false },
];

const remainingIn = (steps: StepState[]) => steps.filter((s) => !s.done).length;

export default function LandingPage() {
  return (
    <>
      <section className="container">
        <div className={styles.hero}>
          <div className={styles.heroGrid}>
            <div>
              <p className={styles.eyebrow}>Workplace H&amp;S Reporting &amp; Investigation</p>
              <h1 className={styles.headline}>
                Stop passing the buck.<br />From &ldquo;someone should fix that&rdquo; to fixed.
              </h1>
              <p className={styles.subhead}>
                Your employees see the small stuff first &mdash; like a loose hinge or a worn
                cable. SNAG makes reporting take seconds, assigns clear ownership, and prevents
                minor niggles from turning into costly, reactive incidents.
              </p>
              <div className={styles.ctaRow}>
                <LinkButton href="/sign-up" variant="primary">
                  Start reporting free <Icon name="ArrowRight" size="sm" />
                </LinkButton>
                <LinkButton href="/login" variant="secondary">
                  Log in to your org <Icon name="ArrowRight" size="sm" />
                </LinkButton>
              </div>
              <p className={styles.builtFor}>Built for everyone.</p>
            </div>

            <SeriousSnagMockup />
          </div>
        </div>
      </section>

      <section className="container">
        <TwoLanes />
      </section>

      <section className="container">
        <WhySnag />
      </section>

      <section className="container">
        <HowItWorks />
      </section>

      <section className="container">
        <div className={styles.features}>
          <div className={styles.featureGrid}>
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
        <Principles />
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

function ChecklistRows({ steps, className }: { steps: StepState[]; className: string }) {
  return (
    <ul className={className}>
      {steps.map(({ step, done }) => (
        <li key={step} data-done={done}>
          <Icon name={done ? 'CircleCheck' : 'Circle'} size="sm" />
          {CHECKLIST_STEP_LABELS[step]}
        </li>
      ))}
    </ul>
  );
}

// A stylised preview of the real snag-review UI, drawn from the product's
// own gate rather than generic imagery — and deliberately the serious lane,
// not a niggle, since the point is to show in two seconds that a serious
// incident can't be fake-closed. Uses the same serious-lane colour identity
// (--color-serious) the app itself reserves exclusively for the hazard/
// incident lane, echoing the two-lane split before anyone signs up.
function SeriousSnagMockup() {
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

      <ChecklistRows steps={HERO_CHECKLIST} className={styles.checklist} />

      <div className={styles.gateBanner}>
        <Icon name="Lock" size="sm" />
        <span>&ldquo;Resolved&rdquo; — blocked. {remainingIn(HERO_CHECKLIST)} steps remaining.</span>
      </div>
    </div>
  );
}

// The page's central claim, and the reason the two cards are deliberately
// uneven: the niggle card is short because closing a niggle is short, and the
// serious card carries the whole gate because that is what closing one costs.
// Making them the same height would flatten the only thing the section says.
function TwoLanes() {
  return (
    <div className={styles.lanes}>
      <div className={styles.lanesHead}>
        <p className={styles.sectionEyebrow}>Two lanes, one system</p>
        <h2 className={styles.lanesHeadline}>Same app. Two completely different speeds.</h2>
        <p className={styles.lanesIntro}>
          Minor stuff shouldn&rsquo;t need an investigation. Serious stuff shouldn&rsquo;t be
          closeable without one.
        </p>
      </div>

      <div className={styles.laneGrid}>
        <article className={styles.laneCard} data-lane="niggle">
          <div className={styles.laneEdge} />
          <div className={styles.laneInner}>
            <div className={styles.laneLabelRow}>
              {/* Icon + word, not just the lane colour — the design system
                  requires colour never be the only signal. */}
              <span className={styles.laneLabel}>
                <Icon name="Wrench" size="sm" />
                Everyday niggle
              </span>
              <span className={styles.laneRef}>SN-0143 · Crib room</span>
            </div>
            <div>
              <h3 className={styles.laneTitle}>Loose hinge, crib room door</h3>
              <p className={styles.laneMeta}>Reported 9:14am → fixed by 10:02am</p>
            </div>
            <div className={styles.laneResolved}>
              <Icon name="CircleCheck" size="sm" />
              <span>Closed with a note</span>
            </div>
            <div className={styles.laneDivider} />
            <p className={styles.laneBody}>
              Fast-lane fixes for minor stuff. Photo and a brief note — auto-routed, resolved in
              minutes, without clogging your safety register.
            </p>
          </div>
        </article>

        <article className={styles.laneCard} data-lane="serious">
          <div className={styles.laneEdge} />
          <div className={styles.laneInner}>
            <div className={styles.laneLabelRow}>
              <span className={styles.laneLabel}>
                <Icon name="TriangleAlert" size="sm" />
                Serious incident
              </span>
              <span className={styles.laneRef}>SN-0204 · Site 4</span>
            </div>
            <div>
              <h3 className={styles.laneTitle}>Excavation edge unguarded</h3>
              <p className={styles.laneMeta}>Flagged by a subcontractor → escalated to site lead</p>
            </div>

            <ChecklistRows steps={SERIOUS_LANE_CHECKLIST} className={styles.laneChecklist} />

            <div className={styles.laneGate}>
              <Icon name="Lock" size="sm" />
              <span>Resolve blocked — {remainingIn(SERIOUS_LANE_CHECKLIST)} steps remaining.</span>
            </div>
            <div className={styles.laneDivider} />
            <p className={styles.laneBody}>
              Police-level investigation rigor. Make safe, preserve scene, evidence, witnesses,
              root cause — locked down before closure.
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}

function WhySnag() {
  return (
    <div className={styles.whySnag}>
      <p className={styles.sectionEyebrow}>Why Snag</p>
      <h2 className={styles.whySnagHeadline}>The &ldquo;someone&rdquo; finally gets a name.</h2>
      <div className={styles.whySnagGrid}>
        <div className={styles.whySnagProse}>
          <p>
            Snag started with a loose door hinge in a kitchen — small, obvious, and stuck behind
            bureaucratic hoops to report. So it sat there. Weeks later, it wasn&rsquo;t a hinge
            anymore.
          </p>
          <p>
            When reporting takes too long, people just walk past. Small things become big,
            expensive, reactive fixes.
          </p>
        </div>
        <blockquote className={styles.pullQuote}>
          Snag gives the &ldquo;someone&rdquo; in &ldquo;someone should fix that&rdquo; an actual
          name.
        </blockquote>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps: { icon: React.ComponentProps<typeof Icon>['name']; title: string; body: string }[] = [
    { icon: 'QrCode', title: 'Report in seconds', body: 'Photo, brief note, 30 seconds. QR code access for subbies and visitors, no login required.' },
    { icon: 'Route', title: 'Assign ownership', body: 'Auto-routed to the right manager or site lead. The "someone" gets a name.' },
    { icon: 'GitFork', title: 'Investigate with rigor', body: 'Niggles close fast with a note. Serious hazards run on police-level investigative principles — 5 whys, evidence, witness accounts.' },
    { icon: 'FileCheck', title: 'Close the loop', body: 'Full audit trail, five-year retention, aligned with HSWA 2015 — using your existing SOPs if you already have them.' },
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
          Under the Health and Safety at Work Act 2015 (HSWA), notifiable events must be reported
          to WorkSafe as soon as possible. Failing to notify is an offence — fines of up to
          $10,000 for an individual and $50,000 for a body corporate.
        </p>
        <p className={styles.whySupport}>
          SNAG helps you triage notifiable events instantly, preserve critical evidence, and
          document your response step by step.
        </p>
        <p className={styles.whyDisclaimer}>
          General guidance, not legal advice — confirm with your qualified health and safety
          adviser.{' '}
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

// Ticks rather than numbers, and reusing the trust list's own markup: these
// are three commitments held at once, not a sequence, and numbering them would
// claim an order that doesn't exist.
function Principles() {
  const points = [
    'Any issue matters. If it catches your eye, it gets reported — big or small.',
    'Reporting must be effortless. Friction kills reporting cultures.',
    'Employee wellbeing comes first. A reliable, easy-to-use system is your baseline obligation.',
  ];

  return (
    <div className={styles.principles}>
      <p className={styles.sectionEyebrow}>Principles</p>
      <h2 className={styles.principlesHeadline}>What we hold to, and why.</h2>
      <ul className={styles.trustList}>
        {points.map((point) => (
          <li key={point}>
            <Icon name="Check" size="sm" color="var(--color-success)" />
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
