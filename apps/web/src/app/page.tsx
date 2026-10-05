import type { Metadata } from 'next';
import Link from 'next/link';
import { canonical } from '@/lib/seo';
import styles from './page.module.css';

const APP_URL = process.env.NEXT_PUBLIC_SNAG_APP_URL ?? 'https://app.snaghq.co.nz';

export const metadata: Metadata = {
  title: 'Snag — the list of things that need doing around the house',
  description:
    'Photograph what needs doing and it goes on one list your household shares, grouped by room. ' +
    'The house record and a calendar sit beside it. No ads, no trackers, no notifications.',
  robots: { index: true, follow: true },
  ...canonical('/'),
  openGraph: {
    ...canonical('/').openGraph,
    title: 'Snag',
    description: 'The list of things that need doing around the house.',
    siteName: 'Snag',
    locale: 'en_NZ',
    type: 'website',
  },
};

/**
 * The front door: what Snag is, how to install it, and the links a person
 * looks for before signing up.
 *
 * **It says what the app does, in the app's own words, and nothing it does
 * not do.** Every line here is a rule in CLAUDE.md: capture asks after it
 * files, the list groups by room, suggestions are offers, nothing sends a
 * notification. A claim on this page the app cannot keep is the fastest way
 * to lose somebody on their first day. So is a feature list that reads
 * bigger than the product.
 *
 * **Install is a section, not a footnote.** Snag is installed from the
 * browser. There is no store listing, and "how do I get it on my phone" is
 * the first question anybody who meets it asks.
 *
 * Sessionless, like the rest of this host. Every call to action is a link to
 * the app, which does its own signing in.
 */
export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <span className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={32} height={32} className={styles.mark} />
          Snag
        </span>
        <a className={styles.signIn} href={APP_URL}>
          Sign in
        </a>
      </header>

      <main>
        <section className={styles.hero}>
          <h1 className={styles.title}>The list of things that need doing around the house.</h1>
          <p className={styles.lede}>
            Photograph the wobbly toilet seat, the filter that&apos;s due, the gutter over the back
            door. It goes on one list everybody in the house can see, grouped by room, until
            somebody gets to it.
          </p>
          <div className={styles.actions}>
            <a className={styles.primary} href={APP_URL}>
              Start your list
            </a>
            <a className={styles.secondary} href="#install">
              How to install it
            </a>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="what">
          <h2 id="what" className={styles.heading}>
            Four tabs, one house
          </h2>
          <ul className={styles.cards}>
            <li className={styles.card}>
              <h3>List</h3>
              <p>
                What needs doing, grouped by room. What the other person added since you last
                looked is at the top, what&apos;s due soon is under it, and there&apos;s one
                shopping list for the trip to the hardware store.
              </p>
            </li>
            <li className={styles.card}>
              <h3>House</h3>
              <p>
                What&apos;s in the house: the heat pump&apos;s model number, the paint on the
                hallway wall, the dishwasher&apos;s manual. A photo of the rating plate and the
                manual sit with each one, for the day you&apos;re in the shop.
              </p>
            </li>
            <li className={styles.card}>
              <h3>Schedule</h3>
              <p>
                Every date on one calendar: what&apos;s due, what comes round again, and what was
                done when.
              </p>
            </li>
            <li className={styles.card}>
              <h3>You</h3>
              <p>
                Who&apos;s in the house and which rooms it has, a link to bring someone in, and a
                copy of everything Snag keeps whenever you want one.
              </p>
            </li>
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="capture">
          <h2 id="capture" className={styles.heading}>
            Ten seconds, standing in front of it
          </h2>
          <p className={styles.body}>
            Tap the camera and take the photo, and it&apos;s on the list. Snag asks what&apos;s wrong
            and which room it&apos;s in afterwards, and you can walk away without answering. A line
            of text is a job too: &ldquo;gutters&rdquo; is enough.
          </p>
          <p className={styles.body}>
            Deciding what to buy, when it&apos;s due and whether it comes round again happens later,
            sitting down, on the job&apos;s own page.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="install">
          <h2 id="install" className={styles.heading}>
            Install it
          </h2>
          <p className={styles.body}>
            Snag installs from your phone&apos;s browser and updates itself. There&apos;s nothing to
            download from an app store.
          </p>
          <div className={styles.steps}>
            <div className={styles.step}>
              <h3>iPhone</h3>
              <ol>
                <li>
                  Open <a href={APP_URL}>app.snaghq.co.nz</a> in Safari.
                </li>
                <li>Tap the Share button.</li>
                <li>
                  Choose <strong>Add to Home Screen</strong>.
                </li>
              </ol>
            </div>
            <div className={styles.step}>
              <h3>Android</h3>
              <ol>
                <li>
                  Open <a href={APP_URL}>app.snaghq.co.nz</a> in Chrome.
                </li>
                <li>Tap the menu (the three dots).</li>
                <li>
                  Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                </li>
              </ol>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="quiet">
          <h2 id="quiet" className={styles.heading}>
            Quiet on purpose
          </h2>
          <ul className={styles.facts}>
            <li>
              <strong>No notifications.</strong>{' '}
              Nothing pings you. The list is where you look on a
              free Saturday, and what&apos;s due rises to the top of it on its own.
            </li>
            <li>
              <strong>No ads and no trackers.</strong>{' '}
              What your household records is seen by the
              people you invite, and nobody else.
            </li>
            <li>
              <strong>Suggestions are offers.</strong>{' '}
              The House tab suggests what a room probably has
              — an oven, a dryer — greyed out until you record the real one. Nothing is added
              until you add it.
            </li>
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="faq">
          <h2 id="faq" className={styles.heading}>
            Questions
          </h2>
          <div className={styles.faq}>
            <details>
              <summary>Who can see our list?</summary>
              <p>
                Only the people you invite to that home. You add them with a link or a QR code.
              </p>
            </details>
            <details>
              <summary>We have a bach as well. Can it have its own list?</summary>
              <p>
                Yes. Add it as another home. It is a household of its own, with its own rooms and
                its own people, and you switch between your homes from the top of the list.
              </p>
            </details>
            <details>
              <summary>Does it remind me when something is due?</summary>
              <p>
                It doesn&apos;t send reminders. Jobs that are due, or coming round again, sit under
                <em> Due soon</em> at the top of the list, so they&apos;re the first thing you see
                when you open it.
              </p>
            </details>
            <details>
              <summary>Can I take our data with me?</summary>
              <p>
                Yes. <strong>Download my data</strong>, on the You tab, gives you a copy of
                everything as one file. Lists export as a spreadsheet or a PDF too.
              </p>
            </details>
            <details>
              <summary>Where do I get help?</summary>
              <p>
                On any job, tap <strong>Ask SnagHQ about this</strong>, or email{' '}
                <a href="mailto:help@snaghq.co.nz">help@snaghq.co.nz</a>.
              </p>
            </details>
          </div>
        </section>

        <section className={styles.closing}>
          <a className={styles.primary} href={APP_URL}>
            Start your list
          </a>
        </section>
      </main>

      <footer className={styles.footer}>
        <nav aria-label="Site" className={styles.footerLinks}>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:help@snaghq.co.nz">help@snaghq.co.nz</a>
          <Link href="/forgot-password">Forgotten your password?</Link>
        </nav>
      </footer>
    </div>
  );
}
