import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './privacy.module.css';

export const metadata: Metadata = {
  title: 'Privacy — Snag',
  description: 'What Snag keeps about you and your household, why, and who else handles it.',
  robots: { index: true, follow: true },
};

/**
 * The privacy statement the app's *Create account* screen links to.
 *
 * It is here, on the plain web host, for the same reason password recovery is:
 * it has to open in whatever browser a link lands in, and it has to be
 * readable by somebody who does not have an account yet. The Privacy Act 2020
 * (principle 3) asks for this to be available when the details are collected,
 * which is sign-up.
 *
 * **Every service named below is a real dependency, and the list has to move
 * with the infrastructure.** Adding a processor — a new model provider, an
 * analytics script, a second email service — without adding it here makes this
 * page untrue. The list is the one in SNAG_INFRA_NOTES.md.
 */
export default function PrivacyPage() {
  return (
    <main className={styles.main}>
      <Link href="/" className={styles.brand}>
        Snag
      </Link>

      <h1 className={styles.title}>Privacy</h1>
      <p className={styles.updated}>Last updated 25 September 2026</p>

      <p>
        Snag is a shared list for looking after a house, run by SnagHQ in New Zealand. This page
        says what Snag keeps about you and your household, why, and who else handles it.
      </p>

      <h2>What Snag keeps</h2>
      <ul>
        <li>
          <strong>Your email address and password.</strong> The password is stored only as a
          one-way hash, so nobody at SnagHQ can read it.
        </li>
        <li>
          <strong>The name you give</strong>, which the people in your household see beside what
          you add.
        </li>
        <li>
          <strong>Your household and its places</strong> — their names, and a suburb and town if
          you add them.
        </li>
        <li>
          <strong>What your household records</strong>: jobs and their photos and notes, the house
          record, projects, bills, quotes and the paperwork attached to them.
        </li>
        <li>
          <strong>Questions you ask SnagHQ</strong> about a job, and the replies.
        </li>
      </ul>
      <p>
        On your device, the app keeps your sign-in and which sections of a list you have folded
        away. Snag has no advertising and no analytics trackers.
      </p>

      <h2>Why</h2>
      <p>
        To run Snag for your household: to sign you in, to show the people you share a place with
        what you have added, and to send the few emails Snag sends — a code to confirm your
        address, a link to reset your password, and a note when SnagHQ has replied to a question
        you asked. You don&apos;t have to give a name or a suburb, but without an email address and
        a password there is no account.
      </p>

      <h2>Who sees it</h2>
      <ul>
        <li>
          <strong>The people in your household</strong> see what is recorded for the places they
          are linked to.
        </li>
        <li>
          <strong>SnagHQ staff</strong> see a job only when you ask them about it — that job with
          its photos, notes and shopping list, and the name, suburb and town of its place — and
          only while the question is open, or for 14 days after their last reply. Nothing else in
          your house is shared with them, and their access is recorded.
        </li>
        <li>
          <strong>The services Snag runs on</strong>, which handle it on SnagHQ&apos;s behalf and for
          no other purpose:
          <ul>
            <li>Supabase stores the data and the files, and signs you in (Sydney, Australia).</li>
            <li>Netlify serves the app and this site.</li>
            <li>
              Resend sends Snag&apos;s emails, and receives bills you forward to a project&apos;s
              address.
            </li>
            <li>
              Google&apos;s Gemini reads a photo of a label when you photograph one while adding
              something to the house record, and reads bills emailed to a project, so the details
              can be filled in for you to check.
            </li>
          </ul>
        </li>
      </ul>
      <p>
        Some of these services store or process information outside New Zealand — in Australia,
        the United States and elsewhere.
      </p>

      <h2>How long</h2>
      <p>
        Until you delete it. <strong>Delete my account</strong>, on the You tab, removes your
        sign-in and your name. A household only you are in is deleted with its photos and files. In
        a household you share, what you added stays for the others, shown as added by
        &ldquo;Someone who left&rdquo;.
      </p>

      <h2>Seeing and correcting it</h2>
      <p>
        Nearly everything Snag keeps about you can be seen and changed in the app. You can also ask
        SnagHQ for a copy of it, or to correct it, at{' '}
        <a href="mailto:help@snaghq.co.nz">help@snaghq.co.nz</a>. If you are not happy with the
        answer, you can complain to the{' '}
        <a href="https://www.privacy.org.nz/" rel="noopener noreferrer">
          Office of the Privacy Commissioner
        </a>
        .
      </p>
    </main>
  );
}
