import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as queries from '@snag/supabase-queries';
import { PORTAL_URL } from './appUrl';
import { readForUpload } from './uploadBody';
import { withDeadline } from './deadline';
import type { SnagStatus } from '../types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env and fill in your credentials.'
  );
}

/**
 * Every request gets a deadline, because supabase-js gives none of them one.
 *
 * Phone connections don't fail cleanly — a request goes out and is simply never
 * answered. Without a timeout that `fetch` stays pending for the life of the
 * page, and one particular case poisons the whole client: supabase-js resolves
 * an access token before *every* request, and if the token needs refreshing it
 * awaits `/auth/v1/token`. A stalled refresh means `getSession()` never settles,
 * so no later call is ever issued at all.
 *
 * That failure is invisible from every angle. Nothing reaches the server, so
 * there's nothing in the logs; nothing rejects, so no error is shown; the app
 * carries on rendering the data it already had. All the user sees is a button
 * that spins forever — which is exactly how it was found.
 *
 * The deadlines differ by what's on the other end. Auth and data calls are
 * small and quick. Uploads are not: an evidence photo on a bad site connection
 * is slow rather than broken, and cutting it off at 20s would invent a failure
 * where there wasn't one.
 */
const AUTH_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const ms = url.includes('/auth/v1/') ? AUTH_TIMEOUT_MS
    : url.includes('/storage/v1/') ? UPLOAD_TIMEOUT_MS
    : REQUEST_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  // Don't drop a caller's own cancellation on the floor.
  if (init?.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  // Snag Home lives in its own schema, beside the frozen `public` one that
  // holds the retired B2B product. Without this every table read goes to
  // `public` and finds a schema that knows nothing about households.
  //
  // `home` must also be listed under Settings → API → Exposed schemas in the
  // Supabase dashboard. It isn't in any migration, so nothing in this repo can
  // check it: if it's missing, every call 404s and the app looks like it has
  // no data rather than no permission.
  db: { schema: 'home' },
  global: { fetch: fetchWithTimeout },
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
    // Disable Web Locks API on web — prevents "Lock broken by another request
    // with the 'steal' option" AbortErrors on page load/reload. Note this also
    // discards the acquire timeout, so the deadline above is the only thing
    // bounding a stalled auth call.
    ...(Platform.OS === 'web' && {
      lock: <R,>(_name: string, _acquireTimeout: number, fn: () => Promise<R>) => fn(),
    }),
  },
});

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

/**
 * Sends the recovery email, pointing at the portal's /reset-password.
 *
 * The app has no screen of its own for this on purpose. The link has to survive
 * being opened in whatever mail client the person uses — which on a phone means
 * an in-app browser, not this app — so the landing page has to be a plain web
 * page. The portal's is deliberately outside its (portal) group, so a worker
 * can complete a reset there even though the portal proper refuses them.
 *
 * This client is on auth-js's default implicit flow, so the link carries its
 * tokens in the URL fragment and works in any browser. Don't set
 * `flowType: 'pkce'` on this client without moving the reset landing page:
 * a PKCE link needs the code verifier stored by whichever client asked for it,
 * and that is never the browser the mail was opened in.
 */
export async function sendPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${PORTAL_URL}/reset-password`,
  });
}

/** Changes the password of the signed-in user. */
export async function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}

export async function signUpWithEmail(email: string, password: string) {
  return supabase.auth.signUp({ email, password });
}

/** The stored-session key supabase-js derives from the project ref. */
const AUTH_STORAGE_KEY = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

// Shorter than the 15s on the auth request itself, deliberately. A logout that
// hasn't come back is not worth waiting on: `scope: 'local'` only revokes this
// device's refresh token, and dropping the stored session achieves the same
// thing for the person holding the phone. Getting them out beats revoking
// tidily.
const SIGN_OUT_TIMEOUT_MS = 10_000;

/**
 * Signs out, and gets the user out even when signing out is what's broken.
 *
 * Sign out is the escape hatch from a session that isn't working, so it must not
 * depend on the session working. `supabase.auth.signOut()` takes the auth lock,
 * and a wedged lock means it never settles and never even reaches the network —
 * which is what a permanently spinning Sign Out button was (see
 * lib/authEvents.ts for how the lock got wedged). Waiting on it forever leaves
 * someone trapped in an app they can't use and can't leave.
 *
 * So: bound it, and if it doesn't come back, drop the stored session directly
 * and reload. That bypasses supabase-js entirely, because supabase-js is the
 * part that may be stuck.
 *
 * Local scope, not the supabase-js default of 'global'. Global revokes every
 * refresh token the user has, so signing out on this phone also signed them out
 * of the supervisor portal in their browser. Signing out of a device means this
 * device.
 */
export async function signOut(): Promise<{ error: any; forced?: boolean }> {
  try {
    const { error } = await withDeadline(
      supabase.auth.signOut({ scope: 'local' }), SIGN_OUT_TIMEOUT_MS, 'Signing out',
    );
    if (!error) return { error: null };
    console.error('signOut error:', error);
  } catch (err) {
    console.error('signOut error:', err);
  }

  // The client couldn't do it. Do it without the client.
  try {
    if (Platform.OS === 'web') {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      // A wedged client never emits SIGNED_OUT, so nothing would re-render and
      // the app would sit there still showing a signed-in screen. Reloading is
      // the only thing that reliably completes it.
      window.location.reload();
    } else {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    }
    return { error: null, forced: true };
  } catch (err) {
    return { error: err };
  }
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ─── Household ────────────────────────────────────────────────────────────────
//
// Every domain function is a thin binding of the shared query package to this
// client, so `apps/web` can call the same code with its own. Nothing below
// should contain logic — if it needs any, it belongs in
// packages/supabase-queries where both clients get it.

export const getMyProfile = () => queries.getMyProfile(supabase);

export const upsertProfile = (displayName: string) =>
  queries.upsertProfile(supabase, displayName);

export const getMyHousehold = () => queries.getMyHousehold(supabase);

export const createHousehold = (name: string, propertyName?: string) =>
  queries.createHousehold(supabase, name, propertyName);

export const getMembers = (householdId: string) => queries.getMembers(supabase, householdId);

export const addMemberByEmail = (householdId: string, email: string, propertyIds?: string[]) =>
  queries.addMemberByEmail(supabase, householdId, email, propertyIds);

export const getMyProperties = () => queries.getMyProperties(supabase);

export const getDefaultPropertyId = (properties: Parameters<typeof queries.getDefaultPropertyId>[1]) =>
  queries.getDefaultPropertyId(supabase, properties);

export const createProperty = (householdId: string, name: string) =>
  queries.createProperty(supabase, householdId, name);

export const renameProperty = (propertyId: string, name: string) =>
  queries.renameProperty(supabase, propertyId, name);

export const getPropertyMemberIds = (propertyId: string) =>
  queries.getPropertyMemberIds(supabase, propertyId);

export const setPropertyMember = (propertyId: string, profileId: string, linked: boolean) =>
  queries.setPropertyMember(supabase, propertyId, profileId, linked);

// ─── Snags ────────────────────────────────────────────────────────────────────

export const getSnags = (
  filter?: Parameters<typeof queries.getSnags>[1],
  sort?: Parameters<typeof queries.getSnags>[2],
) => queries.getSnags(supabase, filter, sort);

export const getSnag = (snagId: string) => queries.getSnag(supabase, snagId);

export const createSnag = (input: Parameters<typeof queries.createSnag>[1]) =>
  queries.createSnag(supabase, input);

export const updateSnag = (snagId: string, update: queries.SnagUpdate) =>
  queries.updateSnag(supabase, snagId, update);

export const setSnagStatus = (snagId: string, status: SnagStatus) =>
  queries.setSnagStatus(supabase, snagId, status);

export const deleteSnag = (snagId: string) => queries.deleteSnag(supabase, snagId);

export const getComments = (snagId: string) => queries.getComments(supabase, snagId);

export const addComment = (snagId: string, body: string) =>
  queries.addComment(supabase, snagId, body);

export const markListSeen = () => queries.markListSeen(supabase);

export const getLocations = (propertyId: string) => queries.getLocations(supabase, propertyId);

export const createLocation = (propertyId: string, name: string) =>
  queries.createLocation(supabase, propertyId, name);

export const deleteLocation = (locationId: string) => queries.deleteLocation(supabase, locationId);

// ─── The house record ─────────────────────────────────────────────────────────

export const getThings = (propertyId: string) => queries.getThings(supabase, propertyId);

export const getThing = (thingId: string) => queries.getThing(supabase, thingId);

export const createThing = (input: queries.ThingInput) => queries.createThing(supabase, input);

export const updateThing = (thingId: string, update: queries.ThingUpdate) =>
  queries.updateThing(supabase, thingId, update);

export const deleteThing = (thingId: string) => queries.deleteThing(supabase, thingId);

// ─── Photos ───────────────────────────────────────────────────────────────────
//
// home-photos is a PRIVATE bucket laid out as `<household_id>/<file>` — the
// storage policies read that first path segment, so the prefix is not
// cosmetic. Store the path, never a URL, and resolve a short-lived signed URL
// whenever a photo is displayed.

const PHOTOS_BUCKET = 'home-photos';

/**
 * Returns `{ path, error }` rather than throwing or swallowing, because
 * PhotoPicker has to tell "no photo" apart from "upload failed" — the second
 * needs showing and retrying rather than being silently dropped.
 */
export async function uploadSnagPhoto(
  localUri: string,
  fileName: string,
  bucket: string = PHOTOS_BUCKET,
): Promise<{ path: string | null; error: any }> {
  try {
    // Reading the picked file is platform-specific — and a wrong read fails
    // before any request is made, which looks like an upload failure with
    // nothing in the Storage logs. See readForUpload.
    const body = await readForUpload(localUri, 'image/jpeg');

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, body, { contentType: 'image/jpeg', upsert: false });

    if (error || !data) {
      console.error('Photo upload error:', error);
      return { path: null, error: error ?? new Error('Upload failed') };
    }
    return { path: data.path, error: null };
  } catch (err) {
    console.error('Photo upload error:', err);
    return { path: null, error: err };
  }
}

export async function getSnagPhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error) console.error('getSnagPhotoUrl error:', path, error);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Batched sibling of getSnagPhotoUrl for list views — one request for every
 * visible card's cover photo instead of one signed-URL call per card, which was
 * cheap to trip up: a slow or rate-limited response for any single card left it
 * on the "No photo" placeholder forever.
 *
 * This matters more here than it did in the workplace app. A household list is
 * mostly photos — twelve thumbnails is a Saturday you can act on, twelve lines
 * of text is a list you skim and close.
 */
export async function getSnagPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrls(unique, 60 * 60);
  if (error) console.error('getSnagPhotoUrls error:', error);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.signedUrl && !row.error) map[row.path ?? ''] = row.signedUrl;
  }
  return map;
}
