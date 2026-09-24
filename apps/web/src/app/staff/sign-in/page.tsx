import { GoogleButton } from './GoogleButton';
import styles from '../staff.module.css';

/**
 * The portal's front door. Anybody can reach it; only somebody on the staff
 * list, signed in with their snaghq.co.nz Google account, gets past it.
 */
export default async function StaffSignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className={styles.signIn}>
      <h1 className={styles.signInTitle}>SnagHQ staff</h1>
      <p className={styles.muted}>
        Questions households have asked about their jobs. Sign in with your snaghq.co.nz Google
        account.
      </p>
      {error ? (
        <p className="error-text" role="alert">
          That sign-in didn&rsquo;t finish. Try again.
        </p>
      ) : null}
      <GoogleButton />
    </main>
  );
}
