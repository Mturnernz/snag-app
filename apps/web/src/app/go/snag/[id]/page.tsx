import { notFound, redirect } from 'next/navigation';
import { SNAG_STEP_KEYS, type SnagStepKey } from '@snag/shared-types';
import { getPortalAccess } from '@/lib/auth';
import { LinkButton } from '@/components/Button';
import Icon from '@/components/Icon';
import styles from './page.module.css';

// The one link every notification points at.
//
// SNAG has two clients for two jobs: the app is where work is reported and
// done, the portal is where it's managed. A notification doesn't know which of
// those its reader needs — `serious_created` goes to every member of a site in
// a single email, and RCAs are usually assigned to workers, who the portal
// refuses outright. Picking a destination per *event* can't get that right.
//
// So the mails point here instead, and the decision happens per visitor:
// a supervisor is sent straight through to the portal, and everyone else is
// offered the app. One URL, correct for whoever opens it, and it stays correct
// when someone's role changes or the mail gets forwarded.
//
// Deliberately outside the (portal) route group — that layout's
// requireSupervisorOrAdmin() would bounce the very people this page exists to
// help, before it could offer them anything.

export const dynamic = 'force-dynamic';

const APP_URL = process.env.NEXT_PUBLIC_SNAG_APP_URL ?? 'https://snagv1.netlify.app';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stepSuffix(step: string | undefined): string {
  return step && SNAG_STEP_KEYS.includes(step as SnagStepKey) ? `?step=${step}` : '';
}

export default async function GoToSnagPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const { step } = await searchParams;

  // Shape-checked, not existence-checked. This page is public, so looking the
  // snag up would answer "does this id exist" for anyone who asks — and it
  // deliberately shows no snag detail for the same reason.
  if (!UUID.test(id)) notFound();

  const suffix = stepSuffix(step);
  const portalPath = `/snags/${id}${suffix}`;
  const { signedIn, canUsePortal } = await getPortalAccess();

  // A supervisor never sees this page. They asked for a snag; give them the
  // snag.
  if (canUsePortal) redirect(portalPath);

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <span className={styles.mark}>SNAG</span>
        <h1 className={styles.title}>Open this snag</h1>
        <p className={styles.lead}>
          {signedIn
            ? 'Your account reports and works on snags in the SNAG app.'
            : 'Pick where you want to open it.'}
        </p>

        <div className={styles.actions}>
          {/* The app leads for everyone who reaches this page: by the time it
              renders, the visitor is either signed out or not a supervisor. */}
          <LinkButton href={`${APP_URL}/snags/${id}${suffix}`} variant="primary" className={styles.appAction}>
            Open in the SNAG app
          </LinkButton>

          {/* The custom scheme only resolves if the app is installed, so it is
              offered as a secondary option rather than attempted automatically
              — an auto-attempt that silently fails is worse than a link that
              visibly does nothing. */}
          <a className={styles.scheme} href={`snag://snags/${id}${suffix}`}>
            <Icon name="Smartphone" size="sm" />
            Already have the app installed? Open it directly
          </a>
        </div>

        {signedIn ? (
          <p className={styles.note}>
            <Icon name="Info" size="sm" />
            {/* One span, not loose fragments: .note is a flex row, so bare text
                nodes each become their own flex item and the sentence stops
                being a sentence. */}
            <span>
              The supervisor portal is for supervisors and officer admins. Your account
              doesn&apos;t have that access in this organisation.
            </span>
          </p>
        ) : (
          <p className={styles.note}>
            <Icon name="Monitor" size="sm" />
            <span>
              Supervisor?{' '}
              <a
                className={styles.link}
                href={`/login?next=${encodeURIComponent(portalPath)}`}
              >
                Log in to the portal
              </a>{' '}
              to manage it on a desktop.
            </span>
          </p>
        )}
      </div>
    </main>
  );
}
