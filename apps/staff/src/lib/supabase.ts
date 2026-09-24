import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * The staff portal's Supabase client, on the server.
 *
 * **This site is its own origin, on purpose.** It used to be a path on
 * www.snaghq.co.nz, beside password recovery, with the cookie scoped to
 * `/staff` — but a cookie path is not a browser security boundary: any page on
 * the same origin can open a window at the portal and read what it holds. A
 * separate host is a boundary, so a staff session is reachable from nothing
 * but the portal's own pages.
 *
 * It also keeps the two Supabase clients apart. Recovery (apps/web) is
 * implicit-flow with no stored session, because a PKCE recovery link only works
 * in the browser that asked for it; this is PKCE with a session in a cookie,
 * because a Google sign-in starts and finishes in one browser.
 *
 * Bound to the `home` schema, like the app's own client. Every read and write
 * the portal makes goes through a `staff_*` function that checks the caller is
 * on the staff list; nothing here is trusted to do that checking.
 */
export const STAFF_COOKIE_OPTIONS = { sameSite: 'lax' as const };

export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
  }
  return { url, key };
}

export async function createStaffClient() {
  const store = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    db: { schema: 'home' },
    cookieOptions: STAFF_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // A server component cannot set cookies. The proxy refreshes the
          // session on every request, so there is nothing to do here.
        }
      },
    },
  });
}

export type StaffClient = Awaited<ReturnType<typeof createStaffClient>>;

/**
 * The bucket every household photograph is in. The id says "photos" and it
 * holds manuals too — see CLAUDE.md — but the portal only ever reads a job's
 * photographs, and only the ones `home.staff_can_read_file` allows.
 */
export const HOUSEHOLD_FILES_BUCKET = 'home-photos';

/** Short-lived: a portal page is read, not bookmarked. */
export async function signPhotos(
  client: StaffClient,
  paths: string[]
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await client.storage
    .from(HOUSEHOLD_FILES_BUCKET)
    .createSignedUrls(paths, 60 * 15);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const row of data) {
    if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  }
  return out;
}
