import Link from 'next/link';

export default function LandingPage() {
  return (
    <>
      <section className="container" style={{ padding: '80px 32px 64px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 48, lineHeight: 1.1, margin: '0 0 20px', letterSpacing: '-0.02em' }}>
          Every workplace hazard,
          <br />
          tracked from photo to fix.
        </h1>
        <p style={{ fontSize: 19, color: 'var(--color-text-secondary)', maxWidth: 620, margin: '0 auto 32px' }}>
          Workers report niggles and hazards from their phone in seconds. Supervisors triage,
          investigate, and close the loop — with a guided root-cause process for anything serious
          enough to need one.
        </p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <Link href="/sign-up" className="btn-primary">Start reporting</Link>
          <Link href="/login" className="btn-secondary">Log in to your org</Link>
        </div>
      </section>

      <section className="container" style={{ padding: '32px 32px 96px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
          <div className="card">
            <h3 style={{ margin: '0 0 8px' }}>Two lanes, one system</h3>
            <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
              Everyday niggles (broken gear, small fixes) move fast through triage and resolution.
              Hazards and incidents route into a guided investigation — make safe, preserve the
              scene, capture evidence, find the root cause — before they can be closed out.
            </p>
          </div>
          <div className="card">
            <h3 style={{ margin: '0 0 8px' }}>Root cause, not just a ticket</h3>
            <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
              Serious snags carry a structured 5-whys root-cause analysis and corrective actions
              through to independent verification — closure isn't a single tap.
            </p>
          </div>
          <div className="card">
            <h3 style={{ margin: '0 0 8px' }}>Reporting your officers can stand behind</h3>
            <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
              Site-by-site breakdowns, governance exports, and a full audit trail on every snag —
              built for the person who has to answer for what happened, not just log it.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
