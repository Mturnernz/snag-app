import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as queries from '@snag/supabase-queries';
import type { ProjectQuoteStatus } from '@snag/shared-types';
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

export const setProjectsEnabled = (enabled: boolean) =>
  queries.setProjectsEnabled(supabase, enabled);

export const getMyHousehold = () => queries.getMyHousehold(supabase);

export const createHousehold = (name: string, propertyName?: string) =>
  queries.createHousehold(supabase, name, propertyName);

export const getMembers = (householdId: string) => queries.getMembers(supabase, householdId);

export const inviteToHousehold = (householdId: string, email: string, propertyIds?: string[]) =>
  queries.inviteToHousehold(supabase, householdId, email, propertyIds);

export const getHouseholdInvitations = (householdId: string) =>
  queries.getHouseholdInvitations(supabase, householdId);

export const cancelInvitation = (invitationId: string) =>
  queries.cancelInvitation(supabase, invitationId);

export const createInviteLink = (householdId: string, propertyIds?: string[], hours?: number) =>
  queries.createInviteLink(supabase, householdId, propertyIds, hours);

export const revokeInviteLink = (householdId: string) =>
  queries.revokeInviteLink(supabase, householdId);

export const getInvitationByToken = (token: string) =>
  queries.getInvitationByToken(supabase, token);

export const acceptInvitationByToken = (token: string) =>
  queries.acceptInvitationByToken(supabase, token);

export const getMyInvitations = () => queries.getMyInvitations(supabase);

export const acceptInvitation = (invitationId: string) =>
  queries.acceptInvitation(supabase, invitationId);

export const declineInvitation = (invitationId: string) =>
  queries.declineInvitation(supabase, invitationId);

export const getMyOrphanFilePaths = () => queries.getMyOrphanFilePaths(supabase);

export const deleteMyAccount = () => queries.deleteMyAccount(supabase);

export const getMyProperties = () => queries.getMyProperties(supabase);

export const getDefaultPropertyId = (properties: Parameters<typeof queries.getDefaultPropertyId>[1]) =>
  queries.getDefaultPropertyId(supabase, properties);

export const createProperty = (householdId: string, name: string) =>
  queries.createProperty(supabase, householdId, name);

export const setPropertyLocation = (propertyId: string, suburb: string, town: string) =>
  queries.setPropertyLocation(supabase, propertyId, suburb, town);

export const renameProperty = (propertyId: string, name: string) =>
  queries.renameProperty(supabase, propertyId, name);

export const getPropertyMemberIds = (propertyId: string) =>
  queries.getPropertyMemberIds(supabase, propertyId);

export const setPropertyMember = (propertyId: string, profileId: string, linked: boolean) =>
  queries.setPropertyMember(supabase, propertyId, profileId, linked);

export const countMyHouseholds = () => queries.countMyHouseholds(supabase);

export const removeMember = (householdId: string, profileId: string) =>
  queries.removeMember(supabase, householdId, profileId);

export const deleteProperty = (propertyId: string) => queries.deleteProperty(supabase, propertyId);

export const getHouseholdFilePaths = (householdId: string) =>
  queries.getHouseholdFilePaths(supabase, householdId);

export const deleteHousehold = (householdId: string) =>
  queries.deleteHousehold(supabase, householdId);

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

export const setPartBought = (snagId: string, item: string, bought: boolean) =>
  queries.setPartBought(supabase, snagId, item, bought);

export const setSnagStatus = (snagId: string, status: SnagStatus) =>
  queries.setSnagStatus(supabase, snagId, status);

export const deleteSnag = (snagId: string) => queries.deleteSnag(supabase, snagId);

export const getSnagAdvice = (snagId: string) => queries.getSnagAdvice(supabase, snagId);

export const recordSnagAdvice = (
  snagId: string,
  advice: Parameters<typeof queries.recordSnagAdvice>[2],
  source: string,
) => queries.recordSnagAdvice(supabase, snagId, advice, source);

export const deleteSnagAdvice = (snagId: string) => queries.deleteSnagAdvice(supabase, snagId);

export const getComments = (snagId: string) => queries.getComments(supabase, snagId);

export const getThingNotes = (thingId: string, exceptSnagId: string) =>
  queries.getThingNotes(supabase, thingId, exceptSnagId);

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

export const getAbsentThings = (propertyId: string) => queries.getAbsentThings(supabase, propertyId);

// ------------------------------------------------------------------ projects
//
// What we're *changing*, beside what's wrong and what's there. Every one of
// these is the query package's function bound to this app's client; the logic
// lives there so `apps/web` could read the same rows.

export const getProjects = (propertyId: string) => queries.getProjects(supabase, propertyId);

export const getAllProjects = () => queries.getAllProjects(supabase);

export const getProject = (projectId: string) => queries.getProject(supabase, projectId);

export const getProjectContents = (projectId: string) =>
  queries.getProjectContents(supabase, projectId);

export const getProjectFiles = (projectId: string) =>
  queries.getProjectFiles(supabase, projectId);

export const createProject = (input: queries.ProjectInput) =>
  queries.createProject(supabase, input);

export const updateProject = (projectId: string, update: queries.ProjectUpdate) =>
  queries.updateProject(supabase, projectId, update);

export const deleteProject = (projectId: string) => queries.deleteProject(supabase, projectId);

export const createElement = (projectId: string, name: string, room?: string | null) =>
  queries.createElement(supabase, projectId, name, room);

export const updateElement = (elementId: string, update: queries.ElementUpdate) =>
  queries.updateElement(supabase, elementId, update);

export const deleteElement = (elementId: string) => queries.deleteElement(supabase, elementId);

export const createItem = (elementId: string, name: string, notes?: string | null) =>
  queries.createItem(supabase, elementId, name, notes);

export const updateItem = (itemId: string, update: queries.ItemUpdate) =>
  queries.updateItem(supabase, itemId, update);

export const deleteItem = (itemId: string) => queries.deleteItem(supabase, itemId);

export const createQuote = (input: queries.QuoteInput) => queries.createQuote(supabase, input);

export const updateQuote = (quoteId: string, update: queries.QuoteUpdate) =>
  queries.updateQuote(supabase, quoteId, update);

export const setQuoteStatus = (quoteId: string, status: ProjectQuoteStatus) =>
  queries.setQuoteStatus(supabase, quoteId, status);

export const deleteQuote = (quoteId: string) => queries.deleteQuote(supabase, quoteId);

export const addQuoteLine = (quoteId: string, input: queries.QuoteLineInput) =>
  queries.addQuoteLine(supabase, quoteId, input);

export const updateQuoteLine = (lineId: string, update: Partial<queries.QuoteLineInput>) =>
  queries.updateQuoteLine(supabase, lineId, update);

export const deleteQuoteLine = (lineId: string) => queries.deleteQuoteLine(supabase, lineId);

export const addPayment = (quoteId: string, input: queries.PaymentInput) =>
  queries.addPayment(supabase, quoteId, input);

export const deletePayment = (paymentId: string) => queries.deletePayment(supabase, paymentId);

export const getProjectThings = (projectId: string) => queries.getProjectThings(supabase, projectId);

export const getSupplierTotals = (projectId: string) =>
  queries.getSupplierTotals(supabase, projectId);

export const renameSupplier = (projectId: string, from: string, to: string) =>
  queries.renameSupplier(supabase, projectId, from, to);

// The pure ones, re-exported so screens import money formatting from the same
// place they import the reads. Nothing here touches the client.
export {
  inclGst,
  formatMoney,
  describeTotals,
  describeAllowance,
  describeBudget,
  describePartsBudget,
  describeBuildUp,
  describeLineVariance,
  outstanding,
  itemPriceLabel,
  showsElements,
  groupProjectsByStatus,
  projectSubtitle,
} from '@snag/supabase-queries';
export { GST_RATE } from '@snag/shared-types';

export const markThingAbsent = (propertyId: string, room: string, name: string) =>
  queries.markThingAbsent(supabase, propertyId, room, name);

// ─── Files ────────────────────────────────────────────────────────────────────
//
// A PRIVATE bucket laid out as `<household_id>/<file>`, with documents one level
// deeper under `<household_id>/docs/<file>` — the storage policies read only that
// first path segment, so the prefix is not cosmetic. Store the path, never a URL,
// and resolve a short-lived signed URL whenever something is displayed.
//
// **The bucket is called `home-photos` and it holds manuals too.** That is not an
// oversight and it is not worth fixing: a bucket id cannot be renamed, so undoing
// it would mean a second bucket, four more storage policies, another EXECUTE grant
// on another folder helper and a second signing path — all to hold the same bytes
// under the same layout `home.can_use_photo_folder` already answers for. The name
// is the price. Everything in this file is named for what it actually does, so the
// mismatch stops at the string.

export const HOUSEHOLD_FILES_BUCKET = 'home-photos';

/**
 * Returns `{ path, error }` rather than throwing or swallowing, because callers
 * have to tell "no photo" apart from "upload failed" — the second needs showing
 * and retrying rather than being silently dropped.
 *
 * The content type is a parameter because this bucket holds manuals as well as
 * photos now. It has to be passed in *twice* — to `readForUpload`, which uses it
 * to retype the Blob, and to Storage — because a multipart upload carries the
 * Blob's own type rather than the `contentType` option, so a mismatch lands the
 * file as `application/octet-stream` and the bucket's mime allow-list refuses
 * it. See `lib/uploadBody.ts`.
 */
export async function uploadFile(
  localUri: string,
  fileName: string,
  contentType: string,
  bucket: string = HOUSEHOLD_FILES_BUCKET,
): Promise<{ path: string | null; error: any }> {
  try {
    // Reading the picked file is platform-specific — and a wrong read fails
    // before any request is made, which looks like an upload failure with
    // nothing in the Storage logs. See readForUpload.
    const body = await readForUpload(localUri, contentType);

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, body, { contentType, upsert: false });

    if (error || !data) {
      console.error('Upload error:', error);
      return { path: null, error: error ?? new Error('Upload failed') };
    }
    return { path: data.path, error: null };
  } catch (err) {
    console.error('Upload error:', err);
    return { path: null, error: err };
  }
}

/** Every photo in this app is a JPEG by the time it gets here — see compressAndUpload. */
export async function uploadPhoto(
  localUri: string,
  fileName: string,
  bucket: string = HOUSEHOLD_FILES_BUCKET,
): Promise<{ path: string | null; error: any }> {
  return uploadFile(localUri, fileName, 'image/jpeg', bucket);
}

/**
 * Removes files from the bucket — a deleted snag's photos, a deleted thing's
 * manuals, everything a deleted place leaves behind.
 *
 * **A row and its files are two writes, and until this existed only the first
 * one ever happened.** Deleting a snag dropped the row and left the JPEGs in
 * `home-photos` with nothing anywhere pointing at them, which is the orphan
 * SNAG_INFRA_NOTES.md had a manual audit query for. It has to be done from a
 * client rather than in SQL: `storage.protect_delete()` raises 42501 on a
 * direct delete of a storage.objects row, and it is right to — that would leave
 * the bytes in the backing store with the row gone, which is worse.
 *
 * Deliberately never throws. The row is already gone by the time this runs, so
 * a failure here costs some bytes, and failing the delete somebody just
 * confirmed — or worse, telling them it didn't work when it did — costs more.
 */
export async function deleteStoredFiles(paths: string[]): Promise<void> {
  const unique = [...new Set(paths)].filter(Boolean);
  if (unique.length === 0) return;
  const { error } = await supabase.storage.from(HOUSEHOLD_FILES_BUCKET).remove(unique);
  if (error) console.error('deleteStoredFiles error:', error);
}

/** A short-lived link to anything in the bucket — a photo, or a manual. */
export async function getFileUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(HOUSEHOLD_FILES_BUCKET)
    .createSignedUrl(path, 60 * 60);
  if (error) console.error('getFileUrl error:', path, error);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Batched sibling of getFileUrl for list views — one request for every visible
 * card's cover photo instead of one signed-URL call per card, which was cheap to
 * trip up: a slow or rate-limited response for any single card left it on the
 * "No photo" placeholder forever.
 *
 * This matters more here than it did in the workplace app. A household list is
 * mostly photos — twelve thumbnails is a Saturday you can act on, twelve lines
 * of text is a list you skim and close.
 */
export async function getFileUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(HOUSEHOLD_FILES_BUCKET)
    .createSignedUrls(unique, 60 * 60);
  if (error) console.error('getFileUrls error:', error);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.signedUrl && !row.error) map[row.path ?? ''] = row.signedUrl;
  }
  return map;
}
