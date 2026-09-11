import Link from 'next/link';
import styles from './page.module.css';

/**
 * The only thing at the root of this host.
 *
 * Everything else here retired with the B2B product; what's left is password
 * recovery, which has to be a plain web page rather than a screen in the app.
 * Someone landing here has almost certainly followed an old link, so the page's
 * whole job is to point at the app.
 */
export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Snag</h1>
      <p className={styles.body}>The list of things that need doing, around the house.</p>
      <a className={styles.action} href={process.env.NEXT_PUBLIC_SNAG_APP_URL ?? 'https://app.snaghq.co.nz'}>
        Open the app
      </a>
      <Link className={styles.link} href="/forgot-password">
        Forgotten your password?
      </Link>
    </main>
  );
}
