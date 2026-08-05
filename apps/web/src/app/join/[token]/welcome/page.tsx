import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LinkButton } from '@/components/Button';
import Icon from '@/components/Icon';
import { APP_URL } from '../destination';
import styles from '../page.module.css';

// Where a worker lands the moment their invite is accepted.
//
// The portal has nothing for them — (portal) refuses workers outright — so
// redirecting to /dashboard would put them on /unauthorized seconds after
// joining, which reads as "you've been rejected" rather than "you're in". This
// says the true thing instead: you've joined, here's where the work happens.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "You're in",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JoinWelcomePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!UUID.test(token)) notFound();

  const supabase = await createClient();

  // Read back through the same preview the join page used. By now the invite is
  // `accepted`, which is exactly why this reads it rather than gating on it —
  // all it wants is the organisation's name to say out loud.
  const { data } = await supabase.rpc('get_invite_preview', { p_token: token }).single();
  const orgName = (data as { org_name?: string } | null)?.org_name;

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <span className={styles.mark}>SNAG</span>
        <h1 className={styles.title}>You&apos;re in{orgName ? `, at ${orgName}` : ''}</h1>
        <p className={styles.lead}>
          Your account is set up. SNAG lives on your phone — that&apos;s where you report problems
          and see what&apos;s happening on your site.
        </p>

        <div className={styles.actions}>
          <LinkButton href={APP_URL} variant="primary" style={{ width: '100%' }}>
            Open the SNAG app
          </LinkButton>
          <a className={styles.scheme} href="snag://">
            <Icon name="Smartphone" size="sm" />
            Already have the app installed? Open it directly
          </a>
        </div>

        <p className={styles.note}>
          <Icon name="Info" size="sm" />
          <span>
            Add it to your home screen when it opens — SNAG installs from the browser rather than
            an app store.
          </span>
        </p>
      </div>
    </main>
  );
}
