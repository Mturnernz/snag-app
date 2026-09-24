import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isStaff } from '@snag/supabase-queries';
import { createStaffClient } from '@/lib/supabase/staff';
import { Button } from '@/components/Button';
import { signOut } from './actions';
import styles from '../staff.module.css';

// Every portal page is per-person and read fresh. Nothing here may be cached.
export const dynamic = 'force-dynamic';

/**
 * The gate. Signed in is not enough: the account has to be on `home.staff`,
 * and signed in with Google. Somebody who is not gets a sentence saying so and
 * a way out — never a queue that happens to be empty, which would read as
 * "nobody has asked anything" rather than "you can't see this".
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createStaffClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/staff/sign-in');

  const staff = await isStaff(supabase).catch(() => false);

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/staff" className={styles.brand}>
          SnagHQ staff
        </Link>
        <span className={styles.spacer} />
        <span className={styles.me}>{user.email}</span>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      {staff ? (
        children
      ) : (
        <main className={styles.page}>
          <h1 className={styles.h1}>This account isn&rsquo;t on the SnagHQ staff list</h1>
          <p className={styles.muted}>
            The portal is for SnagHQ employees signed in with their snaghq.co.nz Google account. If
            you work here, ask for your account to be added.
          </p>
        </main>
      )}
    </div>
  );
}
