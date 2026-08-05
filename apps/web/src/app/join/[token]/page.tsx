import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/Button';
import Icon from '@/components/Icon';
import { acceptInviteAction, signUpAndAcceptAction } from './actions';
import styles from './page.module.css';

// The link every invite email points at.
//
// Invites were never emailed at all until 20260805090000 — invite_user wrote a
// row and stopped, and the code it minted was visible nowhere, so an invite was
// a dead end by construction. This is the other half of that fix: the page the
// mail sends people to.
//
// It is NOT /go/snag/[id] with a different noun. That page routes by the
// visitor's role, which it can read because they already have one. An invitee
// has no account and no membership — their role is a property of the invite,
// not of them — so the routing decision can't happen until after they've
// accepted. That's why this page accepts first and hands off second.
//
// Deliberately outside the (portal) group. Most invitees are workers, and
// requireSupervisorOrAdmin() would bounce the very people it exists for, same
// as /reset-password.

export const dynamic = 'force-dynamic';

// Never indexed, and never followed: one URL per invite, reached only from an
// inbox, and the token in the path is the credential.
export const metadata: Metadata = {
  title: 'Join your team on SNAG',
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface InvitePreview {
  org_name: string;
  site_name: string | null;
  role: string;
  email: string;
  status: string;
  expires_at: string;
}

const ROLE_LABELS: Record<string, string> = {
  worker: 'Crew',
  supervisor: 'Site Lead',
  officer_admin: 'Manager',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <span className={styles.mark}>SNAG</span>
        {children}
      </div>
    </main>
  );
}

function DeadEnd({ title, message }: { title: string; message: string }) {
  return (
    <Shell>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.lead}>{message}</p>
      <p className={styles.note}>
        <Icon name="Info" size="sm" />
        <span>
          Ask whoever invited you to send a new one — they can do that from Manage Organisation.
        </span>
      </p>
    </Shell>
  );
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  // Shape-checked before it's used as an RPC argument — a malformed uuid is a
  // 400 from PostgREST, which would render as "something went wrong" for what
  // is really a mistyped link.
  if (!UUID.test(token)) notFound();

  const supabase = await createClient();

  // get_invite_preview is one of the three deliberately anon-callable RPCs
  // (see 20260803120200) — it has to be, because the whole point of this page
  // is that its reader has no account yet. It returns only what the holder of
  // the token already knows.
  const { data } = await supabase.rpc('get_invite_preview', { p_token: token }).single();
  const invite = data as InvitePreview | null;

  if (!invite) {
    return (
      <DeadEnd
        title="This invite isn't valid"
        message="The link may have been mistyped, or the invite was cancelled."
      />
    );
  }
  if (invite.status === 'accepted') {
    return (
      <DeadEnd
        title="This invite has already been used"
        message={`Someone has already joined ${invite.org_name} with this link. If that was you, just log in.`}
      />
    );
  }
  if (invite.status !== 'pending') {
    return (
      <DeadEnd
        title="This invite was cancelled"
        message={`It's no longer valid for ${invite.org_name}.`}
      />
    );
  }
  if (new Date(invite.expires_at) < new Date()) {
    return (
      <DeadEnd
        title="This invite has expired"
        message={`Invites to ${invite.org_name} are valid for two weeks, and this one has run out.`}
      />
    );
  }

  const { data: { user } } = await supabase.auth.getUser();
  const roleLabel = ROLE_LABELS[invite.role] ?? invite.role;
  const at = invite.site_name ? ` at ${invite.site_name}` : '';

  // Signed in as somebody else. accept_invite would refuse this, so say why
  // here rather than letting them press a button that can only fail.
  if (user && user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell>
        <h1 className={styles.title}>This invite is for someone else</h1>
        <p className={styles.lead}>
          It was sent to <strong>{invite.email}</strong>, but you&apos;re signed in as{' '}
          <strong>{user.email}</strong>.
        </p>
        <div className={styles.actions}>
          <a className={styles.secondaryAction} href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}>
            Log in as {invite.email}
          </a>
        </div>
        <p className={styles.note}>
          <Icon name="Info" size="sm" />
          <span>
            If {invite.email} is also you, ask for the invite to be re-sent to the address you
            actually use.
          </span>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className={styles.title}>Join {invite.org_name}</h1>
      <p className={styles.lead}>
        You&apos;ve been invited to {invite.org_name}
        {at} as <strong>{roleLabel}</strong>.
      </p>

      <div className={styles.inviteFor}>
        <Icon name="Mail" size="sm" />
        <span>{invite.email}</span>
      </div>

      {error && <p className="error-text">{error}</p>}

      {user ? (
        // Signed in with the invited address. Nothing left to ask but their name.
        <form action={acceptInviteAction} className={styles.form}>
          <input type="hidden" name="token" value={token} />
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" name="name" type="text" required autoComplete="name" />
          </div>
          <Button type="submit" variant="primary" style={{ width: '100%' }}>
            Accept invite
          </Button>
        </form>
      ) : (
        <>
          <form action={signUpAndAcceptAction} className={styles.form}>
            <input type="hidden" name="token" value={token} />
            {/* The address is fixed by the invite. accept_invite checks
                auth.email() against it, so an editable field could only
                produce an account it then refuses. */}
            <input type="hidden" name="email" value={invite.email} />
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input id="name" name="name" type="text" required autoComplete="name" />
            </div>
            <div className="field">
              <label htmlFor="password">Choose a password</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            <Button type="submit" variant="primary" style={{ width: '100%' }}>
              Create account and join
            </Button>
          </form>

          <p className={styles.note}>
            <Icon name="Info" size="sm" />
            <span>
              Already have a SNAG account?{' '}
              <a className={styles.link} href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}>
                Log in
              </a>{' '}
              and this invite will be waiting.
            </span>
          </p>
        </>
      )}
    </Shell>
  );
}
