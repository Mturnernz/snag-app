import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../privacy/privacy.module.css';

export const metadata: Metadata = {
  title: 'Terms — Snag',
  description: 'The terms you use Snag under.',
  robots: { index: true, follow: true },
};

/**
 * The terms of use.
 *
 * **In force from 30 September 2026.** They name SnagHQ as the provider and,
 * since 5 October 2026 and by the owner's decision, give its NZBN
 * (9429054008427); there is still no postal address, and the way to reach
 * SnagHQ is help@snaghq.co.nz, at the foot. The same NZBN is on /privacy.
 *
 * It lives beside /privacy for the same reason: it has to open in any browser
 * for somebody who has no account yet.
 *
 * **Every promise here has to be one the app keeps.** It says Snag sends no
 * notifications, that a suggestion is only ever an offer, and that a figure is
 * arithmetic on what you typed. Each is a rule in CLAUDE.md. A change to one
 * of those rules is a change to this page.
 */
export default function TermsPage() {
  return (
    <main className={styles.main}>
      <Link href="/" className={styles.brand}>
        Snag
      </Link>

      <h1 className={styles.title}>Terms</h1>
      <p className={styles.updated}>
        Last updated 5 October 2026
      </p>

      <p>
        Snag is a shared list for looking after a house. It is provided by SnagHQ, in New
        Zealand (NZBN 9429054008427). These terms are the agreement between you and SnagHQ when you use it. How Snag handles your information is in the{' '}
        <Link href="/privacy">privacy statement</Link>.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>An account is for one person. Keep your password to yourself.</li>
        <li>
          The people you share a household or a place with can see and change what is recorded
          there, and you can see and change what they record. That is what the app is for, so only
          invite people you want in.
        </li>
        <li>
          You can delete your account at any time, from the You tab. What happens to what you
          recorded is set out in the privacy statement.
        </li>
      </ul>

      <h2>What you put in Snag</h2>
      <ul>
        <li>
          It stays yours. You let SnagHQ store it, show it to the people you share it with, and
          handle it in the ways the privacy statement describes, so that Snag can work. That
          includes the services named there, which read a photographed label or an emailed bill.
        </li>
        <li>
          Only upload what you have the right to. Don&apos;t use Snag for anything unlawful, to
          harass anybody, or to hold somebody else&apos;s personal information without a reason
          they would expect.
        </li>
        <li>
          Don&apos;t try to reach data that isn&apos;t yours, get round the app&apos;s limits (such
          as the daily number of label and bill readings), or interfere with how it runs.
        </li>
      </ul>

      <h2>Suggestions are suggestions</h2>
      <p>
        Snag offers things for you to check: what a photographed label says, what a maker&apos;s
        website says about a model, what an emailed bill says, an assessment of a job, and answers
        from SnagHQ when you ask about one. None of it is saved until you accept it, and none of it
        is professional advice. Check it against the thing in front of you before you rely on it.
      </p>
      <p>
        A tradesperson Snag names is somebody listed on the page shown beside them. SnagHQ has not
        vetted them and does not recommend them. Some work in New Zealand has to be done by a
        licensed tradesperson, including most electrical, gas, plumbing and drainage work and
        anything needing a building consent. Snag does not change that.
      </p>

      <h2>Figures</h2>
      <p>
        Totals on the Projects tab are arithmetic on the prices, bills and payments you enter.
        They are a record to help you keep track, not accounting, tax or financial advice, and
        they are only as right as what was typed in.
      </p>

      <h2>What Snag does and doesn&apos;t do</h2>
      <ul>
        <li>
          Snag sends no reminders or notifications. The only emails it sends are to confirm your
          address, to reset your password, and to say SnagHQ has replied to a question you asked.
        </li>
        <li>
          SnagHQ works to keep Snag running and your data safe, but it is provided as it is. It may
          sometimes be unavailable, and features may change. Keep your own copy of anything you
          can&apos;t afford to lose. <strong>Download my data</strong> on the You tab makes one.
        </li>
        <li>
          SnagHQ may suspend or close an account that breaks these terms. Where it can, it will
          tell you first and give you the chance to take a copy of your data.
        </li>
      </ul>

      <h2>Responsibility</h2>
      <p>
        If you use Snag for your own household, nothing in these terms takes away your rights
        under the Consumer Guarantees Act 1993 or the Fair Trading Act 1986. Otherwise, and as far
        as the law allows, SnagHQ is not responsible for loss that comes from relying on a
        suggestion or figure without checking it, or from Snag being unavailable.
      </p>

      <h2>Changes, and the law</h2>
      <p>
        If these terms change, the new version will be on this page with its date, and a change
        that matters will be said in the app before it applies. These terms are governed by New
        Zealand law. Questions go to <a href="mailto:help@snaghq.co.nz">help@snaghq.co.nz</a>.
      </p>
    </main>
  );
}
