/**
 * Every read and write against the `home` schema, in one place.
 *
 * Each function takes its own `SupabaseClient` so both apps can call it with
 * their own — `apps/mobile` re-exports these bound to its client.
 *
 * **The client must be created with `db: { schema: 'home' }`.** Snag Home lives
 * in its own schema beside the frozen `public` one (the retired B2B product),
 * and `home` has to be listed under Settings → API → Exposed schemas or
 * PostgREST serves none of it and every call here 404s.
 *
 * Writes go through SECURITY DEFINER RPCs rather than table writes — there are
 * deliberately no insert/update/delete policies — so the shape of a write can
 * change in one migration without hunting through client code.
 */

import type { SupabaseClient as TypedSupabaseClient } from '@supabase/supabase-js';

/**
 * Deliberately loose in the schema parameter. These functions are called with a
 * client bound to the `home` schema, and supabase-js encodes the schema name in
 * the client's type — so the default `SupabaseClient` (which means `public`)
 * rejects it. Nothing here depends on generated database types.
 */
type SupabaseClient = TypedSupabaseClient<any, any, any>;
import type {
  AdvicePart,
  AdviceTradie,
  AdviceVerdict,
  Comment,
  Household,
  HouseholdMember,
  Invitation,
  InvitationByToken,
  InvitationToMe,
  Location,
  Profile,
  Property,
  Snag,
  SnagAdvice,
  ThingNote,
  SnagFilter,
  SnagSort,
  SnagStatus,
  Thing,
  ThingKind,
  ThingSpec,
  ThingSuggestion,
  AbsentThing,
  Project,
  ProjectAllowanceKind,
  InvoiceReview,
  ProjectBill,
  ProjectElement,
  ProjectExpectedCost,
  ProjectExpectedCostLine,
  ProjectFile,
  ProjectItem,
  ProjectItemStatus,
  ProjectFigure,
  ProjectMilestone,
  ProjectOverride,
  ProjectPayment,
  ProjectQuote,
  ProjectQuoteBasis,
  ProjectQuoteKind,
  ProjectQuoteLine,
  ProjectQuoteRoom,
  ProjectQuoteStatus,
  ProjectStatus,
  ProjectSupplierTotals,
  ProjectTotals,
} from '@snag/shared-types';
import {
  ROOM_SUGGESTIONS,
  STATUS_LABELS,
  THING_KIND_FIELD_LABELS,
  THING_KIND_LABELS,
  GST_RATE,
  PROJECT_STATUS_ORDER,
  PROJECT_STATUS_LABELS,
  PROJECT_ITEM_STATUS_LABELS,
  PROJECT_QUOTE_KIND_LABELS,
  PROJECT_QUOTE_STATUS_LABELS,
} from '@snag/shared-types';

/** Supabase row shapes are snake_case `any`; this is the one place that's true. */
type Row = Record<string, any>;

// ---------------------------------------------------------------- mapping

function mapSnag(row: Row): Snag {
  return {
    id: row.id,
    reference: row.reference,
    householdId: row.household_id,
    propertyId: row.property_id,
    room: row.room ?? null,
    photoPaths: row.photo_paths ?? [],
    linkedThings: row.linked_things ?? [],
    description: row.description ?? null,
    status: row.status,
    parts: row.parts ?? [],
    bought: row.bought ?? [],
    needsParts: !!row.needs_parts,
    dueAt: row.due_at ?? null,
    repeatDays: row.repeat_days ?? null,
    assigneeId: row.assignee_id ?? null,
    thingId: row.thing_id ?? null,
    projectId: row.project_id ?? null,
    projectItemId: row.project_item_id ?? null,
    projectItemName: row.project_item_name ?? null,
    projectElementName: row.project_element_name ?? null,
    reporterId: row.reporter_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastDoneAt: row.last_done_at ?? null,
    doneAt: row.done_at ?? null,
    propertyName: row.property_name,
    reporterName: row.reporter_name,
    assigneeName: row.assignee_name ?? null,
    commentCount: row.comment_count ?? 0,
    thingName: row.thing_name ?? null,
    thingMake: row.thing_make ?? null,
    thingModel: row.thing_model ?? null,
    projectName: row.project_name ?? null,
  };
}

function mapThing(row: Row): Thing {
  return {
    id: row.id,
    householdId: row.household_id,
    propertyId: row.property_id,
    kind: row.kind,
    name: row.name ?? null,
    room: row.room ?? null,
    photoPaths: row.photo_paths ?? [],
    make: row.make ?? null,
    model: row.model ?? null,
    serial: row.serial ?? null,
    consumables: row.consumables ?? [],
    documentPaths: row.document_paths ?? [],
    installedAt: row.installed_at ?? null,
    warrantyUntil: row.warranty_until ?? null,
    serviceDays: row.service_days ?? null,
    // jsonb comes back parsed; the column is constrained to an object, so the
    // only shape to defend against is null from an older row.
    spec: (row.spec ?? {}) as ThingSpec,
    notes: row.notes ?? null,
    projectId: row.project_id ?? null,
    projectItemId: row.project_item_id ?? null,
    projectName: row.project_name ?? null,
    projectFinishedOn: row.project_finished_on ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    propertyName: row.property_name,
    snagCount: Number(row.snag_count ?? 0),
    openSnagCount: Number(row.open_snag_count ?? 0),
  };
}

function mapInvitation(row: Row): Invitation {
  return {
    id: row.id,
    householdId: row.household_id,
    email: row.email ?? null,
    token: row.token ?? null,
    expiresAt: row.expires_at ?? null,
    propertyIds: row.property_ids ?? [],
    invitedBy: row.invited_by,
    createdAt: row.created_at,
  };
}

function mapComment(row: Row): Comment {
  return {
    id: row.id,
    snagId: row.snag_id,
    authorId: row.author_id,
    authorName: row.author?.display_name ?? 'Someone',
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * The `home` schema has to be listed under Settings → API → Exposed schemas in
 * the Supabase dashboard. That setting lives in the platform, not in the
 * database, so no migration can create it and no test in this repo can check
 * it — and when it's missing PostgREST answers *every* call with PGRST106.
 *
 * Left alone that reads as an app with no data: empty lists, no household, no
 * error. So it's named here instead, once, on the way through.
 */
export class SchemaNotExposedError extends Error {
  constructor() {
    super(
      "Snag can't reach its data. The `home` schema isn't exposed in Supabase — " +
        'add it under Settings → API → Exposed schemas.'
    );
    this.name = 'SchemaNotExposedError';
  }
}

type QueryError = { message: string; code?: string } | null;

/** Turns a Supabase error into one worth showing someone. */
export function asError(error: NonNullable<QueryError>, what: string): Error {
  if (error.code === 'PGRST106') return new SchemaNotExposedError();
  return new Error(`${what}: ${error.message}`);
}

function unwrap<T>(data: T | null, error: QueryError, what: string): T {
  if (error) throw asError(error, what);
  if (data === null) throw new Error(`${what}: no data returned`);
  return data;
}

// ---------------------------------------------------------------- household

export async function getMyProfile(client: SupabaseClient): Promise<Profile | null> {
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await client
    .from('profiles')
    .select('id, display_name, created_at, deleted_at, projects_enabled')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (error) throw asError(error, "Couldn't load your profile");
  if (!data) return null;
  return mapProfile(data);
}

/**
 * One place a profile row becomes a `Profile`.
 *
 * Three functions returned this shape by hand and the fourth column was the
 * one that showed why that is a trap: a mapping written out three times is
 * three chances to add a column to two of them. `projects_enabled` decides
 * whether a whole tab renders, so a reader that quietly dropped it would hide
 * Projects from somebody who never asked for that — and would do it only on
 * the screen whose copy was missed.
 *
 * It defaults to `true` rather than `false` for the same reason the column
 * does: an absent answer is not somebody asking for the tab to go.
 */
function mapProfile(row: Row): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    deletedAt: row.deleted_at ?? null,
    projectsEnabled: row.projects_enabled ?? true,
  };
}

/**
 * Turning the Projects tab off, or back on.
 *
 * Its own RPC rather than a field on `upsert_profile`, which is the sign-up
 * path: that one runs before a household exists and is called with a display
 * name and nothing else, and routing a preference through it would mean every
 * caller of it having an opinion about the Projects tab.
 *
 * The row that comes back is what the caller should re-read from, so the toggle
 * can never show a state the database does not hold.
 */
export async function setProjectsEnabled(
  client: SupabaseClient,
  enabled: boolean
): Promise<Profile> {
  const { data, error } = await client.rpc('set_projects_enabled', { p_enabled: enabled });
  return mapProfile(unwrap<Row>(data, error, "Couldn't change that"));
}

export async function upsertProfile(
  client: SupabaseClient,
  displayName: string
): Promise<Profile> {
  const { data, error } = await client.rpc('upsert_profile', { p_display_name: displayName });
  return mapProfile(unwrap<Row>(data, error, "Couldn't save your name"));
}

/**
 * Returns null for someone who has signed up but isn't in a household yet —
 * the only branch the onboarding flow needs.
 *
 * **Ordered by when you joined, newest first, and that is the whole fix for a
 * trap that had no way out.** RLS returns every household you are a member of,
 * and this used to take the oldest one created. So somebody who tapped "Create
 * it" on the Setup screen instead of "Someone else set ours up" made an empty
 * household, got added to the real one, and was then pinned to the empty one
 * for ever — no switcher, no error, nothing on screen to explain it. The house
 * you were most recently let into is the right answer in every real case, and
 * it un-pins that person the moment somebody adds them.
 *
 * It is still one household, deliberately. A switcher would make this a fourth
 * gate, and the whole shape of App.tsx is three. `deleteHousehold` is the way
 * out of the mistake; `countMyHouseholds` is how the Setup screen knows to
 * offer it.
 */
export async function getMyHousehold(client: SupabaseClient): Promise<Household | null> {
  const { data, error } = await client
    .from('household_members')
    .select('created_at, household:households!inner(id, name, created_at)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw asError(error, "Couldn't load your household");
  const row = (data as Row | null)?.household;
  if (!row) return null;
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

/** How many households this account is in. Only ever 0 or 1 unless something went wrong. */
export async function countMyHouseholds(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from('household_members')
    .select('household_id', { count: 'exact', head: true });

  if (error) throw asError(error, "Couldn't load your households");
  return count ?? 0;
}

export async function createHousehold(
  client: SupabaseClient,
  name: string,
  propertyName = 'Home'
): Promise<Household> {
  const { data, error } = await client.rpc('create_household', {
    p_name: name,
    p_property_name: propertyName,
  });
  const row = unwrap<Row>(data, error, "Couldn't create the household");
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

export async function getMembers(
  client: SupabaseClient,
  householdId: string
): Promise<HouseholdMember[]> {
  const { data, error } = await client
    .from('household_members')
    .select('household_id, profile_id, role, profile:profiles!inner(display_name)')
    .eq('household_id', householdId)
    .order('created_at');

  if (error) throw asError(error, "Couldn't load the household");
  return (data ?? []).map((row: Row) => ({
    householdId: row.household_id,
    profileId: row.profile_id,
    displayName: row.profile?.display_name ?? 'Someone',
    role: row.role,
  }));
}

// ---------------------------------------------------------------- invitations
//
// `addMemberByEmail` used to live here. It could only add somebody who had
// already signed up AND already saved a name, so the honest answer to "add my
// partner" was *That account has not finished signing up yet* — shown to the
// one person who could not do anything about it. The order was load-bearing and
// nothing anywhere published it.
//
// An invitation waits on the address instead, so the two halves can happen in
// either order. Nothing is emailed and nothing claims to be: that is the line
// the retired product crossed, not the row itself.

/**
 * Invites an address to a household. It does not have to have an account yet.
 *
 * `propertyIds` omitted means every property, which is the one-place answer;
 * with a bach the caller names them, exactly as before.
 */
export async function inviteToHousehold(
  client: SupabaseClient,
  householdId: string,
  email: string,
  propertyIds?: string[]
): Promise<Invitation> {
  const { data, error } = await client.rpc('invite_to_household', {
    p_household_id: householdId,
    p_email: email,
    p_property_ids: propertyIds ?? null,
  });
  const row = unwrap<Row>(data, error, "Couldn't invite them");
  return mapInvitation(row);
}

/** Who is still waiting on this household — the Waiting rows under Who's here. */
export async function getHouseholdInvitations(
  client: SupabaseClient,
  householdId: string
): Promise<Invitation[]> {
  const { data, error } = await client
    .from('invitations')
    .select('id, household_id, email, token, expires_at, property_ids, invited_by, created_at')
    .eq('household_id', householdId)
    .order('created_at');

  if (error) throw asError(error, "Couldn't load who's waiting");
  return (data ?? []).map(mapInvitation);
}

export async function cancelInvitation(
  client: SupabaseClient,
  invitationId: string
): Promise<void> {
  const { error } = await client.rpc('cancel_invitation', { p_invitation_id: invitationId });
  if (error) throw asError(error, "Couldn't cancel that invitation");
}

// ------------------------------------------------------------- a code to hold up
//
// The same invitation, addressed to whoever holds the link rather than to an
// address. One table, one accept path, one set of Waiting rows — not a second
// mechanism, for the reason the Schedule tab gives about scheduling: two ways
// to do one thing and neither is trustworthy.
//
// **Nothing in this app scans anything.** The QR encodes an ordinary URL and
// the scanner's own camera opens it, which is the point — they haven't
// installed Snag yet. No camera permission, no scanner screen, no getUserMedia
// to get past the deployed CSP.

/** The URL a join QR encodes, and the one shown beside it to copy. */
export function joinUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/join/${token}`;
}

/**
 * Mints the household's one live code, replacing any previous one.
 *
 * Short-lived and revocable is the whole security model: a screenshot is a way
 * in until it expires. Every arrival still has to press Join.
 */
export async function createInviteLink(
  client: SupabaseClient,
  householdId: string,
  propertyIds?: string[],
  hours = 24
): Promise<Invitation> {
  const { data, error } = await client.rpc('create_invite_link', {
    p_household_id: householdId,
    p_property_ids: propertyIds ?? null,
    p_hours: hours,
  });
  const row = unwrap<Row>(data, error, "Couldn't make a code");
  return mapInvitation(row);
}

export async function revokeInviteLink(
  client: SupabaseClient,
  householdId: string
): Promise<void> {
  const { error } = await client.rpc('revoke_invite_link', { p_household_id: householdId });
  if (error) throw asError(error, "Couldn't stop sharing that code");
}

/**
 * What a scanner is being asked to join, named before they answer.
 *
 * Null for a code that has expired or been revoked — which is a real answer, not
 * an error: somebody scanning yesterday's screenshot needs telling, not a stack
 * trace.
 */
export async function getInvitationByToken(
  client: SupabaseClient,
  token: string
): Promise<InvitationByToken | null> {
  const { data, error } = await client.rpc('invitation_by_token', { p_token: token });
  if (error) throw asError(error, "Couldn't check that code");
  const row = ((data as Row[]) ?? [])[0];
  if (!row) return null;
  return {
    id: row.id,
    householdId: row.household_id,
    householdName: row.household_name,
    invitedByName: row.invited_by_name,
    expiresAt: row.expires_at,
    alreadyAMember: !!row.already_a_member,
  };
}

/** Joins by code. Idempotent — scanning twice is a thing people do. */
export async function acceptInvitationByToken(
  client: SupabaseClient,
  token: string
): Promise<void> {
  const { error } = await client.rpc('accept_invitation_by_token', { p_token: token });
  if (error) throw asError(error, "Couldn't join that household");
}

/**
 * What is waiting for *me*.
 *
 * Matched on the caller's address inside the RPC, never on an id passed in, so
 * an invitation is only ever reachable by the person it names — there is no
 * table read here for a non-member to make.
 */
export async function getMyInvitations(client: SupabaseClient): Promise<InvitationToMe[]> {
  const { data, error } = await client.rpc('my_invitations');
  if (error) throw asError(error, "Couldn't check for invitations");
  return ((data as Row[]) ?? []).map((row) => ({
    id: row.id,
    householdId: row.household_id,
    householdName: row.household_name,
    invitedByName: row.invited_by_name,
    createdAt: row.created_at,
  }));
}

export async function acceptInvitation(
  client: SupabaseClient,
  invitationId: string
): Promise<void> {
  const { error } = await client.rpc('accept_invitation', { p_invitation_id: invitationId });
  if (error) throw asError(error, "Couldn't join that household");
}

export async function declineInvitation(
  client: SupabaseClient,
  invitationId: string
): Promise<void> {
  const { error } = await client.rpc('decline_invitation', { p_invitation_id: invitationId });
  if (error) throw asError(error, "Couldn't decline that");
}

// ---------------------------------------------------------------- an ending

/**
 * Every storage key deleting this account would strand — the files of the
 * households it is the only member of, which are the ones about to go.
 *
 * Read BEFORE `deleteMyAccount`, for the reason `getHouseholdFilePaths` gives:
 * the storage delete policy asks whether you are a member, and an account that
 * has deleted itself is not.
 */
export async function getMyOrphanFilePaths(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.rpc('my_orphan_file_paths');
  if (error) throw asError(error, "Couldn't work out what would be deleted");
  return (data as string[] | null) ?? [];
}

/**
 * Ends the account. Households it is alone in go with it; households it shares
 * do not, and it leaves those the way `removeMember` would.
 *
 * The profile row stays behind as a tombstone with the name replaced — three
 * NOT NULL columns in the surviving households still name this person, and a
 * household should not lose work because somebody left. See `20260915091000`.
 */
export async function deleteMyAccount(client: SupabaseClient): Promise<void> {
  const { error } = await client.rpc('delete_my_account');
  if (error) throw asError(error, "Couldn't delete your account");
}

/**
 * The properties this person is linked to, in creation order.
 *
 * RLS already scopes this to their own links, so there is no household filter:
 * a member of the household who isn't linked to the bach simply doesn't see it.
 */
export async function getMyProperties(client: SupabaseClient): Promise<Property[]> {
  const { data, error } = await client
    .from('properties')
    .select('id, household_id, name, suburb, town, property_members(count)')
    .order('created_at');

  if (error) throw asError(error, "Couldn't load your properties");
  return (data ?? []).map((row: Row) => ({
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    suburb: row.suburb ?? null,
    town: row.town ?? null,
    memberCount: row.property_members?.[0]?.count ?? 0,
  }));
}

/**
 * Which property capture should start on.
 *
 * Deliberately the one they last actually filed against, not the one they last
 * tapped — and a server read, so it holds on a new device. The retired product
 * learned this expensively: its equivalent took the first row of an RPC with no
 * ORDER BY, so a member of three sites sent every report to whichever row
 * Postgres happened to return first, forever, with nothing in the UI naming the
 * site. It looked like a permissions problem to the person hitting it.
 *
 * Falls back to the first property rather than to nothing: a capture screen
 * with no property selected cannot save.
 */
export async function getDefaultPropertyId(
  client: SupabaseClient,
  properties: Property[]
): Promise<string | null> {
  if (properties.length === 0) return null;
  if (properties.length === 1) return properties[0].id;

  const { data, error } = await client.rpc('last_reported_property');
  if (error) throw asError(error, "Couldn't work out which place to start on");

  const last = data as string | null;
  return last && properties.some((p) => p.id === last) ? last : properties[0].id;
}

export async function createProperty(
  client: SupabaseClient,
  householdId: string,
  name: string
): Promise<Property> {
  const { data, error } = await client.rpc('create_property', {
    p_household_id: householdId,
    p_name: name,
  });
  const row = unwrap<Row>(data, error, "Couldn't add that place");
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    suburb: row.suburb ?? null,
    town: row.town ?? null,
    memberCount: 1,
  };
}

export async function renameProperty(
  client: SupabaseClient,
  propertyId: string,
  name: string
): Promise<void> {
  const { error } = await client.rpc('rename_property', {
    p_property_id: propertyId,
    p_name: name,
  });
  if (error) throw asError(error, "Couldn't rename that place");
}

/** Who can see and file against a property. */
/**
 * Where a place is, in words.
 *
 * Suburb and town, never a street address — the only thing this answers is
 * "near here", and it leaves the app in every briefed extract. Both are cleared
 * by passing an empty string, because a place entered wrongly has to be
 * un-enterable without deleting the property.
 */
export async function setPropertyLocation(
  client: SupabaseClient,
  propertyId: string,
  suburb: string,
  town: string
): Promise<void> {
  const { error } = await client.rpc('set_property_location', {
    p_property_id: propertyId,
    p_suburb: suburb,
    p_town: town,
  });
  if (error) throw asError(error, "Couldn't save where that place is");
}

export async function getPropertyMemberIds(
  client: SupabaseClient,
  propertyId: string
): Promise<string[]> {
  const { data, error } = await client
    .from('property_members')
    .select('profile_id')
    .eq('property_id', propertyId);

  if (error) throw asError(error, "Couldn't load who's linked");
  return (data ?? []).map((row: Row) => row.profile_id);
}

export async function setPropertyMember(
  client: SupabaseClient,
  propertyId: string,
  profileId: string,
  linked: boolean
): Promise<void> {
  const { error } = await client.rpc(
    linked ? 'link_property_member' : 'unlink_property_member',
    { p_property_id: propertyId, p_profile_id: profileId }
  );
  if (error) throw asError(error, "Couldn't change who's linked");
}

// ---------------------------------------------------------------- taking away
//
// Nothing here existed until 20260914160000: a member could be added and never
// removed, a place created and never deleted, and a household could not be left
// at all. Each of these refuses the case that would strand a row nobody can
// reach, and says so in words rather than letting a constraint name surface.

/**
 * Removes somebody from a household — including yourself, which is what
 * leaving is. One call for both, because with two people in a house they are
 * the same act, and there are no roles here to make one of them a privilege.
 *
 * The profile row survives, so a snag filed by somebody who has since left
 * still says who filed it.
 */
export async function removeMember(
  client: SupabaseClient,
  householdId: string,
  profileId: string
): Promise<void> {
  const { error } = await client.rpc('remove_member', {
    p_household_id: householdId,
    p_profile_id: profileId,
  });
  if (error) throw asError(error, "Couldn't remove them");
}

/**
 * Deletes a place and everything filed at it, and answers with the storage keys
 * the cascade just orphaned.
 *
 * The caller has to clear those itself: SQL can't, because
 * `storage.protect_delete()` refuses a direct delete of a storage.objects row,
 * and rightly — it would leave the bytes behind with the row gone, which is a
 * worse orphan than the one you started with. See `deleteStoredFiles` in
 * apps/mobile/src/lib/supabase.ts.
 */
export async function deleteProperty(
  client: SupabaseClient,
  propertyId: string
): Promise<string[]> {
  const { data, error } = await client.rpc('delete_property', { p_property_id: propertyId });
  if (error) throw asError(error, "Couldn't delete that place");
  return (data as string[] | null) ?? [];
}

/**
 * Every storage key a household owns — read BEFORE deleting it, never after.
 *
 * A household is the one case where the order has to invert, and the reason is
 * the storage policy: `home.can_use_photo_folder` reads the first path segment
 * as a household id and answers `home.is_member(...)`. Deleting a property
 * leaves your membership intact, so the file delete that follows is allowed.
 * Deleting a *household* removes the row that permission is read from — so keys
 * handed back afterwards are keys you can no longer act on, and the path that
 * orphans the most files would orphan every one of them.
 */
export async function getHouseholdFilePaths(
  client: SupabaseClient,
  householdId: string
): Promise<string[]> {
  const { data, error } = await client.rpc('household_file_paths', {
    p_household_id: householdId,
  });
  if (error) throw asError(error, "Couldn't work out what this household holds");
  return (data as string[] | null) ?? [];
}

/**
 * Refuses while anybody else is in it — at that point the list is theirs as
 * much as yours, and the honest move is `removeMember` on yourself.
 *
 * Returns nothing, deliberately. Clear the files first with
 * `getHouseholdFilePaths`; keys handed back from here would read as though they
 * had been dealt with.
 */
export async function deleteHousehold(
  client: SupabaseClient,
  householdId: string
): Promise<void> {
  const { error } = await client.rpc('delete_household', { p_household_id: householdId });
  if (error) throw asError(error, "Couldn't delete this household");
}

// ---------------------------------------------------------------- snags

export async function getSnags(
  client: SupabaseClient,
  filter: SnagFilter = {},
  sort: SnagSort = 'newest'
): Promise<Snag[]> {
  let query = client.from('snags_with_details').select('*');

  if (filter.propertyId) query = query.eq('property_id', filter.propertyId);
  if (filter.status?.length) query = query.in('status', filter.status);
  if (filter.room) query = query.eq('room', filter.room);
  if (filter.assigneeId) query = query.eq('assignee_id', filter.assigneeId);
  if (filter.projectId) query = query.eq('project_id', filter.projectId);
  // Projects off. Asked of Postgres rather than filtered afterwards, so the
  // header count, the shopping pill, the Schedule tab and both extracts cannot
  // disagree about how much there is to do.
  if (filter.excludeProjectSnags) query = query.is('project_id', null);
  if (filter.needsParts !== undefined) query = query.eq('needs_parts', filter.needsParts);
  if (filter.dueOnly) query = query.not('due_at', 'is', null).lte('due_at', new Date().toISOString());

  switch (sort) {
    case 'oldest':
      query = query.order('created_at', { ascending: true });
      break;
    case 'due':
      query = query.order('due_at', { ascending: true, nullsFirst: false });
      break;
    default:
      query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw asError(error, "Couldn't load the list");
  return (data ?? []).map(mapSnag);
}

export async function getSnag(client: SupabaseClient, snagId: string): Promise<Snag> {
  const { data, error } = await client
    .from('snags_with_details')
    .select('*')
    .eq('id', snagId)
    .single();

  const row = unwrap<Row>(data, error, "Couldn't load that item");
  return mapSnag(row);
}

/**
 * What the list and the detail screen put at the top of a snag.
 *
 * There is no title field, so a photo-only snag has no words of its own. Naming
 * it by where it is beats "Untitled": on a list that is mostly photographs, the
 * picture carries the what and this only has to carry the where.
 */
export function snagHeadline(snag: Snag): string {
  if (snag.description) return snag.description;
  return snag.room ? `Something in the ${snag.room.toLowerCase()}` : 'Something to sort out';
}

/**
 * Capture. Everything else about a snag is set later, in triage.
 *
 * `dueAt` and `repeatDays` are the exception, and they are not for capture —
 * the compose bar passes neither and never will. They exist so a servicing
 * regime can create a job that is *already* scheduled: setting either through
 * `updateSnag` afterwards would move the snag to 'doing', because a due date is
 * one of the four things that start a job, and a heat pump service would sit on
 * the list marked Doing for the six months before anybody touched it.
 */
export async function createSnag(
  client: SupabaseClient,
  input: {
    propertyId: string;
    room?: string | null;
    description?: string | null;
    photoPaths?: string[];
    thingId?: string | null;
    /** The renovation it belongs to, when a job is filed from a project's page. */
    projectId?: string | null;
    /**
     * Which project item this snag's answer belongs to — set here and nowhere
     * else. `updateSnag` deliberately cannot reach it, so it can never start a
     * job; and setting it afterwards would be a create-then-update, which is
     * two chances to write half of it.
     */
    projectItemId?: string | null;
    /** Only ever set together, and only by something scheduling ahead. */
    dueAt?: string | null;
    repeatDays?: number | null;
  }
): Promise<Snag> {
  const { data, error } = await client.rpc('create_snag', {
    p_property_id: input.propertyId,
    p_room: input.room ?? null,
    p_description: input.description ?? null,
    p_photo_paths: input.photoPaths ?? [],
    // The RPC still takes a priority and the column still exists; nothing in
    // this app has an opinion about it any more. Always null rather than
    // removed from the call, because the argument is part of the server's
    // signature and a positional gap is a different function.
    p_priority: null,
    p_thing_id: input.thingId ?? null,
    p_due_at: input.dueAt ?? null,
    p_repeat_days: input.repeatDays ?? null,
    p_project_id: input.projectId ?? null,
    p_project_item_id: input.projectItemId ?? null,
  });
  const row = unwrap<Row>(data, error, "Couldn't save that");
  // create_snag returns the base row, not the joined view.
  return getSnag(client, row.id);
}

/**
 * Replacing what a job is about, in one call.
 *
 * Its own function rather than a field on `updateSnag`, for the reason
 * `setPartBought` and `setQuoteStatus` are: saying what something is about is
 * the tail of capture and must not start the job, and a link riding in beside
 * eight other fields is one refactor away from doing exactly that. The server
 * says so too — `set_snag_things` touches neither `status` nor `updated_at`.
 */
export async function setSnagThings(
  client: SupabaseClient,
  snagId: string,
  thingIds: string[]
): Promise<void> {
  const { error } = await client.rpc('set_snag_things', {
    p_snag_id: snagId,
    p_thing_ids: thingIds,
  });
  if (error) throw asError(error, "Couldn't save what this is about");
}

export interface SnagUpdate {
  room?: string | null;
  description?: string | null;
  /** Replaces the whole list. `needs_parts` follows from it, server-side. */
  parts?: string[];
  dueAt?: string | null;
  repeatDays?: number | null;
  assigneeId?: string | null;
  photoPaths?: string[];
  /**
   * What the snag is about, from the house record.
   *
   * Setting this deliberately does not start the job — saying what something
   * is about is the tail of capture, not the head of the work.
   */
  thingId?: string | null;
  /**
   * The renovation it belongs to. Excluded from `v_started` server-side for
   * exactly the same reason `thingId` is.
   */
  projectId?: string | null;
}

const CLEARABLE: Record<string, string> = {
  room: 'room',
  description: 'description',
  dueAt: 'due_at',
  repeatDays: 'repeat_days',
  assigneeId: 'assignee_id',
  thingId: 'thing_id',
  projectId: 'project_id',
};

/**
 * Send only what changed. `null` means "clear this field" and absent means
 * "leave it alone" — the RPC can't tell those apart from the value, so an
 * explicit null is translated into its `p_clear` list here.
 */
export async function updateSnag(
  client: SupabaseClient,
  snagId: string,
  update: SnagUpdate
): Promise<Snag> {
  const clear: string[] = [];
  for (const [key, column] of Object.entries(CLEARABLE)) {
    if (key in update && update[key as keyof SnagUpdate] === null) clear.push(column);
  }

  const { error } = await client.rpc('update_snag', {
    p_snag_id: snagId,
    p_room: update.room ?? null,
    p_description: update.description ?? null,
    p_priority: null,
    p_due_at: update.dueAt ?? null,
    p_repeat_days: update.repeatDays ?? null,
    p_assignee_id: update.assigneeId ?? null,
    p_photo_paths: update.photoPaths ?? null,
    p_parts: update.parts ?? null,
    p_thing_id: update.thingId ?? null,
    p_project_id: update.projectId ?? null,
    p_clear: clear,
  });

  if (error) throw asError(error, "That didn’t save");
  return getSnag(client, snagId);
}

/**
 * Marking a repeating snag done doesn't close it — the RPC rolls `due_at`
 * forward, records `last_done_at`, and leaves it open. Callers should re-read
 * the returned snag rather than assuming the status they asked for.
 */
/**
 * Tick something off at the shop, or untick it.
 *
 * **Its own function, so that buying cannot start a job.** `update_snag` moves a
 * snag to 'doing' when its parts change, because deciding what to buy is
 * deciding to do the work — but getting one of them is not adding one, and a
 * whole list of jobs flipping to 'doing' because somebody walked round a
 * hardware shop would empty the status of meaning from the same end the retired
 * *Start it* button did.
 *
 * Keyed by the item's own text rather than an index: the list can be edited from
 * the other phone while somebody is standing in the aisle.
 */
export async function setPartBought(
  client: SupabaseClient,
  snagId: string,
  item: string,
  bought: boolean
): Promise<void> {
  const { error } = await client.rpc('set_part_bought', {
    p_snag_id: snagId,
    p_item: item,
    p_bought: bought,
  });
  if (error) throw asError(error, "Couldn't tick that off");
}

/** What is still to get on one job. */
export function unboughtParts(snag: Snag): string[] {
  const got = new Set(snag.bought);
  return snag.parts.filter((item) => !got.has(item));
}

/** One line on the trip sheet. */
export interface ShoppingItem {
  item: string;
  snag: Snag;
  bought: boolean;
}

/**
 * Every job's parts, collected into one trip.
 *
 * **What has been got stays on screen, struck through, rather than vanishing.**
 * A tap in an aisle lands on the wrong row often enough that a list which
 * silently drops the thing you just touched is a dead end — you would have to
 * remember which job it belonged to to put it back. It leaves on its own terms:
 * a job with nothing left to get is no longer `needs_parts`, so it drops out of
 * the lens and takes its rows with it, and the card empties as the trip ends.
 *
 * Unbought first, because that is the half being read.
 */
export function shoppingList(snags: Snag[]): ShoppingItem[] {
  const rows = snags.flatMap((snag) => {
    const got = new Set(snag.bought);
    return snag.parts.map((item) => ({ item, snag, bought: got.has(item) }));
  });
  return [...rows.filter((row) => !row.bought), ...rows.filter((row) => row.bought)];
}

/** How many things are still to get, across everything on the list. */
export function shoppingCount(snags: Snag[]): number {
  return snags.reduce((total, snag) => total + unboughtParts(snag).length, 0);
}

export async function setSnagStatus(
  client: SupabaseClient,
  snagId: string,
  status: SnagStatus
): Promise<Snag> {
  const { error } = await client.rpc('set_snag_status', {
    p_snag_id: snagId,
    p_status: status,
  });
  if (error) throw asError(error, "That didn’t save");
  return getSnag(client, snagId);
}

/**
 * Answer an open question about a project, and close it.
 *
 * The destination is not passed here: it was bound to the snag when the
 * question was written (`createSnag`'s `projectItemId`), which is the whole
 * reason there is nothing to sort out at this end. Whoever writes the question
 * knows where the answer goes for free; three months later nobody does.
 *
 * What the person supplies is the one thing only a person can: the figure they
 * read off the paper. There is deliberately no path that takes a document and
 * returns a number — a scraped total has a source nobody can check, and it will
 * be wrong about GST, about provisional sums, and about which of three
 * revisions it read.
 *
 * `chosen` is not a parameter and never will be. Choosing stays on
 * `setQuoteChosen`, which is its own function precisely so it cannot be
 * smuggled in beside eight other fields.
 */
export async function answerProjectSnag(
  client: SupabaseClient,
  snagId: string,
  answer: {
    /** Leave null to file paperwork alone, or to just close the question. */
    amount?: number | null;
    /** What the typed figure meant. Nothing is converted on save. */
    amountInclGst?: boolean;
    /** A quote never counts towards Spent; an invoice or a receipt does. */
    kind?: ProjectQuoteKind;
    supplier?: string | null;
    detail?: string | null;
    dated?: string | null;
    documentPaths?: string[];
  } = {}
): Promise<Snag> {
  const { error } = await client.rpc('answer_project_snag', {
    p_snag_id: snagId,
    p_amount: answer.amount ?? null,
    p_amount_incl_gst: answer.amountInclGst ?? true,
    p_kind: answer.kind ?? 'invoice',
    p_supplier: answer.supplier ?? null,
    p_detail: answer.detail ?? null,
    p_dated: answer.dated ?? null,
    p_document_paths: answer.documentPaths ?? [],
  });
  if (error) throw asError(error, "That didn’t save");
  return getSnag(client, snagId);
}

export async function deleteSnag(client: SupabaseClient, snagId: string): Promise<void> {
  const { error } = await client.rpc('delete_snag', { p_snag_id: snagId });
  if (error) throw asError(error, "That didn’t save");
}

// ---------------------------------------------------------------- comments

export async function getComments(client: SupabaseClient, snagId: string): Promise<Comment[]> {
  const { data, error } = await client
    .from('comments')
    .select('id, snag_id, author_id, body, created_at, author:profiles!inner(display_name)')
    .eq('snag_id', snagId)
    .order('created_at');

  if (error) throw asError(error, "Couldn't load the comments");
  return (data ?? []).map(mapComment);
}

/**
 * Everything anybody has written about one thing, from its *other* jobs.
 *
 * **This is the payoff for linking a snag to an asset, arriving on the screen
 * where it is useful.** The heat pump has been serviced twice and had a fault
 * once; what somebody wrote the last time is the single most useful paragraph
 * in the app when the same appliance plays up again, and until now it was
 * buried in a snag nobody would think to open.
 *
 * The current snag is excluded by id — its own notes are already on the page,
 * directly above, and showing them twice would read as a duplicate rather than
 * as history.
 *
 * RLS does the rest: the comments policy asks the snag's property, so this
 * returns exactly what this person could have read by opening those snags one
 * at a time.
 */
export async function getThingNotes(
  client: SupabaseClient,
  thingId: string,
  exceptSnagId: string,
  limit = 10
): Promise<ThingNote[]> {
  const { data, error } = await client
    .from('comments')
    .select(`
      id, body, created_at,
      author:profiles!inner(display_name),
      snag:snags!inner(id, reference, thing_id, description, room)
    `)
    .eq('snag.thing_id', thingId)
    .neq('snag_id', exceptSnagId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw asError(error, "Couldn't load what has been said about it");
  return (data ?? []).map((row: Row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    authorName: row.author?.display_name ?? 'Someone who left',
    snagId: row.snag?.id,
    snagReference: row.snag?.reference,
  }));
}

export async function addComment(
  client: SupabaseClient,
  snagId: string,
  body: string
): Promise<void> {
  const { error } = await client.rpc('add_comment', { p_snag_id: snagId, p_body: body });
  if (error) throw asError(error, "That didn’t save");
}

/**
 * Stamps "you have looked at the list", and returns when you last did.
 *
 * The previous value is what the list renders "new since" against, and it is
 * returned rather than read separately so the two can't race. Null the first
 * time, deliberately: the alternative greets a new member with their whole
 * household's backlog marked unread.
 */
export async function markListSeen(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.rpc('mark_list_seen');
  // Never fatal. A list that can't work out what's new is still a list, so this
  // reports nothing rather than taking the screen down with it.
  if (error) {
    console.error('Failed to mark the list seen:', error);
    return null;
  }
  return (data as string | null) ?? null;
}

// ---------------------------------------------------------------- locations

/**
 * The location tags offered at capture, in the order they were seeded.
 *
 * This replaced a list derived from rooms already used. Derived suggestions
 * read well in a mockup and are empty in real life on the one day that
 * matters — the day the app is installed and someone decides whether logging
 * something is quicker than saying it out loud.
 */
export async function getLocations(
  client: SupabaseClient,
  propertyId: string
): Promise<Location[]> {
  const { data, error } = await client
    .from('locations')
    .select('id, property_id, name, sort_order')
    .eq('property_id', propertyId)
    .order('sort_order');

  if (error) throw asError(error, "Couldn't load the location tags");
  return (data ?? []).map((row: Row) => ({
    id: row.id,
    propertyId: row.property_id,
    name: row.name,
    sortOrder: row.sort_order,
  }));
}

/**
 * Add a tag to a property's list.
 *
 * The seeded twelve were always a starting point rather than the vocabulary —
 * a bach needs a Boatshed, a villa needs a Sleepout. The RPC refuses a blank
 * name and a name already in use (case-insensitively), in words, rather than
 * letting `locations_unique_per_property` surface.
 */
export async function createLocation(
  client: SupabaseClient,
  propertyId: string,
  name: string
): Promise<void> {
  const { error } = await client.rpc('create_location', {
    p_property_id: propertyId,
    p_name: name,
  });
  if (error) throw asError(error, "Couldn't add that tag");
}

/**
 * Remove a tag from a property's list.
 *
 * This does not touch the snags filed under it. `snags.room` is TEXT rather
 * than a foreign key precisely so history survives: a snag logged in the
 * Sleepout still reads Sleepout after the tag is retired, and the list still
 * filters on it. What removal changes is only what capture offers next time.
 */
export async function deleteLocation(client: SupabaseClient, locationId: string): Promise<void> {
  const { error } = await client.rpc('delete_location', { p_location_id: locationId });
  if (error) throw asError(error, "Couldn't remove that tag");
}


// ------------------------------------------------------------- house record

/**
 * Everything at one place, in one read.
 *
 * Deliberately unpaginated and unfiltered: a house holds tens of things, not
 * thousands, and search is the primary control on this tab — which means it has
 * to be instant and has to work on the list already in hand. A round trip per
 * keystroke would make the one moment this tab exists for (standing in a shop,
 * on a bad connection, needing one string) the moment it is slowest.
 */
export async function getThings(client: SupabaseClient, propertyId: string): Promise<Thing[]> {
  const { data, error } = await client
    .from('things_with_details')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });

  if (error) throw asError(error, "Couldn't load the house record");
  return (data ?? []).map(mapThing);
}

export async function getThing(client: SupabaseClient, thingId: string): Promise<Thing> {
  const { data, error } = await client
    .from('things_with_details')
    .select('*')
    .eq('id', thingId)
    .single();

  const row = unwrap<Row>(data, error, "Couldn't load that");
  return mapThing(row);
}

/**
 * What a card and a sheet put at the top of a thing.
 *
 * The model number leads when there is one, because it is the answer somebody
 * came for — "Heat pump" is what they already knew. A name is the fallback, and
 * the room is the last resort, on the same reasoning as `snagHeadline`.
 */
/**
 * A storage key for an attached document, and the name to show for one.
 *
 * The key keeps the original filename because the filename *is* the label: a
 * list reading "Rangehood manual.pdf" answers what a list of UUIDs never
 * could. Only the first path segment matters to the storage policies
 * (`home.can_use_photo_folder` reads it and nothing else), so the `docs/`
 * level and the name after it are free to carry meaning.
 *
 * The timestamp and random prefix are what stop two people attaching
 * `manual.pdf` on the same day from colliding — uploads are `upsert: false`,
 * so a collision is a failure rather than an overwrite.
 */
export function documentFileName(pathPrefix: string, originalName: string): string {
  const cleaned = originalName
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-80);
  const safe = cleaned.length > 0 ? cleaned : 'document.pdf';
  return `${pathPrefix}/docs/${Date.now()}-${Math.round(Math.random() * 1e6)}-${safe}`;
}

/** The name to show for a stored document — the key with its prefix taken off. */
export function documentName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  // Only strip a prefix this app minted. A file that arrived some other way
  // keeps whatever name it has rather than losing its first two hyphenated
  // words to a pattern it never followed.
  const stripped = base.replace(/^\d{10,}-\d+-/, '');
  return stripped.length > 0 ? stripped : base;
}

export function thingHeadline(thing: Thing): string {
  if (thing.name) return thing.name;
  if (thing.make || thing.model) return [thing.make, thing.model].filter(Boolean).join(' ');
  return thing.room ? `Something in the ${thing.room.toLowerCase()}` : 'Something in the house';
}

/** The line under the headline: the string you would read out. */
export function thingDetailLine(thing: Thing): string | null {
  const parts = thing.name ? [thing.make, thing.model] : [thing.model];
  const line = parts.filter(Boolean).join(' ');
  return line || null;
}

/**
 * Everything about a thing that someone might search by, lower-cased.
 *
 * Consumables are in here on purpose: typing `GU10` should list every fitting
 * in the house that takes one, and a filter part number is the single most
 * likely thing to be typed into this field from a hardware aisle.
 */
export function thingSearchText(thing: Thing): string {
  return [
    thing.name,
    thing.make,
    thing.model,
    thing.serial,
    thing.room,
    thing.notes,
    ...thing.consumables,
    ...Object.values(thing.spec),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Case- and whitespace-insensitive, matching every word typed rather than the phrase. */
export function searchThings(things: Thing[], query: string): Thing[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return things;
  return things.filter((thing) => {
    const haystack = thingSearchText(thing);
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * A paint's swatch, as a colour a screen can draw — or null.
 *
 * `spec.hex` is typed, or comes from `readLabel` as the maker's published value
 * for the colour named on the tin, and either way it is text somebody could
 * have got wrong. So it is read back rather than trusted:
 * six hex digits or three, with or without the `#`, and anything else draws
 * **nothing** rather than a guess. A swatch in the wrong colour is worse than
 * none, because it is the one part of a paint record somebody believes at a
 * glance without reading the code beside it.
 *
 * Only ever approximate — no screen shows paint true — which is why it sits
 * beside the colour code and never replaces it. The code is what the shop
 * matches.
 */
export function swatchColour(spec: ThingSpec): string | null {
  const raw = (spec.hex ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toUpperCase()}`;
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.split('').map((c) => c + c).join('').toUpperCase()}`;
  }
  return null;
}

/**
 * The open job already waiting on this item for this thing, if there is one.
 *
 * What stops the cart beside a consumable filing the same filter twice: a
 * second tap, or the other phone having done it an hour ago, answers "it's
 * already on the list" rather than putting two rows on the trip sheet for one
 * cartridge. Matched on the words, trimmed and in any case, because the item
 * text is the key the shopping list already uses (`set_part_bought`).
 *
 * An item that has been **bought** does not count: it is off the trip sheet,
 * and somebody pressing the cart again is saying they need another one.
 * Done jobs never count either — the list does not show them.
 */
export function consumableOnList(snags: Snag[], thingId: string, item: string): Snag | null {
  const want = item.trim().toLowerCase();
  if (!want) return null;
  return (
    snags.find(
      (snag) =>
        snag.status !== 'done' &&
        (snag.thingId === thingId || snag.linkedThings.some((one) => one.id === thingId)) &&
        unboughtParts(snag).some((part) => part.trim().toLowerCase() === want)
    ) ?? null
  );
}

/**
 * The repeating job that services this thing, if there is one.
 *
 * **One per thing, and this is how it is found.** *Schedule service* used to
 * file a new repeating job every time it was pressed — so changing a heat pump
 * from six months to a year left the six-monthly job running beside the new
 * one, and *Stop servicing it* stopped nothing on the list. The thing page now
 * edits the job this returns and files one only when it returns null; and it
 * reads the cycle off that job, so the two cannot drift. Soonest due first,
 * should an older duplicate still exist.
 */
export function serviceJobFor(snags: Snag[], thingId: string): Snag | null {
  const candidates = snags.filter(
    (snag) =>
      snag.status !== 'done' &&
      !!snag.repeatDays &&
      (snag.thingId === thingId || snag.linkedThings.some((one) => one.id === thingId))
  );
  candidates.sort((a, b) => {
    const at = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const bt = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    return at - bt;
  });
  return candidates[0] ?? null;
}

/**
 * What `read-label` says it could read off a photograph.
 *
 * Every field is what was **printed**, or null. The one exception is `hex`,
 * which is the paint maker's **published** value for the colour the tin names
 * — never judged from the photo — and is only ever drawn as a swatch beside
 * the code (see `swatchColour`). `consumables` is limited server-side to part
 * numbers on the label itself — a bulb spec guessed from general knowledge is
 * the same unverifiable claim an unsourced tradesman is, and a wrong one is a
 * wasted trip.
 */
export interface LabelReading {
  legible: boolean;
  make: string | null;
  model: string | null;
  serial: string | null;
  colourName: string | null;
  colourCode: string | null;
  product: string | null;
  sheen: string | null;
  tint: string | null;
  hex: string | null;
  consumables: string[];
  /**
   * **Not read off the label.** What the model knows goes with this make and
   * model — "Air filter MAC-2360FT" — offered on the walkthrough's last step as
   * rows somebody taps to add, and never laid into a box. See `applyLabelReading`.
   */
  suggestedConsumables: string[];
  /** Likewise a suggestion: 180, 365 or 730, or null. Never chosen for them. */
  suggestedServiceDays: number | null;
}

/**
 * What the reader thinks the thing in the photo **is** — "Heat pump", paint —
 * as opposed to what its label says. Never read off the label, so it is only
 * ever an offer on the walkthrough's *What is it?* step, which the person sees
 * and can change before anything is written. Kept apart from `LabelReading`
 * because it can be answered from a photo whose label could not be read.
 */
export interface LabelGuess {
  name: string | null;
  kind: ThingKind | null;
}

/**
 * A brand in the case it writes itself in, when the label shouted it.
 *
 * Rating plates print the maker in capitals, and "MITSUBISHI ELECTRIC" in the
 * house record reads as a label rather than a name. The model is asked for the
 * brand's own casing; this is the fallback for when it copies the capitals
 * anyway. Anything already holding a lower-case letter is left exactly as it
 * came — "iRobot" and "De'Longhi" are somebody's decision — and a word of three
 * letters or fewer stays capitals, because that is LG, AEG and GE.
 */
export function brandCase(value: string): string {
  if (/[a-z]/.test(value) || !/[A-Z]/.test(value)) return value;
  return value
    .split(' ')
    .map((word) =>
      /^[A-Z0-9]{1,3}$/.test(word)
        ? word
        : word.toLowerCase().replace(/(^|[-'’.])([a-z])/g, (_, lead: string, c: string) => lead + c.toUpperCase())
    )
    .join(' ');
}

/** Service intervals the walkthrough offers, by the months a model says them in. */
const SUGGESTED_CYCLE_DAYS: Record<number, number> = { 6: 180, 12: 365, 24: 730 };

function labelText(value: unknown, max = 80): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * The function's answer, read defensively.
 *
 * It crossed a network from a model, so nothing about its shape is assumed:
 * anything not a string becomes null, strings are trimmed and capped at what
 * the boxes they land in accept, and a reading with no `legible: true` is not
 * a reading.
 */
export function parseLabelReading(raw: unknown): LabelReading | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.legible !== true) return null;
  const consumables = Array.isArray(r.consumables)
    ? r.consumables.map((one) => labelText(one, 60)).filter((one): one is string => !!one).slice(0, 5)
    : [];
  const suggestedConsumables = Array.isArray(r.suggestedConsumables)
    ? r.suggestedConsumables
        .map((one) => {
          if (!one || typeof one !== 'object') return null;
          const { item, code } = one as Record<string, unknown>;
          const words = [labelText(item, 40), labelText(code, 40)].filter(Boolean).join(' ');
          return words ? words.slice(0, 60) : null;
        })
        .filter((one): one is string => !!one)
        .filter((one, i, all) => all.findIndex((other) => other.toLowerCase() === one.toLowerCase()) === i)
        .slice(0, 4)
    : [];
  const make = labelText(r.make);
  return {
    legible: true,
    make: make ? brandCase(make) : null,
    model: labelText(r.model),
    serial: labelText(r.serial),
    colourName: labelText(r.colourName),
    colourCode: labelText(r.colourCode),
    product: labelText(r.product),
    sheen: labelText(r.sheen),
    tint: labelText(r.tint, 120),
    hex: swatchColour({ hex: labelText(r.hex, 9) ?? '' }),
    consumables,
    suggestedConsumables,
    suggestedServiceDays:
      typeof r.suggestedServiceMonths === 'number' ? SUGGESTED_CYCLE_DAYS[r.suggestedServiceMonths] ?? null : null,
  };
}

const GUESSABLE_KINDS: ThingKind[] = ['appliance', 'finish', 'tile'];

/** `whatItIs` and `kindGuess`, read as defensively as the rest. Null when neither says anything. */
export function parseLabelGuess(raw: unknown): LabelGuess | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = labelText(r.whatItIs, 40);
  const kind = GUESSABLE_KINDS.includes(r.kindGuess as ThingKind) ? (r.kindGuess as ThingKind) : null;
  if (!name && !kind) return null;
  return { name: name ? name.charAt(0).toUpperCase() + name.slice(1) : null, kind };
}

/** The walkthrough's boxes, as far as a label can answer them. */
export interface LabelFields {
  name: string;
  make: string;
  model: string;
  serial: string;
  takes: string;
  spec: ThingSpec;
}

/**
 * A reading, laid into the boxes — **only the empty ones.**
 *
 * The rule the whole feature rests on. Somebody who typed a model number and
 * then photographed the plate has already answered, and a reading that wrote
 * over them would be the app deciding a photograph knows better than the
 * person holding the appliance. Filling blanks and nothing else also makes it
 * safe to arrive late: the read runs while they carry on typing, and whatever
 * they reached first is kept.
 *
 * The kind decides where things go, exactly as `THING_KIND_FIELD_LABELS`
 * decides what the boxes are called. A paint's colour is its **name** — the
 * answer somebody comes back for — its brand the make and its code the model.
 * Returns what it filled, in words, so the sheet can say which boxes to check
 * against the label rather than implying it read everything.
 *
 * The suggestions are deliberately **not** laid in here, even into an empty
 * box. Everything this fills was printed on the thing in somebody's hand and
 * they can check it against the label; a suggested filter code is the model's
 * memory of the model, and the only honest place for it is an offer they tap.
 */
export function applyLabelReading(
  current: LabelFields,
  reading: LabelReading,
  kind: ThingKind
): { next: LabelFields; filled: string[] } {
  const next: LabelFields = { ...current, spec: { ...current.spec } };
  const filled: string[] = [];
  const colourKind = kind === 'finish' || kind === 'tile';

  const put = (key: 'name' | 'make' | 'model' | 'serial' | 'takes', value: string | null, word: string) => {
    if (!value || next[key].trim()) return;
    next[key] = value;
    filled.push(word);
  };
  const putSpec = (key: string, value: string | null, word: string) => {
    if (!value || (next.spec[key] ?? '').trim()) return;
    next.spec[key] = value;
    filled.push(word);
  };

  if (colourKind) {
    put('name', reading.colourName, 'colour');
    put('make', reading.make, kind === 'finish' ? 'brand' : 'range');
    put('model', reading.colourCode ?? reading.model, 'code');
    if (kind === 'finish') {
      putSpec('product', reading.product, 'product');
      putSpec('sheen', reading.sheen, 'sheen');
      putSpec('tint', reading.tint, 'tint formula');
      // A published hex belongs to a named colour. One arriving without a
      // name or code to be the published value *of* is a judgement of the
      // photo, which is exactly what a swatch must not be.
      if (reading.colourName || reading.colourCode) putSpec('hex', reading.hex, 'swatch');
    }
  } else {
    put('make', reading.make, 'make');
    put('model', reading.model, 'model');
    put('serial', reading.serial, 'serial');
    put('takes', reading.consumables[0] ?? null, 'what it takes');
  }
  return { next, filled };
}

/**
 * What `read-label` answered: the reading (null when no label could be made
 * out), what it thinks the thing is, and the id of the reading it keeps in
 * `home.label_readings` — which is how a reading that arrives after the sheet
 * has gone still reaches the thing's page.
 */
export interface LabelReadAnswer {
  reading: LabelReading | null;
  guess: LabelGuess | null;
  readingId: string | null;
}

/**
 * A read that came back without a reading, in the function's own words — with
 * the id of the reading it kept, when it kept one. A busy model gets a second
 * go in the background, so a `readingId` here means the answer may still turn
 * up on the thing's page.
 */
export class LabelReadError extends Error {
  readingId: string | null;
  constructor(message: string, readingId: string | null) {
    super(message);
    this.name = 'LabelReadError';
    this.readingId = readingId;
  }
}

/**
 * Asks `read-label` what a photograph of a label says.
 *
 * The photo is already in `home-photos` by the time this is called, and the
 * function downloads it **as the caller**, so the storage policies decide
 * whether it can be read — a path to somebody else's household is refused the
 * same way it would be refused anywhere else. Nothing is written to the
 * record: the answer goes into boxes a person then confirms, or waits in
 * `home.label_readings` to be checked on the thing's page.
 *
 * `kind` is null when nobody has said what the thing is yet — the walkthrough
 * takes the photo first — and the reader is then asked to say.
 *
 * Throws a `LabelReadError` with the function's own words when it gave some
 * ("Label reading isn't set up on this project"), so a missing key and an
 * unreadable photo are not one message.
 */
export async function readLabel(
  client: SupabaseClient,
  path: string,
  kind: ThingKind | null
): Promise<LabelReadAnswer> {
  const { data, error } = await client.functions.invoke('read-label', {
    body: kind ? { path, kind } : { path },
  });
  if (error) {
    let words: string | null = null;
    let readingId: string | null = null;
    const context = (error as { context?: unknown }).context;
    if (context && typeof (context as Response).json === 'function') {
      try {
        const body = await (context as Response).json();
        words = typeof body?.error === 'string' ? body.error : null;
        readingId = typeof body?.readingId === 'string' ? body.readingId : null;
      } catch {
        words = null;
      }
    }
    throw new LabelReadError(words ?? "Couldn't read the label", readingId);
  }
  const readingId =
    data && typeof data === 'object' && typeof (data as { readingId?: unknown }).readingId === 'string'
      ? ((data as { readingId: string }).readingId)
      : null;
  return { reading: parseLabelReading(data), guess: parseLabelGuess(data), readingId };
}

/** Why a reading waiting on the thing's page came to nothing. */
export type LabelReadingReason = 'illegible' | 'busy' | 'quota' | 'error';

/**
 * A reading of a thing's photographed label that nobody has answered yet —
 * one that landed after *Add it*, or never landed at all.
 */
export interface LabelReadingToCheck {
  id: string;
  thingId: string;
  thingName: string | null;
  photoPath: string;
  /** `pending` is still being read; a stalled one comes back `failed`. */
  status: 'pending' | 'read' | 'failed';
  reading: LabelReading | null;
  reason: LabelReadingReason | null;
  createdAt: string;
}

const READING_REASONS: LabelReadingReason[] = ['illegible', 'busy', 'quota', 'error'];

/**
 * Every reading at this place waiting on somebody, with the thing it is about.
 * One request, for the House tab's count and the thing page's card alike.
 */
export async function getLabelReadingsToCheck(
  client: SupabaseClient,
  propertyId: string
): Promise<LabelReadingToCheck[]> {
  const { data, error } = await client.rpc('label_readings_to_check', { p_property_id: propertyId });
  if (error) throw asError(error, "Couldn't load the label readings");
  return ((data ?? []) as Row[]).map((row) => {
    const reading = row.status === 'read' ? parseLabelReading(row.reading) : null;
    // A reading that parses to nothing has nothing to offer, which is the
    // illegible card rather than an empty one.
    const status: LabelReadingToCheck['status'] =
      row.status === 'read' && !reading ? 'failed' : row.status;
    return {
      id: row.id,
      thingId: row.thing_id,
      thingName: row.thing_name ?? null,
      photoPath: row.photo_path,
      status,
      reading,
      reason: status === 'failed'
        ? (READING_REASONS.includes(row.reason) ? row.reason : 'illegible')
        : null,
      createdAt: row.created_at,
    };
  });
}

/**
 * Ends a reading's card: `used` when somebody took what it said (the
 * walkthrough, or *Use these*), `dismissed` for *Not right*. Neither touches
 * the thing — using a reading is an `updateThing` made first.
 */
export async function resolveLabelReading(
  client: SupabaseClient,
  readingId: string,
  outcome: 'used' | 'dismissed'
): Promise<void> {
  const { error } = await client.rpc('resolve_label_reading', { p_id: readingId, p_outcome: outcome });
  if (error) throw asError(error, "That didn’t save");
}

/** One box the check card offers to fill or change, in the words the thing page uses. */
export interface LabelOffer {
  key: 'name' | 'make' | 'model' | 'serial' | 'product' | 'sheen' | 'tint' | 'hex';
  /** What the box is called, per kind: *Colour code* for a paint, *Model* otherwise. */
  label: string;
  value: string;
  /** What the record holds now. Null when the box is empty. */
  current: string | null;
}

export interface LabelOffers {
  /** Boxes the record has left empty — *Use these* fills all of them in one write. */
  fill: LabelOffer[];
  /** Boxes where the label disagrees with what somebody typed — each its own *Use*. */
  differ: LabelOffer[];
  /** Parts not already on the thing: what the label printed, then what the model suggests. */
  parts: string[];
  /** A service cycle to offer, only when the thing has none. Never chosen for anybody. */
  serviceDays: number | null;
}

const sameWords = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * What a late reading has to say about a thing that already exists.
 *
 * The same rule as `applyLabelReading`, with the one difference a saved record
 * makes: a box somebody filled is never overwritten, but where the label
 * **disagrees** with them the card says so and offers it on its own — they may
 * have mistyped, and they are the only one who can say. A box the label agrees
 * with is not mentioned at all. A paint's colour is its name, its brand the
 * make and its code the model, exactly as in the walkthrough; its name is only
 * offered when the record has none, because a name is the person's own answer
 * to *What is it?*.
 *
 * Nothing here is ever a suggestion laid into a box: `parts` and `serviceDays`
 * are offers to tap, as on the walkthrough's last step.
 */
export function labelOffers(thing: Thing, reading: LabelReading): LabelOffers {
  const fill: LabelOffer[] = [];
  const differ: LabelOffer[] = [];
  const colourKind = thing.kind === 'finish' || thing.kind === 'tile';
  const words = THING_KIND_FIELD_LABELS[thing.kind] ?? THING_KIND_FIELD_LABELS.appliance;

  const offer = (key: LabelOffer['key'], label: string, value: string | null, current: string | null) => {
    if (!value) return;
    const now = current && current.trim() ? current : null;
    if (!now) fill.push({ key, label, value, current: null });
    else if (!sameWords(now, value)) differ.push({ key, label, value, current: now });
  };

  if (colourKind) {
    if (!thing.name?.trim() && reading.colourName) offer('name', 'Colour', reading.colourName, null);
    offer('make', words.make, reading.make, thing.make);
    offer('model', words.model, reading.colourCode ?? reading.model, thing.model);
    if (thing.kind === 'finish') {
      offer('product', 'Product', reading.product, thing.spec.product ?? null);
      offer('sheen', 'Sheen', reading.sheen, thing.spec.sheen ?? null);
      offer('tint', 'Tint formula', reading.tint, thing.spec.tint ?? null);
      // A published hex belongs to a named colour, as in `applyLabelReading`.
      if (reading.colourName || reading.colourCode) {
        offer('hex', 'Swatch', reading.hex, thing.spec.hex ?? null);
      }
    }
  } else {
    offer('make', words.make, reading.make, thing.make);
    offer('model', words.model, reading.model, thing.model);
    offer('serial', 'Serial', reading.serial, thing.serial);
  }

  const onThing = (item: string) => thing.consumables.some((one) => sameWords(one, item));
  const parts = colourKind
    ? []
    : [...reading.consumables, ...reading.suggestedConsumables]
        .filter((one) => !onThing(one))
        .filter((one, i, all) => all.findIndex((other) => sameWords(other, one)) === i);

  return {
    fill,
    differ,
    parts,
    serviceDays: !colourKind && !thing.serviceDays ? reading.suggestedServiceDays : null,
  };
}

/** The `ThingUpdate` that writes some offers — one call, whichever boxes they are. */
export function labelOffersUpdate(offers: LabelOffer[]): ThingUpdate {
  const update: ThingUpdate = {};
  const spec: ThingSpec = {};
  for (const one of offers) {
    if (one.key === 'name' || one.key === 'make' || one.key === 'model' || one.key === 'serial') {
      update[one.key] = one.value;
    } else {
      spec[one.key] = one.value;
    }
  }
  if (Object.keys(spec).length) update.spec = spec;
  return update;
}

/**
 * The order the asset picker offers a house in.
 *
 * Three bands, and each earns its place by how likely the next tap is:
 *
 * 1. **Already linked**, pinned, so the answer somebody is amending is never
 *    somewhere they have to hunt for — and so unlinking is as cheap as linking.
 * 2. **This job's room**, because the room is already on the snag and is the
 *    single best guess available: a kitchen job is about a kitchen appliance
 *    far more often than not.
 * 3. **Everything else**, because houses are not laid out the way a catalogue
 *    thinks — a study can hold a heat pump, a flat can keep the washing machine
 *    in the bathroom — and a picker that only ever offers the room quietly
 *    insists otherwise. The same argument the walkthrough's step two makes.
 *
 * Alphabetical inside each band, because a card is read rather than ranked.
 * Pure and exported so the bands can be pinned as a property; the sheet only
 * renders what this decides.
 */
export function assetPickerOrder(
  things: Thing[],
  linkedIds: string[],
  room: string | null
): Thing[] {
  const linked = new Set(linkedIds);
  const here = (thing: Thing) =>
    !!room && (thing.room ?? '').toLowerCase() === room.toLowerCase();

  const band = (thing: Thing) => (linked.has(thing.id) ? 0 : here(thing) ? 1 : 2);

  return [...things].sort((a, b) =>
    band(a) - band(b) || thingHeadline(a).localeCompare(thingHeadline(b))
  );
}

export interface ThingInput {
  propertyId: string;
  kind: ThingKind;
  name?: string | null;
  room?: string | null;
  photoPaths?: string[];
  /**
   * The invoice, the certificate, the manual — offered at the same step as the
   * rating plate, so it arrives with the row rather than as a second write. A
   * create followed by an update is two chances to leave a file in the bucket
   * that nothing points at.
   */
  documentPaths?: string[];
  make?: string | null;
  model?: string | null;
  serial?: string | null;
  consumables?: string[];
  installedAt?: string | null;
  warrantyUntil?: string | null;
  serviceDays?: number | null;
  spec?: ThingSpec;
  notes?: string | null;
  /**
   * The renovation that put it here, when a thing is recorded from a project's
   * item rather than from the House tab.
   *
   * Carried into `create_thing` rather than written afterwards, for the reason
   * `documentPaths` is: a create followed by an update is two chances to write
   * half of it.
   */
  projectId?: string | null;
  /**
   * Which item of that project it came out of.
   *
   * What `projectId` alone could not say, and what lets the handover list stop
   * offering something it has already put in the record.
   */
  projectItemId?: string | null;
}

/**
 * Capture: a photograph of the label is enough, and everything else is asked
 * afterwards. The RPC refuses the genuinely empty case in words rather than
 * letting `things_has_something` surface.
 */
export async function createThing(client: SupabaseClient, input: ThingInput): Promise<Thing> {
  const { data, error } = await client.rpc('create_thing', {
    p_property_id: input.propertyId,
    p_kind: input.kind,
    p_name: input.name ?? null,
    p_room: input.room ?? null,
    p_photo_paths: input.photoPaths ?? [],
    p_document_paths: input.documentPaths ?? [],
    p_make: input.make ?? null,
    p_model: input.model ?? null,
    p_serial: input.serial ?? null,
    p_consumables: input.consumables ?? null,
    p_installed_at: input.installedAt ?? null,
    p_warranty_until: input.warrantyUntil ?? null,
    p_service_days: input.serviceDays ?? null,
    p_spec: input.spec ?? null,
    p_notes: input.notes ?? null,
    p_project_id: input.projectId ?? null,
    p_project_item_id: input.projectItemId ?? null,
  });
  const row = unwrap<Row>(data, error, "Couldn't save that");
  // create_thing returns the base row, not the joined view.
  return getThing(client, row.id);
}

export interface ThingUpdate {
  /**
   * Capture files everything as `appliance` rather than stopping to ask, so
   * the amend row has to be able to correct it. Not clearable: everything is
   * of some kind.
   */
  kind?: ThingKind;
  name?: string | null;
  room?: string | null;
  photoPaths?: string[];
  make?: string | null;
  model?: string | null;
  serial?: string | null;
  consumables?: string[];
  installedAt?: string | null;
  warrantyUntil?: string | null;
  serviceDays?: number | null;
  /** Manuals and receipts. An array, so it is emptied with `[]`, never null. */
  documentPaths?: string[];
  /** Merged into what is already there, key by key. */
  spec?: ThingSpec;
  /** Spec keys to drop, by key name — a null inside `spec` can't say this. */
  clearSpec?: string[];
  notes?: string | null;
  /** Null unlinks it from the project — the × beside the *Installed during* row. */
  projectId?: string | null;
}

const THING_CLEARABLE: Record<string, string> = {
  name: 'name',
  room: 'room',
  make: 'make',
  model: 'model',
  serial: 'serial',
  installedAt: 'installed_at',
  warrantyUntil: 'warranty_until',
  serviceDays: 'service_days',
  notes: 'notes',
  projectId: 'project_id',
};

/**
 * Everything the caller names, in one write.
 *
 * The thing page used to call this once per field, on blur. It now collects the
 * typed fields and saves them together, because a page that writes silently
 * leaves nobody any way to know it worked — the rows were writing, and the
 * person filling them in could not tell. Taps (the kind chips, the room, the
 * parts list, photos and documents) still call this one at a time: those are
 * single decisions that are their own confirmation.
 */
export async function updateThing(
  client: SupabaseClient,
  thingId: string,
  update: ThingUpdate
): Promise<Thing> {
  const clear: string[] = [];
  for (const [key, column] of Object.entries(THING_CLEARABLE)) {
    if (key in update && update[key as keyof ThingUpdate] === null) clear.push(column);
  }
  for (const key of update.clearSpec ?? []) clear.push(`spec.${key}`);

  const { error } = await client.rpc('update_thing', {
    p_thing_id: thingId,
    p_kind: update.kind ?? null,
    p_name: update.name ?? null,
    p_room: update.room ?? null,
    p_photo_paths: update.photoPaths ?? null,
    p_make: update.make ?? null,
    p_model: update.model ?? null,
    p_serial: update.serial ?? null,
    p_consumables: update.consumables ?? null,
    p_installed_at: update.installedAt ?? null,
    p_warranty_until: update.warrantyUntil ?? null,
    p_service_days: update.serviceDays ?? null,
    p_document_paths: update.documentPaths ?? null,
    p_spec: update.spec ?? null,
    p_notes: update.notes ?? null,
    p_project_id: update.projectId ?? null,
    p_clear: clear,
  });

  if (error) throw asError(error, "That didn’t save");
  return getThing(client, thingId);
}

/**
 * Remove something from the record.
 *
 * The snags about it survive with their pointer nulled: what was wrong with
 * the old dishwasher is still what was wrong, it just no longer points at a
 * dishwasher that isn't there.
 */
export async function deleteThing(client: SupabaseClient, thingId: string): Promise<void> {
  const { error } = await client.rpc('delete_thing', { p_thing_id: thingId });
  if (error) throw asError(error, "Couldn't remove that");
}

// ------------------------------------------------------- what isn't there yet

/**
 * The greyed entries a room still shows: what a house of this kind probably
 * has, minus what has actually been recorded, minus what this place hasn't got.
 *
 * A recorded thing counts as answering a suggestion when its name **is** the
 * suggestion or **contains** it — somebody who files the dishwasher as "Bosch
 * dishwasher" has plainly dealt with the Dishwasher prompt, and leaving the
 * ghost up would be the app failing to notice work that was done. The cost of
 * the looser match is the occasional suggestion hidden early, which is one tap
 * on the + to put right; the cost of the stricter one is a permanent nag, which
 * is how a screen gets ignored.
 */
export function suggestionsForRoom(room: string): ThingSuggestion[] {
  const known = ROOM_SUGGESTIONS[room];

  // A room nobody catalogued — a conservatory, a movie room, a study somebody
  // added themselves — still has walls, and paint is the one thing every room
  // in every house has. Offering it is both true and the most useful first
  // entry; offering nothing would leave a room somebody just created invisible
  // on the House tab, since a section with no things and no ghosts is not
  // drawn.
  //
  // `Elsewhere` is listed in the catalogue as deliberately empty, so it falls
  // through this and stays bare. Present-and-empty is not the same as absent.
  if (!known) return [{ name: 'Paint', kind: 'finish' }];

  // Every catalogued room can be painted too, whether or not the catalogue
  // happened to say so.
  return known.some((one) => one.kind === 'finish') || known.length === 0
    ? known
    : [...known, { name: 'Paint', kind: 'finish' }];
}

/**
 * Everything the catalogue knows about, across every room, deduplicated.
 *
 * **Not every house is laid out the same.** A study can hold a heat pump, a
 * garage can hold a fridge, a bedroom can hold a washing machine in a flat.
 * A room's own list is what the ghosts prompt for and what most taps will hit,
 * but the picker has to offer the rest of the house's vocabulary too or it
 * quietly insists everybody's rooms are arranged like the catalogue's.
 *
 * Deduplicated by name, because Paint is in every room and Smoke alarm is in
 * three — the first kind seen wins, and they agree by construction.
 */
export function catalogueSuggestions(): ThingSuggestion[] {
  const seen = new Map<string, ThingSuggestion>();
  for (const forRoom of Object.values(ROOM_SUGGESTIONS)) {
    for (const suggestion of forRoom) {
      if (!seen.has(suggestion.name)) seen.set(suggestion.name, suggestion);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Case- and whitespace-insensitive, matching anywhere in the name. */
export function matchSuggestions(
  suggestions: ThingSuggestion[],
  query: string
): ThingSuggestion[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return suggestions;
  return suggestions.filter((one) => one.name.toLowerCase().includes(wanted));
}

/**
 * The rooms whose names contain what somebody typed.
 *
 * The same rule `matchSuggestions` uses, against the room vocabulary rather
 * than the thing catalogue: substring, anywhere in the name, any case. Nobody
 * hunting the laundry types "wash", but somebody hunting "Under the house"
 * types "house" — and a prefix match would answer that with nothing.
 *
 * Its own function rather than a generic over `{ name: string }`, because a
 * room is a `Location` with an id that a snag's TEXT `room` column does not
 * store, and a matcher that took either would be one edit away from filing a
 * snag under a suggestion's name.
 */
export function matchRooms(locations: Location[], query: string): Location[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return locations;
  return locations.filter((one) => one.name.toLowerCase().includes(wanted));
}

export function ghostsForRoom(
  room: string,
  things: Thing[],
  absent: AbsentThing[]
): ThingSuggestion[] {
  const suggestions = suggestionsForRoom(room);
  if (suggestions.length === 0) return [];

  const normal = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const recorded = things
    .filter((thing) => thing.room === room)
    .map((thing) => normal(thing.name ?? ''))
    .filter(Boolean);
  const dismissed = new Set(
    absent.filter((a) => a.room === room).map((a) => normal(a.name))
  );

  // A paint prompt is answered by *any* paint in the room, not by one called
  // "Paint". Half Spanish White on the main wall and Quarter Alabaster on the
  // windows are both finishes and neither is named after the prompt, so a
  // name match would leave "Paint · not recorded yet" sitting under two
  // recorded paints — the app failing to notice work already done, which is
  // the fastest way to get a screen ignored. The second and third paints come
  // from the +, which offers Paint in every room regardless.
  const kindsRecorded = new Set(
    things.filter((thing) => thing.room === room).map((thing) => thing.kind)
  );

  return suggestions.filter((suggestion) => {
    const wanted = normal(suggestion.name);
    if (dismissed.has(wanted)) return false;
    if (suggestion.kind === 'finish') return !kindsRecorded.has('finish');
    return !recorded.some((name) => name === wanted || name.includes(wanted));
  });
}

export async function getAbsentThings(
  client: SupabaseClient,
  propertyId: string
): Promise<AbsentThing[]> {
  const { data, error } = await client
    .from('absent_things')
    .select('property_id, room, name')
    .eq('property_id', propertyId);

  if (error) throw asError(error, "Couldn't load the house record");
  return (data ?? []).map((row: Row) => ({
    propertyId: row.property_id,
    room: row.room,
    name: row.name,
  }));
}

/** "No dryer here." Idempotent, because the card may still be on screen. */
export async function markThingAbsent(
  client: SupabaseClient,
  propertyId: string,
  room: string,
  name: string
): Promise<void> {
  const { error } = await client.rpc('mark_thing_absent', {
    p_property_id: propertyId,
    p_room: room,
    p_name: name,
  });
  if (error) throw asError(error, "Couldn't hide that");
}

// `home.restore_absent_things` is deliberately left in the schema with nothing
// calling it — the *1 not here · bring it back* line was removed because saying
// a house has no dryer is a small certain fact, and a standing offer to un-say
// it is clutter sitting on top of the answer. The RPC stays; a client wrapper
// for it would just be a second dead thing to keep in step with the first.

// ---------------------------------------------------------------- due dates

/**
 * How often something comes round, said the way somebody would say it.
 *
 * Both halves of the app need this and both mean the same thing by it: a
 * repeating snag's `repeat_days` and a thing's `service_days` are the same
 * integer, deliberately, because the moment there are two ways to schedule
 * something in this app neither of them is trustworthy. "Every 6 months", never
 * "every 180 days" — nobody has ever serviced anything on a day count.
 */
export function describeCycle(days: number): string {
  if (days % 365 === 0) return days === 365 ? 'year' : `${days / 365} years`;
  if (days % 30 === 0) return days === 30 ? 'month' : `${days / 30} months`;
  if (days % 7 === 0) return days === 7 ? 'week' : `${days / 7} weeks`;
  return days === 1 ? 'day' : `${days} days`;
}

/**
 * A date off a rating plate, in the words that are printed on it.
 *
 * A plate says `MFD 2019-11` and a warranty card says "November 2022" — month
 * precision, because nobody knows or cares which day the heat pump was made.
 * So the record shows "Nov 2019" and only says the day when somebody has
 * actually given one.
 */
export function formatLooseDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  const month = m ? MONTHS[m - 1] : null;
  if (!month) return String(y);
  // Day 1 is what a month-only answer is stored as, so showing it back would
  // invent a precision nobody offered.
  return d && d !== 1 ? `${d} ${month} ${y}` : `${month} ${y}`;
}

/**
 * A date that is always a real day — a bill's due date, the day a payment went.
 *
 * `formatLooseDate` drops the first of the month because that is how a
 * month-only answer is stored; a bill due on the 1st is due on the 1st, and
 * reading "Due Sep 2026" for it would hide the one precise fact on the row.
 */
export function formatExactDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const month = m ? MONTHS[m - 1] : null;
  if (!y || !month || !d) return formatLooseDate(iso);
  return `${d} ${month} ${y}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Takes what somebody typed and returns a date Postgres will accept, or null.
 *
 * The column is a real `date`, so an unparsed "Nov 2019" is a 22008 raised
 * from inside an RPC — a database error surfaced to somebody who answered the
 * question correctly. This accepts every form the label and the person are
 * likely to use: `2019`, `2019-11`, `11/2019`, `Nov 2019`, `November 2019`,
 * `2019-11-08`, `8 Nov 2019`, and `8/11/2019`. A missing day is the first of
 * the month, which `formatLooseDate` then declines to show back.
 *
 * **`8/11/2019` is the eighth of November, never the eleventh of August.**
 * This is a New Zealand household app and `dd/mm/yyyy` is what people write
 * here — it is also what the calendar writes back into the field, so the two
 * halves of a date control have to agree. Day-first was not merely undecided
 * before: the three-part numeric form matched no pattern at all and came back
 * `undefined`, so the single most natural way to type a date was the one way
 * that did not work. A warranty filed three months out is not a date anybody
 * re-reads until it matters, which is why this is stated here and pinned in
 * `houseRecord.test.ts` rather than left to the reader of the regex.
 *
 * **A two-digit year is refused rather than guessed at.** `8/11/98` is 1998 on
 * a villa's wiring and 2098 on nothing at all, and there is no rule that gets
 * both right; the field says it cannot read it, which is recoverable, where a
 * silently wrong century is not.
 *
 * **Every branch is checked against a real calendar**, so `31/02/2026` and
 * `2019-13-45` come back `undefined` rather than reaching Postgres as a 22008
 * from inside an RPC — which is the failure this function exists to prevent and
 * which the numeric branches could previously still produce.
 *
 * Returns `undefined` when it cannot tell — the caller keeps what was typed and
 * says so, rather than silently discarding it or storing a wrong date.
 */
export function parseLooseDate(input: string): string | null | undefined {
  const text = input.trim();
  if (!text) return null;

  /**
   * Null unless the three numbers are a day that exists.
   *
   * Constructed and read back rather than range-checked by hand: the Date
   * constructor rolls 31 February forward into March, so a round trip that
   * comes back with a different month is the check.
   */
  const iso = (y: number, m: number, d: number): string | undefined => {
    if (!(y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return undefined;
    const probe = new Date(y, m - 1, d);
    if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) {
      return undefined;
    }
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  const monthNumber = (word: string): number | null => {
    const at = MONTHS.findIndex((m) => word.toLowerCase().startsWith(m.toLowerCase()));
    return at === -1 ? null : at + 1;
  };

  let m;
  // 2019-11-08 / 2019/11/8
  if ((m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
    return iso(+m[1], +m[2], +m[3]);
  }
  // 2019-11 / 2019/11
  if ((m = text.match(/^(\d{4})[-/](\d{1,2})$/))) return iso(+m[1], +m[2], 1);
  // 8/11/2019 — day first, always. See the note above: this is the form most
  // people here actually type, and it matched nothing at all until now.
  if ((m = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) {
    return iso(+m[3], +m[2], +m[1]);
  }
  // 11/2019
  if ((m = text.match(/^(\d{1,2})[-/](\d{4})$/))) return iso(+m[2], +m[1], 1);
  // 2019
  if ((m = text.match(/^(\d{4})$/))) return iso(+m[1], 1, 1);
  // Nov 2019 / November 2019
  if ((m = text.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/))) {
    const month = monthNumber(m[1]);
    return month ? iso(+m[2], month, 1) : undefined;
  }
  // 8 Nov 2019 / 8 November 2019
  if ((m = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/))) {
    const month = monthNumber(m[2]);
    return month ? iso(+m[3], month, +m[1]) : undefined;
  }
  return undefined;
}

/**
 * A repeating job that has been done and is waiting for its next turn.
 *
 * **This is the closest a repeat gets to finished, and the list has to show it.**
 * `home.set_snag_status` rolls `due_at` forward and leaves the status `open`, so
 * a job somebody has just completed sits in its room looking exactly like one
 * nobody has touched — the "done leaves" reward the whole list is built on
 * cannot fire, because nothing left. So it dims and sinks instead: same
 * translucency a done card gets, at the very bottom of the list.
 *
 * The rule is `last_done_at` plus a date still ahead, **not** merely having a
 * `repeat_days`. The gutters due on Saturday are an ordinary job and belong in
 * Outside with everything else; it is only the one already dealt with this
 * cycle that has nothing to ask of anybody. The moment the date comes round it
 * is an ordinary job again, with no write and no cron — the same arithmetic the
 * Schedule tab's hollow "comes round" marks are drawn from.
 */
export function isDoneForNow(snag: Snag, now = new Date()): boolean {
  if (!snag.repeatDays || !snag.lastDoneAt || !snag.dueAt) return false;
  if (snag.status === 'done') return false;
  return new Date(snag.dueAt).getTime() > now.getTime();
}

export type DueState = 'overdue' | 'due-soon' | 'scheduled' | 'none';

export function dueState(snag: Snag, now = new Date()): DueState {
  if (!snag.dueAt) return 'none';
  const due = new Date(snag.dueAt).getTime();
  const days = (due - now.getTime()) / 86_400_000;
  if (days < 0) return 'overdue';
  if (days <= 7) return 'due-soon';
  return 'scheduled';
}

/**
 * Phrased the way someone would say it out loud. Precision past "in 3 weeks"
 * is noise on a list of household chores.
 */
export function describeDue(snag: Snag, now = new Date()): string | null {
  if (!snag.dueAt) return null;
  const days = Math.round((new Date(snag.dueAt).getTime() - now.getTime()) / 86_400_000);

  if (days < -1) return `${Math.abs(days)} days overdue`;
  if (days === -1) return 'Due yesterday';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 13) return `Due in ${days} days`;
  if (days <= 60) return `Due in ${Math.round(days / 7)} weeks`;
  return `Due in ${Math.round(days / 30)} months`;
}

// ------------------------------------------------------------------ schedule
//
// The Schedule tab, which is a **read** of the list and never a second way to
// write to it.
//
// That restraint is the whole design. This app has one scheduling mechanism —
// `due_at` plus `repeat_days`, set on a snag in triage, rolled forward by
// `home.set_snag_status` when a repeating job is marked done — and the moment
// there are two ways to schedule something in it, neither is trustworthy. So
// nothing here creates, moves or clears a date. It arranges what the snags
// already say into months, and every row on it is a door back to the snag.
//
// Three things are worth being careful about, and all three are pinned by
// `schedule.test.ts`.
//
// **A projected repeat is not a date.** A snag that comes round every six
// months has exactly one `due_at`; the occasions after it do not exist as rows
// and never will. Showing them is the point of the tab — "what comes round" is
// the question — but they are marked `next` rather than `due` and drawn hollow,
// for the same reason a ghost on the House tab is drawn dashed: an entry
// nothing has confirmed, presented as one that has, is worse than no entry at
// all.
//
// **Days are local days.** A timestamp is an instant; a calendar cell is a day
// in whoever is holding the phone's timezone. `dayKey` crosses that boundary in
// exactly one place so the grid and the marks can't disagree about which cell a
// 9pm due date belongs in — which in NZDT is the difference between Saturday
// and Sunday.
//
// **A repeating snag's completions are plural.** It never reaches 'done', so
// `done_at` is null and `last_done_at` holds the most recent one. Only the most
// recent, which is the honest limit of what the schema remembers: the tab shows
// the completions it can prove and does not invent a history it hasn't got.

/** What a day on the calendar can be carrying. */
export type ScheduleKind = 'filed' | 'done' | 'due' | 'next' | 'project';

export interface ScheduleMark {
  /** Local `YYYY-MM-DD`, which is what a calendar cell is keyed by. */
  day: string;
  kind: ScheduleKind;
  /**
   * The job this mark is about. **Null on a project mark**, because a project
   * is not a snag and pretending otherwise is how the tab would end up with two
   * ideas of what it is showing.
   */
  snag: Snag | null;
  /** Set on a project mark and on nothing else. */
  project?: Project;
  /** Which of a project's three dates this is: "Started", "Finished". */
  note?: string;
}

/** The order marks are listed and drawn in: what happened, then what's coming. */
const KIND_ORDER: ScheduleKind[] = ['filed', 'done', 'due', 'next', 'project'];

/**
 * How far a repeat is walked forward before the loop gives up.
 *
 * A cap rather than a date test, because the loop starts at the snag's own
 * `due_at` — which for a monthly job someone set up two years ago is 24 steps
 * behind the month on screen, and for a weekly one is over a hundred. This
 * bounds the work per snag at something a phone does not notice while still
 * reaching several years out, which is further than a household plans.
 */
const MAX_PROJECTED_REPEATS = 400;

/**
 * The local day an instant falls on.
 *
 * Deliberately not `toISOString().slice(0, 10)`, which is the UTC day: a job
 * due at 9pm on a Saturday in Auckland is a Sunday in UTC for half the year,
 * and a calendar that files it under Sunday is wrong about the one fact it
 * exists to state.
 */
export function dayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Six weeks of local dates covering `month`, starting on a Monday.
 *
 * Always 42 cells, so the grid does not change height as the months go by —
 * a calendar that reflows when you page through it makes the arrows feel like
 * they moved something else. Monday-first because that is the week this app's
 * only market reads.
 */
export function monthGrid(year: number, month: number): Date[] {
  // getDay() is Sunday-based; shift so Monday is 0.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  // Day-of-month arithmetic rather than adding to a start date: the Date
  // constructor normalises 0 and negatives into the previous month and past
  // the last into the next, so one expression covers all three without the
  // month ever having to be carried by hand.
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - lead + i));
}

/**
 * Every mark a set of snags puts on the days between `from` and `to`.
 *
 * `to` is exclusive, and both are local dates rather than instants — the caller
 * passes the first and last cells of the grid it is about to draw, so projected
 * repeats are only ever computed for a month somebody is actually looking at.
 */
export function scheduleMarks(
  snags: Snag[],
  from: Date,
  to: Date,
  /**
   * The renovations, so the calendar answers "what were we doing that month"
   * as well as "what is due".
   *
   * Optional, so every existing caller and every existing test keeps working
   * unchanged — a project mark is an addition to this tab, not a change to it.
   */
  projects: Project[] = []
): ScheduleMark[] {
  const fromKey = dayKey(from);
  const toKey = dayKey(to);
  const within = (day: string) => day >= fromKey && day < toKey;
  const out: ScheduleMark[] = [];

  for (const snag of snags) {
    const add = (day: string, kind: ScheduleKind) => {
      if (within(day)) out.push({ day, kind, snag });
    };

    add(dayKey(snag.createdAt), 'filed');

    // A repeating snag never reaches 'done', so `done_at` is null on it and
    // `last_done_at` is where its completion landed. Taking both and
    // de-duplicating means a one-off that has the same instant in each column
    // is still one mark.
    const finished = [snag.doneAt, snag.lastDoneAt].filter(Boolean) as string[];
    for (const day of new Set(finished.map(dayKey))) add(day, 'done');

    if (!snag.dueAt) continue;
    add(dayKey(snag.dueAt), 'due');

    // What comes round. Nothing is written and no row exists for any of these;
    // they are `due_at` walked forward by `repeat_days`, which is the same
    // arithmetic `home.set_snag_status` will do when the job is marked done.
    // A finished one-off is not projected, and neither is anything already
    // closed.
    if (!snag.repeatDays || snag.repeatDays <= 0 || snag.status === 'done') continue;
    const due = new Date(snag.dueAt);
    for (let i = 1; i <= MAX_PROJECTED_REPEATS; i += 1) {
      const at = new Date(due.getFullYear(), due.getMonth(), due.getDate() + snag.repeatDays * i);
      const day = dayKey(at);
      if (day >= toKey) break;
      add(day, 'next');
    }
  }

  // Projects, and **still nothing that writes**. The tab's rule is that there
  // is one scheduling mechanism in this app — `due_at` plus `repeat_days` — and
  // the moment there are two, neither is trustworthy. These are a read of dates
  // already set on the project's own page: no cell is draggable, nothing moves
  // between days, and every row is a door back to the project.
  //
  // A project has three dates and they are three different claims, so each gets
  // its own mark with its own word rather than one dot meaning "something about
  // this renovation". `target_on` is deliberately **not** called "Due": nothing
  // is due, it is a hope somebody typed, and the one word this tab must never
  // spend loosely is that one.
  for (const project of projects) {
    const addProject = (date: string | null, note: string) => {
      if (!date) return;
      const day = dayKey(`${date}T00:00:00`);
      if (within(day)) out.push({ day, kind: 'project', snag: null, project, note });
    };

    addProject(project.startedOn, 'Started');
    addProject(project.finishedOn, 'Finished');
    // A target already met is not a date anybody needs on a calendar — the job
    // finished, and the row saying so is two lines up.
    if (!project.finishedOn) addProject(project.targetOn, 'Aiming to finish');
  }

  return out;
}

/** The marks falling on one day, in the order they should be read. */
export function marksOn(marks: ScheduleMark[], day: string): ScheduleMark[] {
  return marks
    .filter((m) => m.day === day)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

/** What a mark is called where it is listed out. */
export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  filed: 'Added',
  done: 'Done',
  due: 'Due',
  // Not "Due": nothing is due then, and nothing will be until the current one
  // is marked done and the date rolls. It is when this comes round again.
  next: 'Comes round',
  // The row carries its own word — "Started", "Finished", "Aiming to finish" —
  // because a project's three dates are three different claims. This is only
  // the fallback and the legend's name for the kind.
  project: 'Project',
};

// ---------------------------------------------------------------- extracts
//
// Taking the list, or the house record, out of the app as a file.
//
// The rows are built here rather than in a screen for the usual reason — they
// are pure, so they can be asserted without rendering anything — and because
// the CSV and the PDF must never disagree about what an extract contains. One
// row builder each, two renderers over the same rows.
//
// **An extract says what it is at the top.** Scope is asked each time (this
// view, or everything), and a file whose contents depend on screen state you
// set twenty minutes ago is one you will misread later. So the heading carries
// the house, the place, the date and which scope was chosen.

/** A rendered table: the header row, then the body rows, all strings. */
export interface ExportTable {
  /** What the file is called, without an extension. */
  name: string;
  /** The line under the title: house, place, scope, date. */
  subtitle: string;
  columns: string[];
  rows: string[][];
}

const yesNo = (value: boolean): string => (value ? 'Yes' : '');

/** `2026-09-15`, in local time — an extract is filed by the day it was taken. */
export function exportDateStamp(now = new Date()): string {
  return dayKey(now);
}

/** Spaces and punctuation out of a name that has to survive a file system. */
export function exportFileName(base: string, stamp: string, extension: string): string {
  const safe = base
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase() || 'snag';
  return `${safe}-${stamp}.${extension}`;
}

/**
 * Every snag as a row.
 *
 * Deliberately wider than the card: an extract is read at a desk, where the
 * columns the list hides — who filed it, when, what it repeats on — are the
 * reason for taking one at all. `snagHeadline` leads, because a photo-only snag
 * has no words of its own and a spreadsheet cannot show the photo.
 */
export function snagExportTable(
  snags: Snag[],
  meta: { household: string; place: string; scope: string; stamp: string }
): ExportTable {
  return {
    name: `${meta.household} list`,
    subtitle: `${meta.place} · ${meta.scope} · ${meta.stamp}`,
    columns: [
      'Reference', 'What', 'Room', 'Status', 'Needs parts', 'Parts',
      'Due', 'Repeats', 'About', 'Assigned to', 'Filed by', 'Filed', 'Done', 'Photos',
    ],
    rows: snags.map((snag) => [
      snag.reference,
      snagHeadline(snag),
      snag.room ?? '',
      STATUS_LABELS[snag.status] ?? snag.status,
      yesNo(snag.needsParts),
      (snag.parts ?? []).join('; '),
      formatLooseDate(snag.dueAt),
      snag.repeatDays ? describeCycle(snag.repeatDays) : '',
      [snag.thingName, snag.thingMake, snag.thingModel].filter(Boolean).join(' '),
      snag.assigneeName ?? '',
      snag.reporterName ?? '',
      formatLooseDate(snag.createdAt),
      formatLooseDate(snag.doneAt ?? snag.lastDoneAt),
      String((snag.photoPaths ?? []).length || ''),
    ]),
  };
}

/**
 * The recorded things in one room, for the "what is it about?" offer.
 *
 * **Only that room's, which is the whole point.** A house holds tens of things
 * and a snag is about one of them; offering the lot turns a two-second tag into
 * a search, and the room has just been answered on the step before. So a snag
 * tagged Kitchen is offered the kitchen's things and nothing else — and one
 * with no room at all is offered the things that belong to the place rather
 * than to a room in it (`Whole house`, which is `room === null` on both tables).
 *
 * **Ghosts cannot be here, and that is not a filter — it is the type.** A
 * suggestion is a `RoomSuggestion` from a constant, never a `Thing`, so it has
 * no id for `snags.thing_id` to point at. If this ever takes anything but rows
 * that came back from `things_with_details`, the House tab's founding rule has
 * been broken somewhere upstream.
 *
 * Sorted by what the chip will say, because a rail somebody scans for a noun is
 * a rail that should be in the order of the nouns.
 */
export function thingsInArea(things: Thing[], room: string | null): Thing[] {
  return things
    .filter((thing) => (thing.room ?? null) === (room ?? null))
    .sort((a, b) => thingHeadline(a).localeCompare(thingHeadline(b)));
}

/**
 * How many photographs a PDF will carry. Twenty is a file somebody can open on
 * a phone and send to a builder, and roughly where a JPEG-per-page extract
 * stops being a document and starts being an album.
 */
export const EXPORT_PHOTO_LIMIT = 20;

/** One picture in an extract, and the two lines printed under it. */
export interface ExportPhoto {
  /** Storage key, signed at render time. */
  path: string;
  /** What it is — the same headline the list shows. */
  caption: string;
  /** Where and which one: the reference and the room. */
  detail: string;
}

/**
 * Choose which photographs go in, **one round each before any second one**.
 *
 * Taking them in row order would let a single snag somebody photographed from
 * five angles spend a quarter of the allowance, and an extract of fourteen jobs
 * would come back showing four of them. A round-robin means every row on the
 * extract is pictured before any row is pictured twice, which is the answer
 * somebody flicking to the back of the document is actually looking for.
 */
function roundRobin<T>(
  rows: T[],
  photosOf: (row: T) => string[],
  describe: (row: T, path: string) => ExportPhoto,
  limit: number,
): ExportPhoto[] {
  const out: ExportPhoto[] = [];
  const deepest = rows.reduce((max, row) => Math.max(max, photosOf(row).length), 0);
  for (let round = 0; round < deepest && out.length < limit; round += 1) {
    for (const row of rows) {
      if (out.length >= limit) break;
      const path = photosOf(row)[round];
      if (path) out.push(describe(row, path));
    }
  }
  return out;
}

/** The photographs on an extract of the list. */
export function snagExportPhotos(snags: Snag[], limit = EXPORT_PHOTO_LIMIT): ExportPhoto[] {
  return roundRobin(
    snags,
    (snag) => snag.photoPaths ?? [],
    (snag, path) => ({
      path,
      caption: snagHeadline(snag),
      detail: [snag.reference, snag.room].filter(Boolean).join(' · '),
    }),
    limit,
  );
}

/** The photographs on an extract of the house record. */
export function thingExportPhotos(things: Thing[], limit = EXPORT_PHOTO_LIMIT): ExportPhoto[] {
  return roundRobin(
    things,
    (thing) => thing.photoPaths ?? [],
    (thing, path) => ({
      path,
      caption: thingHeadline(thing),
      detail: [thing.room ?? 'Whole house', thingDetailLine(thing)].filter(Boolean).join(' · '),
    }),
    limit,
  );
}

/**
 * Every recorded thing as a row.
 *
 * Ghosts are not in it, and that is the same rule the tab itself rests on: a
 * suggestion never reaches `home.things`, so it cannot reach an extract either.
 * An extract full of things nobody has confirmed is exactly the record you
 * check in a shop and find nothing behind.
 */
export function thingExportTable(
  things: Thing[],
  meta: { household: string; place: string; scope: string; stamp: string }
): ExportTable {
  return {
    name: `${meta.household} house`,
    subtitle: `${meta.place} · ${meta.scope} · ${meta.stamp}`,
    columns: [
      'Room', 'Kind', 'Name', 'Make', 'Model', 'Serial', 'Takes',
      'Installed', 'Warranty until', 'Serviced', 'Notes', 'Photos', 'Documents',
    ],
    rows: things.map((thing) => [
      thing.room ?? 'Whole house',
      THING_KIND_LABELS[thing.kind] ?? thing.kind,
      thing.name ?? '',
      thing.make ?? '',
      thing.model ?? '',
      thing.serial ?? '',
      (thing.consumables ?? []).join('; '),
      formatLooseDate(thing.installedAt),
      formatLooseDate(thing.warrantyUntil),
      thing.serviceDays ? describeCycle(thing.serviceDays) : '',
      thing.notes ?? '',
      String((thing.photoPaths ?? []).length || ''),
      // `?? []` rather than trusting the type: `document_paths` was dropped by
      // `things_with_details` for two days once and `mapThing` defaulted it —
      // nothing anywhere had an error to report. An extract should come out
      // missing a count, not fail to come out. See 20260914140000.
      String((thing.documentPaths ?? []).length || ''),
    ]),
  };
}

/**
 * RFC 4180 CSV.
 *
 * Three things it has to get right, and all three are how a spreadsheet extract
 * usually arrives broken: a value containing a comma, a value containing a
 * quote, and a value containing a newline — a snag's description can hold all
 * three. Quoting everything is simpler than deciding per value and costs bytes
 * nobody is counting.
 *
 * CRLF because Excel on Windows still wants it, and every other reader accepts
 * it. The BOM is there so Excel reads the file as UTF-8 rather than guessing a
 * code page and turning a résumé into rÃ©sumÃ© — the single most common way a
 * CSV looks corrupt when it isn't.
 */
export function toCsv(table: ExportTable, { bom = true } = {}): string {
  const cell = (value: string) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [table.columns, ...table.rows].map((row) => row.map(cell).join(','));
  return `${bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------- the brief
//
// The PDF is the copy that goes to somebody who was not there. One of those
// somebodies is now an assistant being asked what all this is and what it would
// cost — so the PDF can carry the question as well as the evidence, and the
// answer comes back as text that `parseSnagActions` files against the
// references it was asked about.
//
// **The brief rides in the PDF, and only there**, exactly as the photographs
// do. A spreadsheet is a thing you sort; the brief is prose addressed to a
// reader, and `ExportTable` holds rows.
//
// Two rules in the wording, both of which exist because of how this fails:
//
//   * **It states the scope it was made under.** The chips already ask (this
//     view, or everything) and *everything* includes finished work — so a brief
//     that said "review all open issues" would contradict the file it is
//     stapled to and spend half the answer on jobs already done.
//   * **It requires a source for every tradesman and permits "none found".**
//     Asked for three local tradesmen, an assistant with no way to look will
//     produce three plausible names and three plausible numbers, and they
//     arrive in a household's list indistinguishable from real ones. Nothing at
//     this end can tell the difference; a URL is the only thing that can.

/** One paragraph of the brief. `mono` is for the block somebody copies. */
export interface BriefBlock {
  heading?: string;
  lines: string[];
  mono?: boolean;
}

export interface BriefMeta {
  household: string;
  /** The property's name — "Home", "The bach". */
  place: string;
  /** "Mount Eden, Auckland", or null when the place has not said. */
  where: string | null;
  /** The scope chip's own words, the same string the subtitle carries. */
  scope: string;
  stamp: string;
  rowCount: number;
  /** How many photographs actually ride in this file, after the cap. */
  photoCount: number;
}

/** The fence the answer has to come back in, and what the parser looks for. */
export const ACTIONS_FENCE = 'snag-actions';

/**
 * The page at the front of a briefed PDF.
 *
 * Returned as blocks rather than a string so the renderer can page-break
 * between paragraphs and set the copy-me block in a mono face, and so the
 * wording can be asserted without a PDF.
 */
export function assessmentBrief(meta: BriefMeta): { title: string; blocks: BriefBlock[] } {
  const at = meta.where ? `${meta.place}, ${meta.where}` : meta.place;

  return {
    title: 'For whoever is assessing this list',
    blocks: [
      {
        lines: [
          `${meta.rowCount} ${meta.rowCount === 1 ? 'job' : 'jobs'} around a house at ${at}, `
          + `taken out of the Snag app on ${meta.stamp}. Please work through them one at a time `
          + 'and say what each one looks like, whether somebody living here can do it, and what '
          + 'it would take.',
          `Every job carries a reference — SNAG-0042 and so on, in the first column. Use those: `
          + 'they are how the answers get filed back against the right job.',
          `This file holds ${meta.scope.toLowerCase()}. Skip any row whose Status reads Done — `
          + 'that work is finished.',
        ],
      },
      {
        heading: 'The photographs',
        lines: [
          meta.photoCount > 0
            ? `${meta.photoCount} ${meta.photoCount === 1 ? 'photograph follows' : 'photographs follow'} `
              + 'the table, each captioned with its job’s reference and the room it is in.'
            : 'There are no photographs in this file.',
          'Not every job has one, and a photograph of a damp patch cannot say what is behind the '
          + 'wall. Where you cannot tell, say so and say what you would need to see — a guess '
          + 'stated confidently is worse than no answer, because somebody will act on it.',
        ],
      },
      {
        heading: 'For each job',
        lines: [
          '1. What appears to be wrong, in a sentence or two.',
          '2. Whether somebody living here can do it, or whether it needs a tradesman.',
          '3. If they can: what to buy, where to buy it in New Zealand, roughly what that costs, '
          + 'and no more than five short steps.',
          '4. If it needs a tradesman: which trade, why, and three of them (see below).',
        ],
      },
      {
        heading: 'Work a householder must not do',
        lines: [
          'These are never do-it-yourself in New Zealand, whatever the photograph shows. Name the '
          + 'trade and say why, and do not offer steps:',
          '• Prescribed electrical work — a registered electrician (EWRB).',
          '• Gasfitting, and most plumbing and drainlaying — PGDB registered.',
          '• Building work needing a consent or a Licensed Building Practitioner.',
          '• Anything that might disturb asbestos, which includes most disturbance of linings, '
          + 'soffits or textured ceilings in a house built before 2000.',
          '• Work at height on a roof.',
        ],
      },
      {
        heading: 'Naming a tradesman',
        lines: [
          'Search for each one, and give the business name, a phone number, a link, and the address '
          + 'of the page you found it on. An entry with no source is no use here: nothing at this '
          + 'end can tell a real firm from a plausible name, so an unsourced one is thrown away '
          + 'rather than shown.',
          'If you cannot source three, give two, or one, or say none found. Do not fill the gap. '
          + 'Prefer firms on the relevant public register, and say where that can be checked.',
          'Give two costs rather than one: what it costs to get them to the door, and the likely '
          + 'total as a range. A callout fee and a total are decided on differently — four jobs '
          + 'booked into one visit pay the callout once — and say that both are indicative.',
        ],
      },
      {
        heading: 'Finish with this block',
        lines: [
          'Everything above is for a person to read. This is for the app: one fenced block at the '
          + 'very end, holding the same answers keyed by reference. Leave out anything you have no '
          + 'answer for. Keep money as text, exactly as you wrote it — it is quoted back with '
          + 'today’s date beside it, never turned into a number.',
          '"verdict" is one of diy, trade or unclear. "need_to_see" is for the unclear ones.',
        ],
      },
      {
        mono: true,
        lines: [
          '```' + ACTIONS_FENCE,
          '{',
          '  "SNAG-0042": {',
          '    "diagnosis": "...",',
          '    "verdict": "trade",',
          '    "reason": "...",',
          '    "need_to_see": null,',
          '    "steps": ["...", "..."],',
          '    "parts": [{ "item": "...", "where": "Mitre 10", "approx_nzd": "35-45" }],',
          '    "trade": "plumber",',
          '    "tradies": [{ "name": "...", "phone": "...", "url": "...",',
          '                  "source": "...", "callout_nzd": "95", "total_nzd": "180-260" }]',
          '  }',
          '}',
          '```',
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------- the answer

/** One answer, before it has been matched to a snag. */
export interface ParsedAdvice {
  reference: string;
  diagnosis: string;
  verdict: AdviceVerdict;
  reason: string | null;
  steps: string[];
  parts: AdvicePart[];
  trade: string | null;
  tradies: AdviceTradie[];
  needToSee: string | null;
}

const VERDICTS: AdviceVerdict[] = ['diy', 'trade', 'unclear'];

/** Everything pasted in is somebody else's text. Trim it, cap it, or drop it. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function textList(value: unknown, max: number, each: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => text(entry, each))
    .filter((entry): entry is string => entry !== null)
    .slice(0, max);
}

const PART_LIMIT = 20;
const TRADIE_LIMIT = 5;
const STEP_LIMIT = 8;

function parseParts(value: unknown): AdvicePart[] {
  if (!Array.isArray(value)) return [];
  const out: AdvicePart[] = [];
  for (const entry of value) {
    // A bare string is a perfectly good part, and an answer that gives one
    // should not lose the part because it skipped the shop.
    if (typeof entry === 'string') {
      const item = text(entry, 60);
      if (item) out.push({ item, where: null, approxNzd: null });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Row;
    const item = text(row.item, 60);
    if (!item) continue;
    out.push({
      item,
      where: text(row.where, 60),
      approxNzd: text(row.approx_nzd ?? row.approxNzd, 40),
    });
    if (out.length === PART_LIMIT) break;
  }
  return out;
}

/**
 * **A tradesman with no source is dropped, not shown unsourced.**
 *
 * This is the one place the parser throws away something an answer went to the
 * trouble of providing, and it is deliberate. A name and a mobile number are
 * the easiest things in the world to produce and the hardest thing here to
 * check; the URL is the only part of the row that can be followed. Keeping the
 * unsourced ones behind a warning would mean the household's own list holds
 * phone numbers nobody can account for — which is the failure the invitation
 * screen already taught this codebase: the row was never the problem, the
 * unverifiable claim was.
 */
function parseTradies(value: unknown): AdviceTradie[] {
  if (!Array.isArray(value)) return [];
  const out: AdviceTradie[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Row;
    const name = text(row.name, 80);
    const source = text(row.source, 300);
    if (!name || !source) continue;
    out.push({
      name,
      phone: text(row.phone, 30),
      url: text(row.url, 300),
      source,
      calloutNzd: text(row.callout_nzd ?? row.calloutNzd, 40),
      totalNzd: text(row.total_nzd ?? row.totalNzd, 40),
    });
    if (out.length === TRADIE_LIMIT) break;
  }
  return out;
}

/** The JSON out of a reply, wherever in it the reply chose to put it. */
function findBlock(reply: string): string | null {
  const fenced = new RegExp('```\\s*' + ACTIONS_FENCE + '\\s*([\\s\\S]*?)```', 'i').exec(reply);
  if (fenced) return fenced[1];

  const json = /```\s*json\s*([\s\S]*?)```/i.exec(reply);
  if (json) return json[1];

  // No fence at all: somebody pasted the block on its own, or a reply used a
  // heading instead. The outermost braces are the best guess available, and a
  // wrong guess fails as a parse error rather than as silence.
  const open = reply.indexOf('{');
  const close = reply.lastIndexOf('}');
  return open >= 0 && close > open ? reply.slice(open, close + 1) : null;
}

/**
 * Turn a pasted reply into answers.
 *
 * **Never throws, and says what went wrong in words.** The one thing somebody
 * doing this actually needs to know is whether the paste worked, and the three
 * ways it doesn't — nothing pasted, no block in it, the block isn't JSON — are
 * three different mistakes with three different fixes.
 *
 * Takes either an object keyed by reference or an array of objects each naming
 * their own, because both are what comes back and the difference is not worth
 * a second round trip to the person holding the phone.
 */
export function parseSnagActions(reply: string): { entries: ParsedAdvice[]; error: string | null } {
  if (!reply.trim()) return { entries: [], error: 'Nothing pasted yet.' };

  const block = findBlock(reply);
  if (!block) {
    return {
      entries: [],
      error: `No ${ACTIONS_FENCE} block in that. Paste the whole reply, including the block at the end.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return { entries: [], error: "That block isn't readable — it may have been cut off part way." };
  }

  const rows: [string, Row][] = [];
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Row;
      const reference = text(row.reference ?? row.ref, 40);
      if (reference) rows.push([reference, row]);
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed as Row)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) rows.push([key, value as Row]);
    }
  }

  const entries: ParsedAdvice[] = [];
  const seen = new Set<string>();
  for (const [rawReference, row] of rows) {
    const reference = rawReference.trim().toUpperCase();
    if (!reference || seen.has(reference)) continue;

    const verdictText = text(row.verdict, 20)?.toLowerCase() ?? '';
    const advice: ParsedAdvice = {
      reference,
      diagnosis: text(row.diagnosis, 600) ?? '',
      verdict: (VERDICTS as string[]).includes(verdictText)
        ? (verdictText as AdviceVerdict)
        : 'unclear',
      reason: text(row.reason, 400),
      steps: textList(row.steps, STEP_LIMIT, 200),
      parts: parseParts(row.parts),
      trade: text(row.trade, 40),
      tradies: parseTradies(row.tradies),
      needToSee: text(row.need_to_see ?? row.needToSee, 300),
    };

    // An entry that answered nothing is not an answer. Applying it would stamp
    // a date and a source onto a snag and tell the household nothing at all.
    const saidSomething = advice.diagnosis || advice.steps.length > 0
      || advice.parts.length > 0 || advice.tradies.length > 0 || advice.needToSee;
    if (!saidSomething) continue;

    seen.add(reference);
    entries.push(advice);
  }

  if (entries.length === 0) {
    return { entries: [], error: 'That block had no answers in it.' };
  }
  return { entries, error: null };
}

/**
 * Line the answers up against the snags they claim to be about.
 *
 * **A reference that isn't in hand is dropped and named, never guessed at.**
 * The list passed in is what this person can see in this place, so an unknown
 * reference is either a job from somewhere else, a job since deleted, or an
 * invention — and all three are the same answer: it is not written, and the
 * review screen says which ones were skipped rather than quietly applying
 * eleven of twelve.
 */
export function matchAdviceToSnags(
  entries: ParsedAdvice[],
  snags: Snag[]
): { matched: { snag: Snag; advice: ParsedAdvice }[]; unknown: string[] } {
  const byReference = new Map(snags.map((snag) => [snag.reference.toUpperCase(), snag]));
  const matched: { snag: Snag; advice: ParsedAdvice }[] = [];
  const unknown: string[] = [];

  for (const advice of entries) {
    const snag = byReference.get(advice.reference);
    if (snag) matched.push({ snag, advice });
    else unknown.push(advice.reference);
  }

  return { matched, unknown };
}

/**
 * The advice on one snag, or null.
 *
 * Read from the table rather than through `snags_with_details`, deliberately:
 * the list is the screen people open constantly and this serves one detail
 * page. Adding it to the view would make every list read carry a join for
 * something only one screen shows.
 */
export async function getSnagAdvice(
  client: SupabaseClient,
  snagId: string
): Promise<SnagAdvice | null> {
  const { data, error } = await client
    .from('snag_advice')
    .select('*')
    .eq('snag_id', snagId)
    .maybeSingle();

  if (error) throw asError(error, "Couldn't load the assessment");
  return data ? mapAdvice(data as Row) : null;
}

function mapAdvice(row: Row): SnagAdvice {
  return {
    snagId: row.snag_id,
    diagnosis: row.diagnosis,
    verdict: row.verdict,
    reason: row.reason ?? null,
    steps: row.steps ?? [],
    // Written as the shape it is read as, so nothing has to agree about a
    // second spelling of the same field.
    parts: (row.parts ?? []) as AdvicePart[],
    trade: row.trade ?? null,
    tradies: (row.tradies ?? []) as AdviceTradie[],
    needToSee: row.need_to_see ?? null,
    source: row.source,
    createdAt: row.created_at,
  };
}

/**
 * File one answer against one snag.
 *
 * **This writes nothing to the snag.** Its parts are proposals until somebody
 * accepts one, at which point that goes through `updateSnag` like any other
 * part — and starts the job, correctly, because filling the shopping list is
 * the act that starts it. See the migration header for why the whole reply
 * cannot simply be applied.
 */
export async function recordSnagAdvice(
  client: SupabaseClient,
  snagId: string,
  advice: Omit<ParsedAdvice, 'reference'>,
  source: string
): Promise<SnagAdvice> {
  const { data, error } = await client.rpc('record_snag_advice', {
    p_snag_id: snagId,
    p_diagnosis: advice.diagnosis,
    p_verdict: advice.verdict,
    p_source: source,
    p_reason: advice.reason,
    p_steps: advice.steps,
    p_parts: advice.parts,
    p_trade: advice.trade,
    p_tradies: advice.tradies,
    p_need_to_see: advice.needToSee,
  });
  return mapAdvice(unwrap<Row>(data, error, "Couldn't save that assessment"));
}

export async function deleteSnagAdvice(client: SupabaseClient, snagId: string): Promise<void> {
  const { error } = await client.rpc('delete_snag_advice', { p_snag_id: snagId });
  if (error) throw asError(error, "Couldn't remove that assessment");
}

/**
 * `08/11/2019` — a stored date written the way a date control asks for it.
 *
 * Deliberately not `formatLooseDate`, which answers in words and drops a day it
 * would have had to invent ("Nov 2019"). This is what the calendar writes back
 * into the field it sits beside, so it has to be a form `parseLooseDate` reads
 * exactly — the two halves of one control must round-trip, or tapping a day
 * and then leaving the field would change the answer.
 */
export function formatDayFirst(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/** "Pasted 15 Sep" — the source line under the advice. */
export function adviceSource(now = new Date()): string {
  return `Pasted ${now.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}`;
}

// ---------------------------------------------------------------- projects
//
// What we're *changing*, beside what's wrong and what's there.
//
// Everything below obeys one rule that the rest of this file does not have to
// think about: **a total always ships its denominator**. `ProjectTotals` carries
// `itemCount` and `pricedCount` in the same object as `committedTotal`, the view
// computes all three in the same row, and `describeTotals` is what a screen
// renders under a figure. A renovation total assembled from half the items is
// the most misleading number this app could show.

function mapProject(row: Row): Project {
  return {
    id: row.id,
    householdId: row.household_id,
    propertyId: row.property_id,
    name: row.name,
    summary: row.summary ?? null,
    status: row.status,
    startedOn: row.started_on ?? null,
    targetOn: row.target_on ?? null,
    finishedOn: row.finished_on ?? null,
    // numeric comes back from PostgREST as a string, because a JS number cannot
    // hold every numeric. Money here is dollars and cents on a household
    // renovation, which a double carries exactly at this scale — but the parse
    // has to happen somewhere, and doing it once here is better than every
    // caller discovering it separately.
    budget: numberOrNull(row.budget),
    budgetInclGst: row.budget_incl_gst !== false,
    photoPaths: row.photo_paths ?? [],
    documentPaths: row.document_paths ?? [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    propertyName: row.property_name,
    createdByName: row.created_by_name,
    elementCount: row.element_count ?? 0,
    shownElementCount: row.shown_element_count ?? 0,
    fileCount: row.file_count ?? 0,
    snagCount: row.snag_count ?? 0,
    openSnagCount: row.open_snag_count ?? 0,
    thingCount: row.thing_count ?? 0,
    installedCount: row.installed_count ?? 0,
    itemCount: row.item_count ?? 0,
    pricedCount: row.priced_count ?? 0,
    quotedCount: row.quoted_count ?? 0,
    committedTotal: numberOrNull(row.committed_total),
    invoicedTotal: numberOrNull(row.invoiced_total),
    paidTotal: numberOrNull(row.paid_total),
    allowanceOpen: numberOrNull(row.allowance_open) ?? 0,
    additionalOpen: numberOrNull(row.additional_open) ?? 0,
    partsBudgetTotal: numberOrNull(row.parts_budget_total),
    partsBudgetedCount: row.parts_budgeted_count ?? 0,
    forecastTotal: numberOrNull(row.forecast_total),
    forecastDerived: numberOrNull(row.forecast_derived),
    committedDerived: numberOrNull(row.committed_derived),
    invoicedDerived: numberOrNull(row.invoiced_derived),
    paidDerived: numberOrNull(row.paid_derived),
    forecastOverride: numberOrNull(row.forecast_override),
    committedOverride: numberOrNull(row.committed_override),
    invoicedOverride: numberOrNull(row.invoiced_override),
    paidOverride: numberOrNull(row.paid_override),
    forecastNote: row.forecast_note ?? null,
    committedNote: row.committed_note ?? null,
    invoicedNote: row.invoiced_note ?? null,
    paidNote: row.paid_note ?? null,
    partsEditedCount: row.parts_edited_count ?? 0,
    forecastGuess: numberOrNull(row.forecast_guess) ?? 0,
    expectedOpen: numberOrNull(row.expected_open) ?? 0,
    expectedCount: row.expected_count ?? 0,
    expectedConfirmed: numberOrNull(row.expected_confirmed),
    budgetGap: numberOrNull(row.budget_gap) ?? 0,
    stillToBill: numberOrNull(row.still_to_bill),
    dueToPay: numberOrNull(row.due_to_pay) ?? 0,
    overdueTotal: numberOrNull(row.overdue_total) ?? 0,
    nextDueOn: row.next_due_on ?? null,
    dueCount: row.due_count ?? 0,
  };
}

/**
 * Null stays null, and that is the whole job.
 *
 * `Number(null)` is 0, which is exactly the lie this feature cannot tell: an
 * item nobody has priced must not read as an item that costs nothing.
 */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapElement(row: Row): ProjectElement {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    room: row.room ?? null,
    implicit: !!row.implicit,
    sortOrder: row.sort_order ?? 0,
    notes: row.notes ?? null,
    budget: numberOrNull(row.budget),
    budgetInclGst: row.budget_incl_gst !== false,
    photoPaths: row.photo_paths ?? [],
    documentPaths: row.document_paths ?? [],
    createdAt: row.created_at,
    itemCount: row.item_count ?? 0,
    pricedCount: row.priced_count ?? 0,
    quotedCount: row.quoted_count ?? 0,
    committedTotal: numberOrNull(row.committed_total),
    invoicedTotal: numberOrNull(row.invoiced_total),
    paidTotal: numberOrNull(row.paid_total),
    allowanceOpen: numberOrNull(row.allowance_open) ?? 0,
    additionalOpen: numberOrNull(row.additional_open) ?? 0,
    expectedOpen: numberOrNull(row.expected_open) ?? 0,
    expectedCount: row.expected_count ?? 0,
    expectedConfirmed: numberOrNull(row.expected_confirmed),
    budgetGap: numberOrNull(row.budget_gap) ?? 0,
    committedDerived: numberOrNull(row.committed_derived),
    invoicedDerived: numberOrNull(row.invoiced_derived),
    paidDerived: numberOrNull(row.paid_derived),
    committedOverride: numberOrNull(row.committed_override),
    invoicedOverride: numberOrNull(row.invoiced_override),
    paidOverride: numberOrNull(row.paid_override),
    committedNote: row.committed_note ?? null,
    invoicedNote: row.invoiced_note ?? null,
    paidNote: row.paid_note ?? null,
  };
}

function mapItem(row: Row): ProjectItem {
  return {
    id: row.id,
    elementId: row.element_id,
    name: row.name,
    status: row.status,
    sortOrder: row.sort_order ?? 0,
    notes: row.notes ?? null,
    photoPaths: row.photo_paths ?? [],
    documentPaths: row.document_paths ?? [],
    createdAt: row.created_at,
    excluded: row.excluded ?? false,
    quoteCount: row.quote_count ?? 0,
    tbcCount: row.tbc_count ?? 0,
    committed: numberOrNull(row.committed),
    invoiced: numberOrNull(row.invoiced),
    paid: numberOrNull(row.paid),
    allowanceOpen: numberOrNull(row.allowance_open) ?? 0,
    additionalOpen: numberOrNull(row.additional_open) ?? 0,
    setAsideLineId: row.set_aside_line_id ?? null,
  };
}

function mapQuote(row: Row): ProjectQuote {
  return {
    id: row.id,
    itemId: row.item_id ?? null,
    elementId: row.element_id ?? null,
    projectId: row.project_id ?? null,
    supplier: row.supplier ?? null,
    detail: row.detail ?? null,
    amount: numberOrNull(row.amount),
    amountInclGst: row.amount_incl_gst !== false,
    kind: row.kind,
    status: row.status ?? 'tbc',
    basis: row.basis ?? 'fixed',
    dated: row.dated ?? null,
    notes: row.notes ?? null,
    supersedesLineId: row.supersedes_line_id ?? null,
    dueOn: row.due_on ?? null,
    billedThroughId: row.billed_through_id ?? null,
    settlesMilestoneId: row.settles_milestone_id ?? null,
    againstQuoteId: row.against_quote_id ?? null,
    photoPaths: row.photo_paths ?? [],
    documentPaths: row.document_paths ?? [],
    createdAt: row.created_at,
    amountIncl: numberOrNull(row.amount_incl),
    lineCount: row.line_count ?? 0,
    linesTotal: numberOrNull(row.lines_total),
    buildUp: numberOrNull(row.build_up),
    allowanceOpen: numberOrNull(row.allowance_open) ?? 0,
    additionalOpen: numberOrNull(row.additional_open) ?? 0,
    effectiveAmount: numberOrNull(row.effective_amount),
    paidTotal: numberOrNull(row.paid_total),
    unpaid: numberOrNull(row.unpaid),
    claimedTotal: numberOrNull(row.claimed_total),
  };
}

function mapQuoteRoom(row: Row): ProjectQuoteRoom {
  return {
    quoteId: row.quote_id,
    elementId: row.element_id,
    amount: numberOrNull(row.amount),
    sortOrder: row.sort_order ?? 0,
  };
}

function mapQuoteLine(row: Row): ProjectQuoteLine {
  return {
    id: row.id,
    quoteId: row.quote_id,
    name: row.name,
    detail: row.detail ?? null,
    amount: numberOrNull(row.amount),
    amountInclGst: row.amount_incl_gst !== false,
    isAllowance: !!row.is_allowance,
    allowanceKind: row.allowance_kind ?? null,
    additional: !!row.additional,
    attendancePct: numberOrNull(row.attendance_pct),
    sortOrder: row.sort_order ?? 0,
  };
}

function mapPayment(row: Row): ProjectPayment {
  return {
    id: row.id,
    quoteId: row.quote_id,
    amount: numberOrNull(row.amount) ?? 0,
    amountInclGst: row.amount_incl_gst !== false,
    paidOn: row.paid_on ?? null,
    reference: row.reference ?? null,
    notes: row.notes ?? null,
    photoPaths: row.photo_paths ?? [],
    documentPaths: row.document_paths ?? [],
    createdAt: row.created_at,
  };
}

function mapSupplierTotals(row: Row): ProjectSupplierTotals {
  return {
    projectId: row.project_id,
    supplierKey: row.supplier_key ?? '',
    supplier: row.supplier ?? null,
    quoted: numberOrNull(row.quoted),
    committed: numberOrNull(row.committed),
    invoiced: numberOrNull(row.invoiced),
    paid: numberOrNull(row.paid),
    unpaid: numberOrNull(row.unpaid),
    nextDueOn: row.next_due_on ?? null,
    tbcCount: row.tbc_count ?? 0,
  };
}

function mapExpectedCost(row: Row): ProjectExpectedCost {
  return {
    id: row.id,
    projectId: row.project_id,
    elementId: row.element_id ?? null,
    name: row.name,
    amount: numberOrNull(row.amount),
    amountInclGst: row.amount_incl_gst !== false,
    likelySupplier: row.likely_supplier ?? null,
    note: row.note ?? null,
    confirmed: !!row.confirmed,
    settledBy: row.settled_by ?? null,
    createdAt: row.created_at,
  };
}

function mapExpectedCostLine(row: Row): ProjectExpectedCostLine {
  return {
    id: row.id,
    expectedCostId: row.expected_cost_id,
    name: row.name,
    reference: row.reference ?? null,
    amount: numberOrNull(row.amount),
    amountInclGst: row.amount_incl_gst !== false,
    photoPaths: row.photo_paths ?? [],
    documentPaths: row.document_paths ?? [],
    createdAt: row.created_at,
  };
}

function mapMilestone(row: Row): ProjectMilestone {
  return {
    id: row.id,
    quoteId: row.quote_id,
    name: row.name,
    percent: numberOrNull(row.percent),
    amount: numberOrNull(row.amount),
    amountInclGst: row.amount_incl_gst !== false,
    dueOn: row.due_on ?? null,
    sortOrder: row.sort_order ?? 0,
  };
}

function mapBill(row: Row): ProjectBill {
  return {
    id: row.id,
    projectId: row.project_id,
    supplier: row.supplier ?? null,
    detail: row.detail ?? null,
    dated: row.dated ?? null,
    dueOn: row.due_on ?? null,
    billedThroughId: row.billed_through_id ?? null,
    settlesMilestoneId: row.settles_milestone_id ?? null,
    amountIncl: numberOrNull(row.amount_incl),
    paidTotal: numberOrNull(row.paid_total),
    unpaid: numberOrNull(row.unpaid),
    overdue: !!row.overdue,
  };
}

function mapInvoiceReview(row: Row): InvoiceReview {
  return {
    id: row.id,
    projectId: row.project_id,
    elementId: row.element_id ?? null,
    supplier: row.supplier ?? null,
    detail: row.detail ?? null,
    // `numberOrNull`, not `Number`, for the reason it exists everywhere else
    // in this file: `Number(null)` is 0, and an invoice nobody has priced is
    // not an invoice for nothing.
    amount: numberOrNull(row.amount),
    amountInclGst: row.amount_incl_gst !== false,
    invoiceNumber: row.invoice_number ?? null,
    dated: row.dated ?? null,
    dueOn: row.due_on ?? null,
    paid: !!row.paid,
    paidOn: row.paid_on ?? null,
    paidEvidence: row.paid_evidence ?? null,
    category: row.category ?? null,
    sourceRef: row.source_ref ?? null,
    sourceSubject: row.source_subject ?? null,
    sourceFrom: row.source_from ?? null,
    sourceAt: row.source_at ?? null,
    inferred: row.inferred ?? [],
    state: row.state ?? 'pending',
    quoteId: row.quote_id ?? null,
    decidedAt: row.decided_at ?? null,
    createdAt: row.created_at,
    photoPaths: row.photo_paths ?? [],
    documentPaths: row.document_paths ?? [],
    roomIds: row.room_ids ?? [],
    roomAmounts: Array.isArray(row.room_amounts)
      ? row.room_amounts.map((a: unknown) => numberOrNull(a) ?? 0)
      : null,
  };
}

function mapOverride(row: Row): ProjectOverride {
  return {
    id: row.id,
    projectId: row.project_id,
    elementId: row.element_id ?? null,
    field: row.field,
    amount: numberOrNull(row.amount) ?? 0,
    amountInclGst: row.amount_incl_gst !== false,
    note: row.note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectFile(row: Row): ProjectFile {
  return {
    projectId: row.project_id,
    level: row.level,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    kind: row.kind,
    path: row.path,
  };
}

// ------------------------------------------------------------- money, purely

/**
 * The client's copy of `home.incl_gst`, and the two must agree.
 *
 * An amount is always a pair — the figure as typed, and whether it already
 * includes GST. Rollups normalise to inclusive because that is what leaves the
 * bank account; a screen showing one quote shows what was typed, with the pill
 * beside it saying which it was.
 */
export function inclGst(amount: number | null, alreadyIncl: boolean): number | null {
  if (amount === null) return null;
  const gross = alreadyIncl ? amount : amount * (1 + GST_RATE);
  return Math.round(gross * 100) / 100;
}

/**
 * "$8,990" — whole dollars unless there are cents to show.
 *
 * A renovation is argued about in dollars, and `$8,990.00` on a card is two
 * characters of noise on every row. Cents survive when they are there, because
 * an invoice for $1,240.55 is a number somebody will reconcile against a bank
 * statement.
 */
export function formatMoney(amount: number | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  const rounded = Math.round(amount * 100) / 100;
  const hasCents = Math.abs(rounded % 1) > 0.004;
  return `$${rounded.toLocaleString('en-NZ', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })}`;
}

/**
 * What is still to go out on work already agreed.
 *
 * Committed less paid, and deliberately not invoiced less paid — that is a
 * different and shorter-horizon question, and the one this answers is "how much
 * of this renovation have we still to find".
 *
 * Null only when nothing has been committed at all. Never negative: a supplier
 * paid more than they are owed is a data-entry mistake, not a negative debt, and
 * showing it as one would be the screen doing arithmetic instead of reporting.
 */
export function outstanding(totals: {
  committedTotal: number | null;
  paidTotal: number | null;
}): number | null {
  if (totals.committedTotal === null) return null;
  return Math.max(0, totals.committedTotal - (totals.paidTotal ?? 0));
}

/**
 * What the suppliers have said, which is the line above Committed.
 *
 * **It is the sum of the supplier rows, deliberately, and it is the only thing
 * that writes the figure.** Every money line on the project page opens to show
 * the rows it is made of, and that is honest only while the rows add up to the
 * line. A second expression in `projects_with_totals` would be a second path to
 * one number, which is how a number starts disagreeing with itself — the
 * failure this money model names about `needs_parts` and about the element
 * layer, one figure further on.
 *
 * Null when nobody has quoted anything, never zero: a job where three prices
 * are in and a job where nobody has been asked are different states, and the
 * whole reason this line sits above Committed is to tell them apart.
 */
export function projectQuoted(
  suppliers: readonly { quoted: number | null }[]
): number | null {
  const priced = suppliers.filter((s) => s.quoted !== null);
  if (priced.length === 0) return null;
  return priced.reduce((sum, s) => sum + (s.quoted ?? 0), 0);
}

/**
 * Which supplier figure a money line opens onto.
 *
 * Budget and Forecast are absent on purpose. A budget is what somebody typed
 * and no supplier has said anything about it; a forecast is committed plus
 * three kinds of guess, two of which are by definition money nobody has quoted
 * — attributing either to named suppliers would be the page inventing a debt.
 */
export type SupplierFigure = 'quoted' | 'committed' | 'invoiced' | 'paid';

/**
 * The rows under one money line: who it is made of, largest first.
 *
 * A supplier with nothing against that figure is left out rather than drawn as
 * a zero — "Tile Space, nothing invoiced" is not part of what Invoiced is made
 * of, and a list of noughts is how a breakdown stops being read.
 */
export function supplierBreakdown<T extends Record<SupplierFigure, number | null>>(
  suppliers: readonly T[],
  figure: SupplierFigure
): { row: T; amount: number }[] {
  return suppliers
    .filter((s) => s[figure] !== null && Math.abs(s[figure] as number) > 0.005)
    .map((row) => ({ row, amount: row[figure] as number }))
    .sort((a, b) => b.amount - a.amount);
}

// ------------------------------------------- recording money, one step at a time

/**
 * A name to offer on the walkthrough's first step, and what you have from them.
 *
 * **Supplier stays free text and this is the whole of the "select or create".**
 * A supplier list somebody has to fill in before they can record a quote is
 * setup, and this app does not do setup — so the list *is* the names already
 * used, and a name that is not on it is typed and added in the same control.
 */
export interface SupplierSuggestion {
  name: string;
  /** The one line under the name: what this job already has from them. */
  note: string | null;
  /**
   * Their signed contract on this job, when there is exactly one.
   *
   * What makes step two able to offer *a claim against it* rather than asking
   * a question the person has to translate. Null when they have none, or more
   * than one — with two contracts the claim has to say which, so the shortcut
   * would be guessing.
   */
  contract: ProjectQuote | null;
  /** True when the name comes from another job rather than this one. */
  elsewhere: boolean;
}

/**
 * Who to offer, this job's suppliers first.
 *
 * Names from elsewhere in the household follow, because starting a second job
 * and being offered nothing is how "ReliaBuilder" and "Reliabuilder" end up in
 * one household — which is exactly what happened here. Deduplicated on the
 * trimmed, lower-cased name, the same key the supplier rollup groups on.
 */
export function supplierSuggestions(
  onThisJob: readonly ProjectQuote[],
  elsewhereNames: readonly string[]
): SupplierSuggestion[] {
  const byKey = new Map<string, ProjectQuote[]>();
  for (const quote of onThisJob) {
    const name = quote.supplier?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    byKey.set(key, [...(byKey.get(key) ?? []), quote]);
  }

  const here: SupplierSuggestion[] = [...byKey.entries()].map(([, quotes]) => {
    const signed = quotes.filter((q) => q.kind === 'quote' && q.status === 'accepted');
    const bills = quotes.filter((q) => q.kind === 'invoice' && q.status !== 'declined');
    const note = signed.length > 0
      ? `signed contract${bills.length > 0 ? ` · ${bills.length} claim${bills.length === 1 ? '' : 's'}` : ''}`
      : bills.length > 0
        ? `${bills.length} bill${bills.length === 1 ? '' : 's'}`
        : 'a price, not decided';
    return {
      // The spelling used most recently, as the rollup displays it.
      name: [...quotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].supplier!.trim(),
      note,
      contract: signed.length === 1 ? signed[0] : null,
      elsewhere: false,
    };
  });

  const seen = new Set(here.map((s) => s.name.toLowerCase()));
  const away: SupplierSuggestion[] = [];
  for (const raw of elsewhereNames) {
    const name = raw?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    away.push({ name, note: 'used on another job', contract: null, elsewhere: true });
  }

  return [...here.sort((a, b) => a.name.localeCompare(b.name)), ...away.sort((a, b) => a.name.localeCompare(b.name))];
}

/**
 * The names containing what somebody typed — `matchSuggestions`' rule again.
 *
 * Substring rather than prefix, because nobody hunting ReliaBuilder types
 * "relia", gets nothing, and thinks to try "build".
 */
export function matchSuppliers(
  suppliers: readonly SupplierSuggestion[],
  query: string
): SupplierSuggestion[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [...suppliers];
  return suppliers.filter((one) => one.name.toLowerCase().includes(wanted));
}

/**
 * What a contract has left to claim.
 *
 * Null unless it is a quote with a figure — nothing is not zero, and "still to
 * claim" against a price nobody has stated is not a number. Never negative:
 * a builder who has claimed more than the contract is an over-claim, which
 * `stillToBill` reports at the project level with its sign intact; here the
 * question is how much is left, and the answer is none.
 */
export function stillToClaim(contract: {
  kind: ProjectQuoteKind;
  effectiveAmount: number | null;
  claimedTotal: number | null;
}): number | null {
  if (contract.kind !== 'quote') return null;
  if (contract.effectiveAmount === null) return null;
  return Math.max(0, contract.effectiveAmount - (contract.claimedTotal ?? 0));
}

/**
 * *"$131,962.50 claimed of $176,755 — $44,792.50 still to claim."*
 *
 * The denominator rule, one figure further in: a claimed-so-far figure without
 * the contract it is claimed against is the same misleading half-number as a
 * total without its item count. Null where there is nothing to say.
 */
export function describeClaimed(contract: {
  kind: ProjectQuoteKind;
  effectiveAmount: number | null;
  claimedTotal: number | null;
}): string | null {
  const left = stillToClaim(contract);
  if (left === null) return null;
  const claimed = contract.claimedTotal ?? 0;
  if (claimed < 0.005) return `nothing claimed yet of ${formatMoney(contract.effectiveAmount)}`;
  return `${formatMoney(claimed)} claimed of ${formatMoney(contract.effectiveAmount)} — ${formatMoney(left)} still to claim`;
}

/**
 * The budget line: what was set, and whether what has been agreed is over it.
 *
 * Null when no budget was ever typed — the same rule as everywhere else here,
 * that an absent number is not a zero. The count of unpriced items is *not*
 * repeated in it: `describeTotals` already says that, immediately underneath,
 * and saying it twice reads as two different facts.
 */
export function describeBudget(project: {
  budget: number | null;
  budgetInclGst: boolean;
  committedTotal: number | null;
}): string | null {
  const budget = inclGst(project.budget, project.budgetInclGst);
  if (budget === null) return null;
  if (project.committedTotal === null) return 'nothing committed yet';
  const gap = project.committedTotal - budget;
  if (Math.abs(gap) < 0.005) return 'committed is exactly on it';
  const figure = formatMoney(Math.abs(gap));
  return gap > 0 ? `committed is ${figure} over it` : `committed is ${figure} under it`;
}

/**
 * What the parts have been budgeted, against what the project was.
 *
 * Both numbers are kept and this names the gap rather than resolving it. A
 * renovation is budgeted top-down and broken down later, and the breakdown
 * deliberately does not add up — the contingency lives nowhere. Silence when no
 * part carries a budget, because there is nothing to reconcile.
 */
export function describePartsBudget(project: {
  budget: number | null;
  budgetInclGst: boolean;
  partsBudgetTotal: number | null;
  partsBudgetedCount: number;
}): string | null {
  if (project.partsBudgetedCount === 0 || project.partsBudgetTotal === null) return null;
  const parts = formatMoney(project.partsBudgetTotal);
  const whole = inclGst(project.budget, project.budgetInclGst);
  if (whole === null) return `parts budgeted ${parts}`;
  const gap = project.partsBudgetTotal - whole;
  if (Math.abs(gap) < 0.005) return `parts budgeted ${parts}, the whole of the budget`;
  if (gap < 0) return `parts budgeted ${parts} of ${formatMoney(whole)} · ${formatMoney(-gap)} unallocated`;
  return `parts budgeted ${parts} — ${formatMoney(gap)} more than the budget`;
}

/**
 * How much of a recomputed figure is still somebody's guess.
 *
 * Rule 3 of the money model, and the reason it is a function rather than a
 * sentence each screen writes: a build-up a third of which the builder made up
 * is exactly as misleading as a total assembled from half the items, and the
 * denominator has to travel with it in both cases.
 *
 * Deliberately worded "still an allowance" and never "not priced" — an allowance
 * is somebody's written number and it counts towards the total; an unpriced item
 * is nothing and does not. Collapsing the two wordings collapses the
 * distinction.
 */
export function describeAllowance(totals: { allowanceOpen: number }): string | null {
  if (!(totals.allowanceOpen > 0)) return null;
  return `${formatMoney(totals.allowanceOpen)} still an allowance`;
}

/**
 * How far over budget the forecast is, as a fraction.
 *
 * Null when either half is missing — there is no variance against a budget
 * nobody typed, and saying "0%" there would be the screen inventing a
 * reassurance.
 */
export function forecastVariance(project: {
  budget: number | null;
  budgetInclGst: boolean;
  forecastTotal: number | null;
}): number | null {
  const budget = inclGst(project.budget, project.budgetInclGst);
  if (budget === null || budget === 0 || project.forecastTotal === null) return null;
  return (project.forecastTotal - budget) / budget;
}

/**
 * The threshold at which a variance is worth saying out loud.
 *
 * Five per cent, from the brief. It is a blunt number and that is the point: on
 * a $187,000 job it is $9,350, which is about the smallest overrun a household
 * would want interrupted for and well above the noise of a rounded quote.
 */
export const VARIANCE_THRESHOLD = 0.05;

/**
 * The denominator that has to ride with the forecast.
 *
 * Never the figure on its own. `$198,400 · 13 of 18 items priced · $11,200 of it
 * still a guess` — and the last clause is the one that makes a forecast
 * honest, because a forecast is by construction partly invented and a reader
 * cannot tell how much without being told.
 *
 * Deliberately says **"still a guess"** rather than reusing "still an
 * allowance": the guess here is the sum of three different things (an unanswered
 * allowance inside a contract, a ballpark outside one, and a cost nobody has
 * quoted) and collapsing them into the allowance's wording would claim they are
 * all somebody's written number, which two of them are not.
 */
export function describeForecast(project: {
  forecastTotal: number | null;
  forecastGuess: number;
  itemCount: number;
  pricedCount: number;
}): string | null {
  if (project.forecastTotal === null) return null;
  const parts = [`${project.pricedCount} of ${project.itemCount} items priced`];
  if (project.forecastGuess > 0.005) {
    parts.push(`${formatMoney(project.forecastGuess)} of it still a guess`);
  }
  return parts.join(' · ');
}

/**
 * The variance line, in words and with its cause.
 *
 * *"$11,400 over — four items aren't priced and $3,500 is still a guess."*
 * A percentage with no cause is a number people learn to ignore, so this names
 * what is driving it rather than printing the fraction.
 *
 * Silent below the threshold, and silent when the forecast is *under*, which is
 * deliberate: this is a warning, and a household that is under budget does not
 * need the app to keep mentioning it. `describeBudget` already says which side
 * of the line committed has landed, in both directions.
 */
export function describeForecastVariance(project: {
  budget: number | null;
  budgetInclGst: boolean;
  forecastTotal: number | null;
  forecastGuess: number;
  itemCount: number;
  pricedCount: number;
}): string | null {
  const variance = forecastVariance(project);
  if (variance === null || variance <= VARIANCE_THRESHOLD) return null;

  const budget = inclGst(project.budget, project.budgetInclGst);
  const over = (project.forecastTotal ?? 0) - (budget ?? 0);
  const causes: string[] = [];

  const unpriced = project.itemCount - project.pricedCount;
  if (unpriced > 0) {
    causes.push(unpriced === 1 ? '1 item isn\u2019t priced' : `${unpriced} items aren\u2019t priced`);
  }
  if (project.forecastGuess > 0.005) {
    causes.push(`${formatMoney(project.forecastGuess)} is still a guess`);
  }

  const head = `${formatMoney(over)} over budget`;
  return causes.length === 0 ? head : `${head} — ${causes.join(' and ')}`;
}

/**
 * How much of what has been agreed is still to come as a bill.
 *
 * *"ReliaBuilder have $88,780 of the contract left to claim."* The first of the
 * two gaps that used to live as one figure called Outstanding.
 *
 * **It reports an over-claim rather than hiding it.** A negative means somebody
 * has billed more than was ever committed, which is the single most useful thing
 * this subtraction can tell a householder, and flooring it at zero for tidiness
 * would throw exactly that away.
 */
export function describeStillToBill(project: { stillToBill: number | null }): string | null {
  if (project.stillToBill === null) return null;
  if (Math.abs(project.stillToBill) < 0.005) return 'everything committed has been billed';
  if (project.stillToBill < 0) {
    return `${formatMoney(-project.stillToBill)} billed beyond what was committed`;
  }
  return `${formatMoney(project.stillToBill)} still to be billed`;
}

/**
 * What is owed right now, and when.
 *
 * Named `describeToPay` rather than `describeDue`, which is already the snag
 * list's due-date phrasing. Two functions called the same thing on two kinds of
 * due date is how a screen ends up saying "3 days overdue" about an invoice.
 *
 * The only figure in this feature that is about **today** — everything else on
 * the page is a position, and this is a task. Null at zero, the same rule as
 * the shopping pill and *Fit* in the photo viewer: a line that can only say
 * "nothing owed" is a control dressed as a choice.
 *
 * Overdue leads when there is any, because that is the part somebody has to act
 * on first.
 */
export function describeToPay(project: {
  dueToPay: number;
  overdueTotal: number;
  nextDueOn: string | null;
  dueCount: number;
}): string | null {
  if (!(project.dueToPay > 0.005)) return null;
  if (project.overdueTotal > 0.005) {
    return `${formatMoney(project.overdueTotal)} overdue of ${formatMoney(project.dueToPay)}`;
  }
  const head = `${formatMoney(project.dueToPay)} to pay`;
  const when = formatLooseDate(project.nextDueOn);
  if (when) return `${head} · next due ${when}`;
  return project.dueCount === 1 ? `${head} · 1 bill` : `${head} · ${project.dueCount} bills`;
}

/**
 * What an allowance line is now reading, and by how much it has moved.
 *
 * Both tenses and **both directions**. A design that only warns on overruns
 * never tells anybody they got money back, and coming in under a ballpark is as
 * real an event as going over one — it is the reason the fittings supplier was
 * worth ringing.
 *
 * `quoted` is what somebody has since been quoted against the line, null while
 * nobody has.
 */
export function describeLineMovement(
  line: { name: string; amount: number | null; amountInclGst: boolean; additional: boolean },
  quoted: number | null,
  accepted: boolean
): string | null {
  const allowed = inclGst(line.amount, line.amountInclGst);
  if (allowed === null || quoted === null) return null;
  const gap = quoted - allowed;
  const tail = accepted ? '' : ', if you accept it';

  if (Math.abs(gap) < 0.005) {
    return `allowed ${formatMoney(allowed)}; quoted the same`;
  }
  const direction = gap > 0 ? 'over' : 'under';
  return `allowed ${formatMoney(allowed)}; quoted ${formatMoney(quoted)} — ${formatMoney(Math.abs(gap))} ${direction}${tail}`;
}

/**
 * What a payment schedule says is still to be claimed.
 *
 * A milestone carries a percentage or an amount; this resolves it against the
 * commitment it hangs off so both read the same way on screen.
 */
export function milestoneAmount(
  milestone: { percent: number | null; amount: number | null; amountInclGst: boolean },
  commitment: number | null
): number | null {
  if (milestone.amount !== null) return inclGst(milestone.amount, milestone.amountInclGst);
  if (milestone.percent === null || commitment === null) return null;
  return Math.round(commitment * (milestone.percent / 100) * 100) / 100;
}

/**
 * One edited figure, and what the prices say instead.
 *
 * *"Committed is edited: $200,000 typed · the prices say $103,574.22 —
 * $96,425.78 more."*
 *
 * **The derived figure is always named, never merely implied.** The whole reason
 * an override is honest rather than a lie is that both numbers survive; a note
 * saying only "this was edited" would throw away the half that makes it
 * recoverable, and a reader eight months later would have no way back to what
 * the paperwork actually supports.
 *
 * Returns null where nothing was typed, and also where the typed figure happens
 * to equal the derived one — an edit that changes nothing is not a discrepancy,
 * and saying so would be the screen manufacturing an alarm.
 */
export function describeOverride(
  label: string,
  override: number | null,
  derived: number | null,
  note?: string | null
): string | null {
  if (override === null) return null;

  const head = `${label} is edited: ${formatMoney(override)} typed`;
  if (derived === null) {
    return note
      ? `${head} · nothing priced yet to compare it with — ${note}`
      : `${head} · nothing priced yet to compare it with`;
  }

  const gap = override - derived;
  if (Math.abs(gap) < 0.005) {
    return note ? `${head} · the same as the prices — ${note}` : `${head} · the same as the prices`;
  }

  const direction = gap > 0 ? 'more' : 'less';
  const body = `${head} · the prices say ${formatMoney(derived)} — ${formatMoney(Math.abs(gap))} ${direction}`;
  return note ? `${body} — ${note}` : body;
}

/**
 * Every discrepancy an edited project is carrying, in the order they are read.
 *
 * Forecast first because it is the figure the page leads with, then the three
 * underneath it. A part's own edits are counted rather than listed: naming four
 * rooms here would put the parts list on the page twice, and the count is enough
 * to send somebody looking.
 */
export function describeOverrides(project: {
  forecastTotal: number | null; forecastDerived: number | null; forecastOverride: number | null;
  forecastNote: string | null;
  committedDerived: number | null; committedOverride: number | null; committedNote: string | null;
  invoicedDerived: number | null; invoicedOverride: number | null; invoicedNote: string | null;
  paidDerived: number | null; paidOverride: number | null; paidNote: string | null;
  partsEditedCount: number;
}): string[] {
  const lines = [
    describeOverride('Forecast', project.forecastOverride, project.forecastDerived, project.forecastNote),
    describeOverride('Committed', project.committedOverride, project.committedDerived, project.committedNote),
    describeOverride('Invoiced', project.invoicedOverride, project.invoicedDerived, project.invoicedNote),
    describeOverride('Paid', project.paidOverride, project.paidDerived, project.paidNote),
  ].filter((line): line is string => line !== null);

  if (project.partsEditedCount > 0) {
    lines.push(
      project.partsEditedCount === 1
        ? '1 part also has an edited figure.'
        : `${project.partsEditedCount} parts also have edited figures.`
    );
  }
  return lines;
}

/** Whether a figure on this level is somebody's rather than the paperwork's. */
export function isEdited(figure: number | null): boolean {
  return figure !== null;
}

/**
 * The line that has to sit under every total, and the reason this function
 * exists rather than each screen writing its own.
 *
 * Never `$8,990` on its own. Always `$8,990 · 5 of 9 items priced`. Returns
 * null only when there is nothing at all to count, because a denominator over
 * an empty project is noise rather than honesty.
 */
export function describeTotals(totals: ProjectTotals): string | null {
  if (totals.itemCount === 0) return describeAllowance(totals);
  const parts = [`${totals.pricedCount} of ${totals.itemCount} items priced`];
  if (totals.quotedCount > 0) {
    parts.push(
      totals.quotedCount === 1
        ? '1 quoted, not decided'
        : `${totals.quotedCount} quoted, not decided`
    );
  }
  const unpriced = totals.itemCount - totals.pricedCount - totals.quotedCount;
  if (unpriced > 0) {
    // Said out loud rather than left as arithmetic the reader has to do. An
    // item nobody has asked about is the gap between the total and the truth.
    parts.push(unpriced === 1 ? '1 not priced' : `${unpriced} not priced`);
  }
  const allowance = describeAllowance(totals);
  if (allowance) parts.push(allowance);
  return parts.join(' · ');
}

/**
 * What a quote reads once its allowances have been answered, when that differs
 * from what it says.
 *
 * Silence when the two agree, or when there are no lines at all: a build-up
 * identical to the amount above it is a figure repeated, and this screen has
 * enough numbers on it.
 */
export function describeBuildUp(quote: {
  amountIncl: number | null;
  buildUp: number | null;
  basis: ProjectQuoteBasis;
}): string | null {
  if (quote.basis === 'fixed') return null;
  if (quote.buildUp === null || quote.amountIncl === null) return null;
  if (Math.abs(quote.buildUp - quote.amountIncl) < 0.005) return null;
  return formatMoney(quote.buildUp);
}

/**
 * An allowance against what has actually been quoted for it — and the earliest
 * honest warning this app can give that a renovation is going over.
 *
 * It is a real number from a real quote, months before the invoice, and nothing
 * had to be estimated to produce it. Which is why there is no forecast anywhere
 * in this feature: this answers the same question without inventing anything.
 *
 * `accepted` decides the tense. A quote nobody has decided about is what it
 * *would* cost; an accepted one is what it does.
 */
export function describeLineVariance(line: {
  amount: number | null;
  amountInclGst: boolean;
  isAllowance: boolean;
}, answeredWith: number | null, accepted: boolean): string | null {
  if (!line.isAllowance) return null;
  const allowed = inclGst(line.amount, line.amountInclGst);
  if (allowed === null || answeredWith === null) return null;
  const gap = answeredWith - allowed;
  if (Math.abs(gap) < 0.005) return accepted ? 'exactly what was allowed' : null;
  const figure = formatMoney(Math.abs(gap));
  if (gap > 0) {
    return accepted ? `${figure} over the allowance` : `${figure} over, if you accept it`;
  }
  return accepted ? `${figure} under the allowance` : `${figure} under, if you accept it`;
}

/**
 * What an item's price line says.
 *
 * Three states, three different sentences, and the difference between them is
 * the difference between a decision made, a decision waiting, and a question
 * nobody has asked yet.
 */
export function itemPriceLabel(
  item: ProjectItem,
  quotes: ProjectQuote[] = []
): {
  text: string;
  state: 'committed' | 'undecided' | 'none';
} {
  if (item.committed !== null) {
    return { text: formatMoney(item.committed) ?? '', state: 'committed' };
  }

  // **One quote nobody has decided on shows its figure.** An item carries a
  // single active price now, so "1 price in" was the row refusing to say the
  // one thing it knew — somebody who has recorded $400 against the birthday
  // line wants to see $400, not to be told a price exists. It reads as
  // *undecided* rather than committed, which is what the colour says: slate,
  // the hue this app already spends on open.
  const undecided = quotes.filter(
    (quote) => quote.kind === 'quote' && quote.status === 'tbc'
  );
  if (undecided.length === 1 && undecided[0].amountIncl !== null) {
    return { text: formatMoney(undecided[0].amountIncl) ?? '', state: 'undecided' };
  }

  // Two or more, which only an item recorded before the single-price sheet can
  // be: a band across quotes nobody has picked reads as a figure, and what is
  // outstanding there is the decision rather than the money.
  if (item.tbcCount > 0) {
    return {
      text: item.tbcCount === 1 ? '1 price in' : `${item.tbcCount} prices in`,
      state: 'undecided',
    };
  }
  return { text: 'Not priced', state: 'none' };
}

/**
 * Whether the client draws the element layer at all.
 *
 * A project whose only element is `implicit` shows its items directly and never
 * says the word "element" — the layer has not earned its place. The server
 * reports this as `shownElementCount`, and this reads the elements themselves
 * for the screens that already have them in hand.
 */
export function showsElements(elements: ProjectElement[]): boolean {
  return elements.some((element) => !element.implicit);
}

/** Projects grouped for the tab, in `PROJECT_STATUS_ORDER`, empty groups dropped. */
export function groupProjectsByStatus(
  projects: Project[]
): { status: ProjectStatus; projects: Project[] }[] {
  return PROJECT_STATUS_ORDER.map((status) => ({
    status,
    projects: projects.filter((project) => project.status === status),
  })).filter((group) => group.projects.length > 0);
}

/**
 * The line under a project's name on a card.
 *
 * The rooms it touches, then when — because "which part of the house" and
 * "when" are the two things that tell two renovations apart at a glance, and
 * neither of them is the budget.
 */
export function projectSubtitle(project: Project, rooms: string[] = []): string {
  const parts: string[] = [];
  if (rooms.length) parts.push(rooms.join(' · '));
  if (project.status === 'done' && project.finishedOn) {
    parts.push(`finished ${formatLooseDate(project.finishedOn)}`);
  } else if (project.status === 'underway' && project.targetOn) {
    parts.push(`aiming for ${formatLooseDate(project.targetOn)}`);
  } else if (project.status === 'planned' && project.targetOn) {
    parts.push(formatLooseDate(project.targetOn));
  } else if (project.status === 'planned') {
    parts.push('no date yet');
  }
  return parts.join(' · ');
}

// ------------------------------------------------------------- reads

export async function getProjects(
  client: SupabaseClient,
  propertyId: string
): Promise<Project[]> {
  const { data, error } = await client
    .from('projects_with_totals')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });

  if (error) throw asError(error, "Couldn't load the projects");
  return (data ?? []).map(mapProject);
}

/**
 * Every project at every place this person is linked to.
 *
 * No property filter at all, which is the Schedule tab's own argument: a date is
 * not about a place, so answering "what were we doing that month" for the house
 * only — because the house is what the Projects tab happened to be showing — is
 * the wrong answer to the question. RLS and `property_members` decide the rest,
 * exactly as `getSnags({})` relies on them to.
 */
export async function getAllProjects(client: SupabaseClient): Promise<Project[]> {
  const { data, error } = await client
    .from('projects_with_totals')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw asError(error, "Couldn't load the projects");
  return (data ?? []).map(mapProject);
}

/**
 * Every supplier name this household has ever used, newest first.
 *
 * **Deliberately not filtered to one project.** Starting a second renovation
 * and being offered nothing is how one household ends up holding both
 * "ReliaBuilder" and "Reliabuilder" — which is what happened here, and what
 * `rename_supplier` then had to fix. RLS does the scoping, as ever: this
 * returns exactly the names on jobs this person can already see.
 *
 * One request, made when the walkthrough opens rather than on the project
 * page's own path — the pool is ten connections and this is not worth one of
 * them on every read of a project.
 */
export async function getSupplierNames(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client
    .from('project_quotes_with_totals')
    .select('supplier, created_at')
    .not('supplier', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw asError(error, "Couldn't load who you've used");

  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of (data ?? []) as Row[]) {
    const name = String(row.supplier ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export async function getProject(client: SupabaseClient, projectId: string): Promise<Project> {
  const { data, error } = await client
    .from('projects_with_totals')
    .select('*')
    .eq('id', projectId)
    .single();

  return mapProject(unwrap<Row>(data, error, "Couldn't load that project"));
}




export interface ProjectContents {
  elements: ProjectElement[];
  items: ProjectItem[];
  quotes: ProjectQuote[];
  lines: ProjectQuoteLine[];
  /** Which rooms a price on the whole job is for, and each one's share. */
  quoteRooms: ProjectQuoteRoom[];
  payments: ProjectPayment[];
  milestones: ProjectMilestone[];
  /** Costs nobody has quoted. Forecast's, never committed's. */
  expected: ProjectExpectedCost[];
  /** Payments recorded against an expected cost, before it had a real quote. */
  expectedCostLines: ProjectExpectedCostLine[];
  /** Live bills with what is still to go out on each, and when. */
  bills: ProjectBill[];
}

/** Everything one project page draws, in one round trip. */
export interface ProjectPage extends ProjectContents {
  project: Project;
  suppliers: ProjectSupplierTotals[];
  files: ProjectFile[];
  /** What the renovation has already put in the house record. */
  things: Thing[];
  /** The punch list — ordinary snags filed against this project. */
  snags: Snag[];
  /**
   * Bills that have arrived and not been ruled on, plus the ones that were.
   *
   * It rides on the page read rather than arriving on its own request for the
   * reason the other fourteen do: this pool is ten connections, and a bell
   * whose count comes back separately is one more thing in flight while
   * somebody is pressing something else.
   */
  invoiceReviews: InvoiceReview[];
}

/**
 * The whole project page, in **one** request rather than fourteen.
 *
 * Every read this replaces is still the same view, the same filter and the same
 * order — `home.project_page` moves the questions into one journey rather than
 * answering them differently, so no figure can be arrived at a second way. It
 * was checked that way too: every key's row count against the query it replaced,
 * against the live database, before the screen was changed.
 *
 * The seven single-purpose reads it replaced are **deleted rather than left
 * exported**. Each had exactly one caller and no longer has any, and a dead
 * `getProjectContents` sitting beside this is an invitation to fetch the page
 * the slow way again without noticing. `getProjects` and `getAllProjects` stay:
 * the Projects tab, the Schedule tab and the You tab are still real callers.
 *
 * **Why one and not fourteen in parallel**, which is what this replaced:
 * PostgREST's pool on this project is ten connections. Fourteen at once queue,
 * a queued page looks like a page that ignored the press, and the press comes
 * again carrying eleven more. The logs for 21 September have a single chip
 * toggle pressed three times in one second and `projects_with_totals` taking
 * 17.4 seconds — with every one of these views running in single-digit
 * milliseconds on its own. The cost was never the queries.
 *
 * RLS is untouched and does the same filtering it always did: the function is
 * SECURITY INVOKER over `security_invoker` views, so a non-member gets the
 * refusal rather than a row.
 */
export async function getProjectPage(
  client: SupabaseClient,
  projectId: string
): Promise<ProjectPage> {
  const { data, error } = await client.rpc('project_page', { p_project_id: projectId });
  const page = unwrap<Row>(data, error, "Couldn't load that project");

  return {
    project: mapProject(page.project),
    elements: (page.elements ?? []).map(mapElement),
    items: (page.items ?? []).map(mapItem),
    quotes: (page.quotes ?? []).map(mapQuote),
    lines: (page.lines ?? []).map(mapQuoteLine),
    quoteRooms: (page.quoteRooms ?? []).map(mapQuoteRoom),
    payments: (page.payments ?? []).map(mapPayment),
    milestones: (page.milestones ?? []).map(mapMilestone),
    expected: (page.expected ?? []).map(mapExpectedCost),
    expectedCostLines: (page.expectedCostLines ?? []).map(mapExpectedCostLine),
    bills: (page.bills ?? []).map(mapBill),
    suppliers: (page.suppliers ?? []).map(mapSupplierTotals),
    files: (page.files ?? []).map(mapProjectFile),
    things: (page.things ?? []).map(mapThing),
    snags: (page.snags ?? []).map(mapSnag),
    invoiceReviews: (page.invoiceReviews ?? []).map(mapInvoiceReview),
  };
}




// ------------------------------------------------------------- writes

export interface ProjectInput {
  propertyId: string;
  name: string;
  status?: ProjectStatus;
  summary?: string | null;
  /**
   * Which rooms it touches, and where elements come from.
   *
   * Two or more makes the element layer real, one or none creates the implicit
   * element the client never draws. Elements are not a concept anybody has to
   * learn — they are a consequence of answering this question.
   */
  rooms?: string[];
  startedOn?: string | null;
  targetOn?: string | null;
  finishedOn?: string | null;
  budget?: number | null;
  budgetInclGst?: boolean;
  photoPaths?: string[];
  documentPaths?: string[];
}

export async function createProject(
  client: SupabaseClient,
  input: ProjectInput
): Promise<Project> {
  const { data, error } = await client.rpc('create_project', {
    p_property_id: input.propertyId,
    p_name: input.name,
    p_status: input.status ?? 'planned',
    p_summary: input.summary ?? null,
    p_rooms: input.rooms ?? [],
    p_started_on: input.startedOn ?? null,
    p_target_on: input.targetOn ?? null,
    p_finished_on: input.finishedOn ?? null,
    p_budget: input.budget ?? null,
    p_budget_incl_gst: input.budgetInclGst ?? true,
    p_photo_paths: input.photoPaths ?? [],
    p_document_paths: input.documentPaths ?? [],
  });

  const row = unwrap<Row>(data, error, "Couldn't start that");
  // create_project returns the base row, not the view with its totals.
  return getProject(client, row.id);
}

export interface ProjectUpdate {
  name?: string;
  summary?: string | null;
  status?: ProjectStatus;
  startedOn?: string | null;
  targetOn?: string | null;
  finishedOn?: string | null;
  budget?: number | null;
  budgetInclGst?: boolean;
  photoPaths?: string[];
  documentPaths?: string[];
}

const PROJECT_CLEARABLE: Record<string, string> = {
  summary: 'summary',
  startedOn: 'started_on',
  targetOn: 'target_on',
  finishedOn: 'finished_on',
  budget: 'budget',
};

export async function updateProject(
  client: SupabaseClient,
  projectId: string,
  update: ProjectUpdate
): Promise<Project> {
  const clear: string[] = [];
  for (const [key, column] of Object.entries(PROJECT_CLEARABLE)) {
    if (key in update && update[key as keyof ProjectUpdate] === null) clear.push(column);
  }

  const { error } = await client.rpc('update_project', {
    p_project_id: projectId,
    p_name: update.name ?? null,
    p_summary: update.summary ?? null,
    p_status: update.status ?? null,
    p_started_on: update.startedOn ?? null,
    p_target_on: update.targetOn ?? null,
    p_finished_on: update.finishedOn ?? null,
    p_budget: update.budget ?? null,
    p_budget_incl_gst: update.budgetInclGst ?? null,
    p_photo_paths: update.photoPaths ?? null,
    p_document_paths: update.documentPaths ?? null,
    p_clear: clear,
  });

  if (error) throw asError(error, "That didn’t save");
  return getProject(client, projectId);
}

/**
 * Returns the storage keys the cascade orphaned, for the caller to clear.
 *
 * It has to be the caller: `storage.protect_delete()` raises 42501 on a direct
 * delete of a `storage.objects` row. Safe to return them afterwards here —
 * unlike a household delete — because your membership of the property survives,
 * so `home.can_use_photo_folder` still says yes when you act on them.
 */
export async function deleteProject(
  client: SupabaseClient,
  projectId: string
): Promise<string[]> {
  const { data, error } = await client.rpc('delete_project', { p_project_id: projectId });
  if (error) throw asError(error, "Couldn't delete that project");
  return (data as string[] | null) ?? [];
}

/**
 * Returns the part it made, because a caller sometimes needs to hang something
 * off it in the same breath — the walkthrough naming *Consent and council* and
 * then putting the quote on it. `create_element` has always returned the row;
 * this was throwing it away, which made a create-then-find-by-name the only
 * way to reach it.
 *
 * The derived columns of `project_elements_with_totals` are defaulted rather
 * than re-read, the same as `createQuote`: a brand-new part has none of them,
 * and the caller reloads the page.
 */
export async function createElement(
  client: SupabaseClient,
  projectId: string,
  name: string,
  room?: string | null
): Promise<ProjectElement> {
  const { data, error } = await client.rpc('create_element', {
    p_project_id: projectId,
    p_name: name,
    p_room: room ?? null,
  });
  return mapElement({
    ...unwrap<Row>(data, error, "Couldn't add that"),
    item_count: 0,
    priced_count: 0,
    quoted_count: 0,
  });
}

export interface ElementUpdate {
  name?: string;
  room?: string | null;
  notes?: string | null;
  /** This part's share of the budget, with its own GST pill like every amount. */
  budget?: number | null;
  budgetInclGst?: boolean;
  photoPaths?: string[];
  documentPaths?: string[];
}

export async function updateElement(
  client: SupabaseClient,
  elementId: string,
  update: ElementUpdate
): Promise<void> {
  const clear: string[] = [];
  if ('room' in update && update.room === null) clear.push('room');
  if ('notes' in update && update.notes === null) clear.push('notes');
  // An emptied budget box is somebody saying this part no longer has one — the
  // same convention every other write here uses.
  if ('budget' in update && update.budget === null) clear.push('budget');

  const { error } = await client.rpc('update_element', {
    p_element_id: elementId,
    p_name: update.name ?? null,
    p_room: update.room ?? null,
    p_notes: update.notes ?? null,
    p_budget: update.budget ?? null,
    p_budget_incl_gst: update.budgetInclGst ?? null,
    p_photo_paths: update.photoPaths ?? null,
    p_document_paths: update.documentPaths ?? null,
    p_clear: clear,
  });
  if (error) throw asError(error, "That didn’t save");
}

export async function deleteElement(
  client: SupabaseClient,
  elementId: string
): Promise<string[]> {
  const { data, error } = await client.rpc('delete_element', { p_element_id: elementId });
  if (error) throw asError(error, "Couldn't remove that");
  return (data as string[] | null) ?? [];
}

export async function createItem(
  client: SupabaseClient,
  elementId: string,
  name: string,
  notes?: string | null
): Promise<ProjectItem> {
  const { data, error } = await client.rpc('create_item', {
    p_element_id: elementId,
    p_name: name,
    p_notes: notes ?? null,
    p_status: 'considering',
  });
  const row = unwrap<Row>(data, error, "Couldn't add that");
  return mapItem({ ...row, quote_count: 0 });
}

export interface ItemUpdate {
  name?: string;
  status?: ProjectItemStatus;
  notes?: string | null;
  photoPaths?: string[];
  documentPaths?: string[];
}

export async function updateItem(
  client: SupabaseClient,
  itemId: string,
  update: ItemUpdate
): Promise<void> {
  const clear: string[] = [];
  if ('notes' in update && update.notes === null) clear.push('notes');

  const { error } = await client.rpc('update_item', {
    p_item_id: itemId,
    p_name: update.name ?? null,
    p_status: update.status ?? null,
    p_notes: update.notes ?? null,
    p_photo_paths: update.photoPaths ?? null,
    p_document_paths: update.documentPaths ?? null,
    p_clear: clear,
  });
  if (error) throw asError(error, "That didn’t save");
}

export async function deleteItem(client: SupabaseClient, itemId: string): Promise<string[]> {
  const { data, error } = await client.rpc('delete_item', { p_item_id: itemId });
  if (error) throw asError(error, "Couldn't remove that");
  return (data as string[] | null) ?? [];
}

/**
 * Include or exclude, without deleting it.
 *
 * Its own dedicated function for the reason `setPartBought` and
 * `setQuoteStatus` are theirs: the only write in this feature that changes
 * what a total says, so alone it cannot have its sibling-clearing skipped by
 * a caller passing it among other fields — there are none here, but the
 * convention is the same one that keeps every other decision-that-changes-a-
 * total off `updateItem`.
 */
export async function setItemExcluded(
  client: SupabaseClient,
  itemId: string,
  excluded: boolean
): Promise<void> {
  const { error } = await client.rpc('set_item_excluded', {
    p_item_id: itemId,
    p_excluded: excluded,
  });
  if (error) throw asError(error, "That didn’t save");
}

/**
 * Says which set-aside amount in a builder's quote a thing is being chosen
 * against — or, with null, that it is not. Its own function for the reason
 * `set_item_excluded` is: it changes what a later choice does to the totals.
 */
export async function setItemSetAside(
  client: SupabaseClient,
  itemId: string,
  lineId: string | null
): Promise<void> {
  const { error } = await client.rpc('set_item_set_aside', {
    p_item_id: itemId,
    p_line_id: lineId,
  });
  if (error) throw asError(error, "That didn’t save");
}

/**
 * Chooses one option for a thing.
 *
 * Three writes, in the order that keeps every intermediate state honest:
 * the link to the set-aside amount first (so the moment the quote is accepted
 * it already settles the allowance rather than counting beside it), then who
 * bills for it, then the acceptance itself — `set_quote_status` also puts any
 * earlier choice on the same thing back to undecided.
 */
export async function chooseOption(
  client: SupabaseClient,
  quoteId: string,
  choice: { setAsideLineId: string | null; billedThroughId: string | null }
): Promise<void> {
  await updateQuote(client, quoteId, {
    supersedesLineId: choice.setAsideLineId,
    billedThroughId: choice.billedThroughId,
  });
  await setQuoteStatus(client, quoteId, 'accepted');
}

/** Pays what is still owing on a bill, in one payment dated today. */
export async function payBill(
  client: SupabaseClient,
  quoteId: string,
  unpaid: number,
  paidOn: string
): Promise<void> {
  if (!(unpaid > 0)) return;
  await addPayment(client, quoteId, { amount: unpaid, amountInclGst: true, paidOn });
}

export interface QuoteInput {
  /** Exactly one of these three. The RPC refuses the other counts, in words. */
  itemId?: string | null;
  elementId?: string | null;
  projectId?: string | null;
  supplier?: string | null;
  detail?: string | null;
  amount?: number | null;
  /** The pill. Every amount carries one; there is no household-wide default. */
  amountInclGst?: boolean;
  kind?: ProjectQuoteKind;
  status?: ProjectQuoteStatus;
  basis?: ProjectQuoteBasis;
  dated?: string | null;
  notes?: string | null;
  /** The allowance this answers. Counted through that line and never twice. */
  supersedesLineId?: string | null;
  /** When the money has to leave, as distinct from the date on the paper. */
  dueOn?: string | null;
  /** The head contract billing this on. Null means they invoice us direct. */
  billedThroughId?: string | null;
  /** The milestone this bill claims against. */
  settlesMilestoneId?: string | null;
  /**
   * The contract this bill is a claim against.
   *
   * `create_quote` refuses a claim that does not sit exactly where its contract
   * sits, so a caller has to pass the contract's own scope alongside this. The
   * walkthrough does that by construction — it never asks, it inherits.
   */
  againstQuoteId?: string | null;
  photoPaths?: string[];
  documentPaths?: string[];
}

export async function createQuote(
  client: SupabaseClient,
  input: QuoteInput
): Promise<ProjectQuote> {
  const { data, error } = await client.rpc('create_quote', {
    p_item_id: input.itemId ?? null,
    p_element_id: input.elementId ?? null,
    p_project_id: input.projectId ?? null,
    p_supplier: input.supplier ?? null,
    p_detail: input.detail ?? null,
    p_amount: input.amount ?? null,
    p_amount_incl_gst: input.amountInclGst ?? true,
    p_kind: input.kind ?? 'quote',
    p_status: input.status ?? 'tbc',
    p_basis: input.basis ?? 'fixed',
    p_dated: input.dated ?? null,
    p_notes: input.notes ?? null,
    p_supersedes_line_id: input.supersedesLineId ?? null,
    p_photo_paths: input.photoPaths ?? [],
    p_document_paths: input.documentPaths ?? [],
    p_due_on: input.dueOn ?? null,
    p_billed_through_id: input.billedThroughId ?? null,
    p_settles_milestone_id: input.settlesMilestoneId ?? null,
    p_against_quote_id: input.againstQuoteId ?? null,
  });
  // The RPC returns the table row, which carries none of the view's derived
  // columns. Defaulted here rather than re-read: the caller reloads the page.
  return mapQuote({ ...unwrap<Row>(data, error, "Couldn't save that"), line_count: 0 });
}

export interface QuoteUpdate {
  supplier?: string | null;
  detail?: string | null;
  amount?: number | null;
  amountInclGst?: boolean;
  kind?: ProjectQuoteKind;
  basis?: ProjectQuoteBasis;
  dated?: string | null;
  notes?: string | null;
  supersedesLineId?: string | null;
  photoPaths?: string[];
  documentPaths?: string[];
  dueOn?: string | null;
  billedThroughId?: string | null;
  settlesMilestoneId?: string | null;
}

const QUOTE_CLEARABLE: Record<string, string> = {
  supplier: 'supplier',
  detail: 'detail',
  amount: 'amount',
  dated: 'dated',
  notes: 'notes',
  supersedesLineId: 'supersedes_line_id',
  dueOn: 'due_on',
  billedThroughId: 'billed_through_id',
  settlesMilestoneId: 'settles_milestone_id',
};

export async function updateQuote(
  client: SupabaseClient,
  quoteId: string,
  update: QuoteUpdate
): Promise<void> {
  const clear: string[] = [];
  for (const [key, column] of Object.entries(QUOTE_CLEARABLE)) {
    if (key in update && update[key as keyof QuoteUpdate] === null) clear.push(column);
  }

  const { error } = await client.rpc('update_quote', {
    p_quote_id: quoteId,
    p_supplier: update.supplier ?? null,
    p_detail: update.detail ?? null,
    p_amount: update.amount ?? null,
    p_amount_incl_gst: update.amountInclGst ?? null,
    p_kind: update.kind ?? null,
    p_basis: update.basis ?? null,
    p_dated: update.dated ?? null,
    p_notes: update.notes ?? null,
    p_supersedes_line_id: update.supersedesLineId ?? null,
    p_photo_paths: update.photoPaths ?? null,
    p_document_paths: update.documentPaths ?? null,
    p_clear: clear,
  });
  if (error) throw asError(error, "That didn’t save");
}

/**
 * Accepting, un-deciding, or turning one down — deliberately not part of
 * `updateQuote`.
 *
 * The same argument that keeps `setPartBought` out of `updateSnag`: this is one
 * decision that is its own confirmation, and it is the only write in the whole
 * feature that changes what a project's total says. Alone, the sibling-clearing
 * can never be skipped by a caller passing a status among eight other fields.
 */
export async function setQuoteStatus(
  client: SupabaseClient,
  quoteId: string,
  status: ProjectQuoteStatus
): Promise<void> {
  const { error } = await client.rpc('set_quote_status', {
    p_quote_id: quoteId,
    p_status: status,
  });
  if (error) throw asError(error, "That didn’t save");
}

// ------------------------------------------------------------- lines

export interface QuoteLineInput {
  name: string;
  detail?: string | null;
  amount?: number | null;
  amountInclGst?: boolean;
  isAllowance?: boolean;
  /** Which word the contract used. See `ProjectAllowanceKind`. */
  allowanceKind?: ProjectAllowanceKind | null;
  /** On top of the quoted total rather than inside it. Worth the whole allowance. */
  additional?: boolean;
  /** The margin the head contractor keeps if this is bought direct. */
  attendancePct?: number | null;
}

export async function addQuoteLine(
  client: SupabaseClient,
  quoteId: string,
  input: QuoteLineInput
): Promise<ProjectQuoteLine> {
  const { data, error } = await client.rpc('add_quote_line', {
    p_quote_id: quoteId,
    p_name: input.name,
    p_detail: input.detail ?? null,
    p_amount: input.amount ?? null,
    p_amount_incl_gst: input.amountInclGst ?? true,
    p_is_allowance: input.isAllowance ?? false,
    p_allowance_kind: input.allowanceKind ?? null,
    p_additional: input.additional ?? false,
    p_attendance_pct: input.attendancePct ?? null,
  });
  return mapQuoteLine(unwrap<Row>(data, error, "Couldn't add that line"));
}

const LINE_CLEARABLE: Record<string, string> = {
  detail: 'detail',
  amount: 'amount',
  allowanceKind: 'allowance_kind',
  attendancePct: 'attendance_pct',
};

export async function updateQuoteLine(
  client: SupabaseClient,
  lineId: string,
  update: Partial<QuoteLineInput>
): Promise<void> {
  const clear: string[] = [];
  for (const [key, column] of Object.entries(LINE_CLEARABLE)) {
    if (key in update && update[key as keyof QuoteLineInput] === null) clear.push(column);
  }

  const { error } = await client.rpc('update_quote_line', {
    p_line_id: lineId,
    p_name: update.name ?? null,
    p_detail: update.detail ?? null,
    p_amount: update.amount ?? null,
    p_amount_incl_gst: update.amountInclGst ?? null,
    p_is_allowance: update.isAllowance ?? null,
    p_clear: clear,
    p_allowance_kind: update.allowanceKind ?? null,
    p_additional: update.additional ?? null,
    p_attendance_pct: update.attendancePct ?? null,
  });
  if (error) throw asError(error, "That didn’t save");
}

export async function deleteQuoteLine(client: SupabaseClient, lineId: string): Promise<void> {
  const { error } = await client.rpc('delete_quote_line', { p_line_id: lineId });
  if (error) throw asError(error, "Couldn't remove that line");
}

// ------------------------------------------------------------- payments

export interface PaymentInput {
  amount: number;
  amountInclGst?: boolean;
  paidOn?: string | null;
  /** The invoice number this settled, or what the bank statement calls it. */
  reference?: string | null;
  notes?: string | null;
  photoPaths?: string[];
  documentPaths?: string[];
}

/**
 * Money out, against the bill it settles.
 *
 * `quoteId` must name an invoice; the RPC says so in words rather than letting a
 * payment against a quote quietly count as money spent on a price nobody has
 * been billed for.
 */
export async function setFigure(
  client: SupabaseClient,
  projectId: string,
  field: ProjectFigure,
  input: { amount: number; amountInclGst?: boolean; elementId?: string | null; note?: string | null }
): Promise<ProjectOverride> {
  const { data, error } = await client.rpc('set_figure', {
    p_project_id: projectId,
    p_field: field,
    p_amount: input.amount,
    p_amount_incl_gst: input.amountInclGst ?? true,
    p_element_id: input.elementId ?? null,
    p_note: input.note ?? null,
  });
  return mapOverride(unwrap<Row>(data, error, "That didn’t save"));
}

/**
 * Puts the derived figure back on screen.
 *
 * Its own function rather than `setFigure(null)`, for the reason
 * `set_part_bought` and `set_quote_status` are theirs: clearing is the act that
 * changes what the page claims, and it should not be reachable by accident from
 * a form that happened to be emptied.
 */
export async function clearFigure(
  client: SupabaseClient,
  projectId: string,
  field: ProjectFigure,
  elementId: string | null = null
): Promise<void> {
  const { error } = await client.rpc('clear_figure', {
    p_project_id: projectId,
    p_field: field,
    p_element_id: elementId,
  });
  if (error) throw asError(error, "Couldn’t undo that");
}

export async function getOverrides(
  client: SupabaseClient,
  projectId: string
): Promise<ProjectOverride[]> {
  const { data, error } = await client
    .from('project_overrides')
    .select('*')
    .eq('project_id', projectId);

  if (error) throw asError(error, "Couldn’t load the edited figures");
  return (data ?? []).map(mapOverride);
}

export interface ExpectedCostInput {
  name: string;
  amount?: number | null;
  amountInclGst?: boolean;
  elementId?: string | null;
  likelySupplier?: string | null;
  note?: string | null;
  /**
   * Answered at creation, where there is no total to change yet — the row is
   * being made. Changing it afterwards goes through `setExpectedCostConfirmed`
   * and nothing else, because from then on it moves Committed.
   */
  confirmed?: boolean;
}

export async function createExpectedCost(
  client: SupabaseClient,
  projectId: string,
  input: ExpectedCostInput
): Promise<ProjectExpectedCost> {
  const { data, error } = await client.rpc('create_expected_cost', {
    p_project_id: projectId,
    p_name: input.name,
    p_amount: input.amount ?? null,
    p_amount_incl_gst: input.amountInclGst ?? true,
    p_element_id: input.elementId ?? null,
    p_likely_supplier: input.likelySupplier ?? null,
    p_note: input.note ?? null,
    p_confirmed: input.confirmed ?? false,
  });
  return mapExpectedCost(unwrap<Row>(data, error, "Couldn't add that"));
}

/**
 * Says whether somebody has agreed an expected cost, or it is still a guess.
 *
 * **Its own call, and deliberately not part of `updateExpectedCost`.** This is
 * the only write on an expected cost that changes what a total says — a
 * confirmed one counts in Committed and is owed to its supplier — and the rule
 * `setPartBought`, `setQuoteStatus` and `setItemExcluded` all follow is that
 * such a write cannot be smuggled in beside eight other fields by a caller
 * correcting a name.
 */
export async function setExpectedCostConfirmed(
  client: SupabaseClient,
  expectedId: string,
  confirmed: boolean
): Promise<void> {
  const { error } = await client.rpc('set_expected_cost_confirmed', {
    p_expected_id: expectedId,
    p_confirmed: confirmed,
  });
  if (error) throw asError(error, "That didn’t save");
}

const EXPECTED_CLEARABLE: Record<string, string> = {
  amount: 'amount',
  elementId: 'element_id',
  likelySupplier: 'likely_supplier',
  note: 'note',
  settledBy: 'settled_by',
};

/**
 * `confirmed` is deliberately not here.
 *
 * `update_expected_cost` does not take it, so a caller passing it would have
 * it silently dropped — which is the two-writers-of-one-fact shape this schema
 * keeps naming. `setExpectedCostConfirmed` is the one way, and omitting it
 * from this type makes trying anything else a type error rather than a write
 * that quietly does nothing.
 */
export interface ExpectedCostUpdate extends Partial<Omit<ExpectedCostInput, 'confirmed'>> {
  /** The real price, once one exists. Set, the expectation stops counting. */
  settledBy?: string | null;
}

export async function updateExpectedCost(
  client: SupabaseClient,
  expectedId: string,
  update: ExpectedCostUpdate
): Promise<void> {
  const clear: string[] = [];
  for (const [key, column] of Object.entries(EXPECTED_CLEARABLE)) {
    if (key in update && update[key as keyof ExpectedCostUpdate] === null) clear.push(column);
  }

  const { error } = await client.rpc('update_expected_cost', {
    p_expected_id: expectedId,
    p_name: update.name ?? null,
    p_amount: update.amount ?? null,
    p_amount_incl_gst: update.amountInclGst ?? null,
    p_element_id: update.elementId ?? null,
    p_likely_supplier: update.likelySupplier ?? null,
    p_note: update.note ?? null,
    p_settled_by: update.settledBy ?? null,
    p_clear: clear,
  });
  if (error) throw asError(error, "That didn’t save");
}

export async function deleteExpectedCost(
  client: SupabaseClient,
  expectedId: string
): Promise<void> {
  const { error } = await client.rpc('delete_expected_cost', { p_expected_id: expectedId });
  if (error) throw asError(error, "Couldn't remove that");
}

// ------------------------------------------------ payments against a guess


export interface ExpectedCostLineInput {
  name: string;
  reference?: string | null;
  amount?: number | null;
  amountInclGst?: boolean;
  photoPaths?: string[];
  documentPaths?: string[];
}

export async function addExpectedCostLine(
  client: SupabaseClient,
  expectedCostId: string,
  input: ExpectedCostLineInput
): Promise<ProjectExpectedCostLine> {
  const { data, error } = await client.rpc('add_expected_cost_line', {
    p_expected_cost_id: expectedCostId,
    p_name: input.name,
    p_reference: input.reference ?? null,
    p_amount: input.amount ?? null,
    p_amount_incl_gst: input.amountInclGst ?? true,
    p_photo_paths: input.photoPaths ?? [],
    p_document_paths: input.documentPaths ?? [],
  });
  return mapExpectedCostLine(unwrap<Row>(data, error, "Couldn't add that"));
}

const EXPECTED_LINE_CLEARABLE: Record<string, string> = {
  reference: 'reference',
  amount: 'amount',
};

export async function updateExpectedCostLine(
  client: SupabaseClient,
  lineId: string,
  update: Partial<ExpectedCostLineInput>
): Promise<void> {
  const clear: string[] = [];
  for (const [key, column] of Object.entries(EXPECTED_LINE_CLEARABLE)) {
    if (key in update && update[key as keyof ExpectedCostLineInput] === null) clear.push(column);
  }

  const { error } = await client.rpc('update_expected_cost_line', {
    p_line_id: lineId,
    p_name: update.name ?? null,
    p_reference: update.reference ?? null,
    p_amount: update.amount ?? null,
    p_amount_incl_gst: update.amountInclGst ?? null,
    p_photo_paths: update.photoPaths ?? null,
    p_document_paths: update.documentPaths ?? null,
    p_clear: clear,
  });
  if (error) throw asError(error, "That didn’t save");
}

export async function deleteExpectedCostLine(client: SupabaseClient, lineId: string): Promise<void> {
  const { error } = await client.rpc('delete_expected_cost_line', { p_line_id: lineId });
  if (error) throw asError(error, "Couldn't remove that");
}

export interface MilestoneInput {
  name: string;
  /** A percentage of the commitment, or an amount — the RPC refuses both, in words. */
  percent?: number | null;
  amount?: number | null;
  amountInclGst?: boolean;
  dueOn?: string | null;
}

export async function addMilestone(
  client: SupabaseClient,
  quoteId: string,
  input: MilestoneInput
): Promise<ProjectMilestone> {
  const { data, error } = await client.rpc('add_milestone', {
    p_quote_id: quoteId,
    p_name: input.name,
    p_percent: input.percent ?? null,
    p_amount: input.amount ?? null,
    p_amount_incl_gst: input.amountInclGst ?? true,
    p_due_on: input.dueOn ?? null,
  });
  return mapMilestone(unwrap<Row>(data, error, "Couldn't add that milestone"));
}

const MILESTONE_CLEARABLE: Record<string, string> = {
  percent: 'percent',
  amount: 'amount',
  dueOn: 'due_on',
};

export async function updateMilestone(
  client: SupabaseClient,
  milestoneId: string,
  update: Partial<MilestoneInput>
): Promise<void> {
  const clear: string[] = [];
  for (const [key, column] of Object.entries(MILESTONE_CLEARABLE)) {
    if (key in update && update[key as keyof MilestoneInput] === null) clear.push(column);
  }

  const { error } = await client.rpc('update_milestone', {
    p_milestone_id: milestoneId,
    p_name: update.name ?? null,
    p_percent: update.percent ?? null,
    p_amount: update.amount ?? null,
    p_amount_incl_gst: update.amountInclGst ?? null,
    p_due_on: update.dueOn ?? null,
    p_clear: clear,
  });
  if (error) throw asError(error, "That didn’t save");
}

export async function deleteMilestone(
  client: SupabaseClient,
  milestoneId: string
): Promise<void> {
  const { error } = await client.rpc('delete_milestone', { p_milestone_id: milestoneId });
  if (error) throw asError(error, "Couldn't remove that");
}

export async function addPayment(
  client: SupabaseClient,
  quoteId: string,
  input: PaymentInput
): Promise<ProjectPayment> {
  const { data, error } = await client.rpc('add_payment', {
    p_quote_id: quoteId,
    p_amount: input.amount,
    p_amount_incl_gst: input.amountInclGst ?? true,
    p_paid_on: input.paidOn ?? null,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
    p_photo_paths: input.photoPaths ?? null,
    p_document_paths: input.documentPaths ?? null,
  });
  return mapPayment(unwrap<Row>(data, error, "Couldn't record that payment"));
}

/**
 * Corrects a payment already recorded.
 *
 * A transposed invoice number, a date read off the wrong statement line, a PDF
 * that turned up a week after the transfer. Without it the only fix is delete
 * and retype, which throws the attachments away with the typo.
 *
 * Omitting a field leaves it alone; emptying one is `clear`, the same
 * convention `update_snag` and `update_thing` use. The amount is deliberately
 * not clearable — a payment with no figure is not a correction, it is a row
 * that should not exist, and `deletePayment` is how that is said.
 */
export async function updatePayment(
  client: SupabaseClient,
  paymentId: string,
  input: Partial<PaymentInput>
): Promise<ProjectPayment> {
  const clear: string[] = [];
  if (input.paidOn === null) clear.push('paid_on');
  if (input.reference === null) clear.push('reference');
  if (input.notes === null) clear.push('notes');

  const { data, error } = await client.rpc('update_payment', {
    p_payment_id: paymentId,
    p_amount: input.amount ?? null,
    p_amount_incl_gst: input.amountInclGst ?? null,
    p_paid_on: input.paidOn ?? null,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
    p_photo_paths: input.photoPaths ?? null,
    p_document_paths: input.documentPaths ?? null,
    p_clear: clear,
  });
  return mapPayment(unwrap<Row>(data, error, "That didn’t save"));
}

export async function deletePayment(client: SupabaseClient, paymentId: string): Promise<void> {
  const { error } = await client.rpc('delete_payment', { p_payment_id: paymentId });
  if (error) throw asError(error, "Couldn't remove that payment");
}

/**
 * One spelling of a supplier's name, across a whole job.
 *
 * Without it a typo noticed at $176,755 is fixable only quote by quote, and a
 * rollup nobody can correct is a rollup nobody trusts. Matched the way the
 * rollup groups: trimmed and case-insensitive.
 */
export async function renameSupplier(
  client: SupabaseClient,
  projectId: string,
  from: string,
  to: string
): Promise<number> {
  const { data, error } = await client.rpc('rename_supplier', {
    p_project_id: projectId,
    p_from: from,
    p_to: to,
  });
  if (error) throw asError(error, "Couldn't rename them");
  return (data as number | null) ?? 0;
}

export async function deleteQuote(client: SupabaseClient, quoteId: string): Promise<string[]> {
  const { data, error } = await client.rpc('delete_quote', { p_quote_id: quoteId });
  if (error) throw asError(error, "Couldn't remove that");
  return (data as string[] | null) ?? [];
}

// ---------------------------------------------------------- taking one out
//
// **One table, two renderers**, exactly as the list and the house record do:
// these build rows and `toCsv` / `renderPdf` only format them, so a CSV and a
// PDF of the same extract can never disagree about what is in it.
//
// The rule about money follows the extract out of the app: **every figure a
// project exports is GST-inclusive and says so**, and every total is printed
// beside its denominator. A PDF handed to a valuer or an insurer is the one
// copy of these numbers nobody can ask a follow-up question about, so it is the
// last place a total should be able to be read as more settled than it is.

/** "$8,990 · 5 of 9 priced" — a figure never leaves the app without its denominator. */
function exportTotal(totals: ProjectTotals): string {
  const figure = formatMoney(totals.committedTotal);
  if (!figure) return totals.itemCount > 0 ? `nothing committed of ${totals.itemCount}` : '';
  const allowance = describeAllowance(totals);
  return [
    `${figure} · ${totals.pricedCount} of ${totals.itemCount} priced`,
    allowance,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Every project as a row — the high-level extract, from the tab's footer.
 *
 * What it is for is the question a valuer, an insurer or a buyer asks: what has
 * been done to this house, when, and what did it cost.
 */
export function projectExportTable(
  projects: Project[],
  meta: { household: string; place: string; scope: string; stamp: string }
): ExportTable {
  return {
    name: `${meta.household} projects`,
    subtitle: `${meta.place} · ${meta.scope} · ${meta.stamp} · all figures incl GST`,
    columns: [
      'Project', 'Status', 'Started', 'Target', 'Finished', 'Budget',
      'Committed', 'Invoiced', 'Paid', 'Outstanding', 'Still an allowance',
      'Items', 'Priced', 'Files', 'Jobs open', 'Started by',
    ],
    rows: projects.map((project) => [
      project.name,
      PROJECT_STATUS_LABELS[project.status] ?? project.status,
      formatLooseDate(project.startedOn),
      formatLooseDate(project.targetOn),
      formatLooseDate(project.finishedOn),
      project.budget !== null
        ? `${formatMoney(project.budget)}${project.budgetInclGst ? '' : ' excl GST'}`
        : '',
      formatMoney(project.committedTotal) ?? '',
      formatMoney(project.invoicedTotal) ?? '',
      formatMoney(project.paidTotal) ?? '',
      formatMoney(outstanding(project)) ?? '',
      // Zero is written out rather than left blank: an empty cell reads as
      // "unknown", and "nothing is an allowance any more" is a real answer.
      formatMoney(project.allowanceOpen) ?? '',
      String(project.itemCount),
      // Never a bare count: "5" beside "9 items" is the denominator, in the
      // shape a spreadsheet can sort on.
      `${project.pricedCount} of ${project.itemCount}`,
      String(project.fileCount),
      String(project.openSnagCount),
      project.createdByName,
    ]),
  };
}

/**
 * One project, opened right out — the dossier.
 *
 * A row per item, carrying the part of the job it belongs to, the supplier that
 * won it, and what was actually paid. This is the artefact that gets handed to
 * somebody: a renovation, itemised, with the paperwork behind it named.
 *
 * **An item nobody has priced still gets a row**, saying so in words. Dropping
 * it would make the file's total look complete, which is the single thing this
 * whole feature is built not to do.
 */
export function projectDossierTable(
  project: Project,
  elements: ProjectElement[],
  items: ProjectItem[],
  quotes: ProjectQuote[],
  meta: { household: string; stamp: string }
): ExportTable {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const drawn = showsElements(elements);

  const rows = items.map((item) => {
    const element = elementsById.get(item.elementId);
    const mine = quotes.filter((quote) => quote.itemId === item.id);
    const accepted = mine.find(
      (quote) => quote.kind === 'quote' && quote.status === 'accepted'
    );
    const bills = mine.filter((quote) => quote.kind === 'invoice');

    return [
      // An implicit element has no name anybody chose, so printing it would
      // invent a structure the reader never saw on screen.
      drawn ? element?.name ?? '' : '',
      element?.room ?? '',
      item.name,
      PROJECT_ITEM_STATUS_LABELS[item.status] ?? item.status,
      accepted?.supplier ?? bills[0]?.supplier ?? '',
      accepted?.detail ?? bills[0]?.detail ?? '',
      // "Not priced" in words rather than an empty cell, because a blank in a
      // money column reads as zero to anybody skimming.
      item.committed !== null ? formatMoney(item.committed) ?? '' : 'Not priced',
      formatMoney(item.invoiced) ?? '',
      formatMoney(item.paid) ?? '',
      String(mine.length),
      item.tbcCount > 0 ? String(item.tbcCount) : '',
      bills.map((quote) => PROJECT_QUOTE_KIND_LABELS[quote.kind]).join('; '),
      item.photoPaths.length + item.documentPaths.length > 0
        ? String(item.photoPaths.length + item.documentPaths.length)
        : '',
      item.notes ?? '',
    ];
  });

  // The totals ride as a final row rather than as prose, so a spreadsheet can
  // see them and the PDF prints them in the same place every time.
  rows.push([
    '', '', 'TOTAL', '', '', '',
    formatMoney(project.committedTotal) ?? '',
    formatMoney(project.invoicedTotal) ?? '',
    formatMoney(project.paidTotal) ?? '',
    String(quotes.length),
    project.quotedCount > 0 ? `${project.quotedCount} not decided` : '',
    describeAllowance(project) ?? '',
    String(project.fileCount),
    `${project.pricedCount} of ${project.itemCount} priced`,
  ]);

  return {
    name: `${meta.household} ${project.name}`,
    subtitle: [
      PROJECT_STATUS_LABELS[project.status],
      project.finishedOn ? `finished ${formatLooseDate(project.finishedOn)}` : null,
      project.propertyName,
      meta.stamp,
      'all figures incl GST',
    ]
      .filter(Boolean)
      .join(' · '),
    columns: [
      'Part of the job', 'Room', 'Item', 'Where it’s up to', 'Supplier', 'What exactly',
      'Committed', 'Invoiced', 'Paid', 'Prices', 'Not decided', 'Bills', 'Files', 'Notes',
    ],
    rows,
  };
}

/**
 * The photographs on a project extract, round-robin so one item photographed
 * from five angles cannot spend a quarter of the allowance.
 *
 * The project's own photographs come first — those are the before-and-afters,
 * the thing somebody actually wants to see — and the items' follow.
 */
export function projectExportPhotos(
  project: Project,
  items: ProjectItem[],
  elements: ProjectElement[],
  limit = EXPORT_PHOTO_LIMIT
): ExportPhoto[] {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const sources: { photos: string[]; caption: string; detail: string }[] = [
    { photos: project.photoPaths ?? [], caption: project.name, detail: project.propertyName },
    ...items.map((item) => ({
      photos: item.photoPaths ?? [],
      caption: item.name,
      detail: [elementsById.get(item.elementId)?.name, elementsById.get(item.elementId)?.room]
        .filter(Boolean)
        .join(' · '),
    })),
  ];

  return roundRobin(
    sources,
    (source) => source.photos,
    (source, path) => ({ path, caption: source.caption, detail: source.detail }),
    limit
  );
}

// ------------------------------------------------------- the loose ends
//
// **What the app knows is half-finished, and can name the next move for.**
//
// The rule this is built against is already written down for the House tab: a
// global completeness meter is the shaming number that gets an app closed and
// not reopened, and there is deliberately no such meter anywhere. So this is
// not one. Three tests every entry has to pass:
//
//   1. **The app is certain.** Not "this looks thin" — a fact, from a column.
//   2. **There is one obvious next action**, and a tap that starts it.
//   3. **The payoff is nameable in a sentence**, and it is a payoff to the
//      household rather than to the record's tidiness.
//
// Anything that fails one of those is left out, which is why this list is short
// and why it is usually empty. An empty list draws nothing at all — the same
// rule as the shopping pill at nought and *Fit* in the photo viewer: a control
// at zero is a control dressed as a choice.

export type LooseEndKind = 'record-installed' | 'wordless-snag' | 'place-unlocated';

export interface LooseEnd {
  kind: LooseEndKind;
  /** The row's own line: what is outstanding. */
  title: string;
  /** Why it is worth doing — the payoff, never the tidiness. */
  detail: string;
  projectId?: string;
  snagId?: string;
}

export function looseEnds(input: {
  projects: Project[];
  snags: Snag[];
  properties: Property[];
}): LooseEnd[] {
  const out: LooseEnd[] = [];

  // 1. What a renovation put in that the house record has never heard of.
  //
  // This is the join the whole Projects tab was built to make pay: three years
  // on nobody asks what the laundry cost, they ask the model number and whether
  // it is still under warranty — and that answer only exists if somebody
  // recorded the machine. The count is a subtraction of two columns, so it is
  // certain rather than inferred from names.
  for (const project of input.projects) {
    const outstanding = project.installedCount - project.thingCount;
    if (outstanding <= 0) continue;
    out.push({
      kind: 'record-installed',
      title:
        outstanding === 1
          ? `1 thing put in by ${project.name} isn’t in the house record`
          : `${outstanding} things put in by ${project.name} aren’t in the house record`,
      detail: 'Recording one puts its model number where you’ll look for it in a shop.',
      projectId: project.id,
    });
  }

  // 2. A photograph with no words and no room.
  //
  // Named in this codebase as the weakest thing the app can hold: `snagHeadline`
  // has nothing to work with and the list reads "Something to sort out", which
  // is unreadable a fortnight later to the person who filed it as much as to
  // anybody else. Done ones are left alone — there is nothing to sort out about
  // a job that is finished, whatever it was called.
  for (const snag of input.snags) {
    if (snag.status === 'done') continue;
    if (snag.description || snag.room) continue;
    if (snag.photoPaths.length === 0) continue;
    out.push({
      kind: 'wordless-snag',
      title: `${snag.reference} is a photo with no words`,
      detail: 'A line about it, or the room it’s in, keeps the list readable in a fortnight.',
      snagId: snag.id,
    });
  }

  // 3. A place that cannot say roughly where it is.
  //
  // `set_property_location` exists so a briefed extract can ask for somebody
  // *local*; without it the brief asks for a tradesman near nowhere. Suburb and
  // town, never a street address — the file gets forwarded.
  for (const property of input.properties) {
    if (property.suburb || property.town) continue;
    out.push({
      kind: 'place-unlocated',
      title: `${property.name} doesn’t say which part of the country it’s in`,
      detail: 'A suburb and town let an assessment ask for somebody local.',
    });
  }

  return out;
}

// ------------------------------------------------- invoices waiting to be read

/**
 * Stage a bill that arrived, with whatever could be read off the email.
 *
 * Nothing here reaches a total. That is the whole point of the row existing:
 * between an invoice landing and it being recorded there is a judgement nobody
 * has made yet, and this is somewhere to put it while it waits.
 *
 * `inferred` names the fields that were **guessed** rather than read. The card
 * marks them, so a reader can tell the app's answers from the invoice's — which
 * is the same discipline `paidEvidence` applies to the paid flag, and the same
 * one `describeOverride` applies to a typed-over figure.
 */
export interface InvoiceReviewInput {
  projectId: string;
  supplier?: string | null;
  detail?: string | null;
  amount?: number | null;
  amountInclGst?: boolean;
  invoiceNumber?: string | null;
  dated?: string | null;
  dueOn?: string | null;
  paid?: boolean;
  paidOn?: string | null;
  /** The sentence `paid` was read from. Never send the flag without it. */
  paidEvidence?: string | null;
  category?: string | null;
  elementId?: string | null;
  sourceRef?: string | null;
  sourceSubject?: string | null;
  sourceFrom?: string | null;
  sourceAt?: string | null;
  inferred?: string[];
}

export async function createInvoiceReview(
  client: SupabaseClient,
  input: InvoiceReviewInput
): Promise<InvoiceReview> {
  const { data, error } = await client.rpc('create_invoice_review', {
    p_project_id: input.projectId,
    p_supplier: input.supplier ?? null,
    p_detail: input.detail ?? null,
    p_amount: input.amount ?? null,
    p_amount_incl_gst: input.amountInclGst ?? true,
    p_invoice_number: input.invoiceNumber ?? null,
    p_dated: input.dated ?? null,
    p_due_on: input.dueOn ?? null,
    p_paid: input.paid ?? false,
    p_paid_on: input.paidOn ?? null,
    p_paid_evidence: input.paidEvidence ?? null,
    p_category: input.category ?? null,
    p_element_id: input.elementId ?? null,
    p_source_ref: input.sourceRef ?? null,
    p_source_subject: input.sourceSubject ?? null,
    p_source_from: input.sourceFrom ?? null,
    p_source_at: input.sourceAt ?? null,
    p_inferred: input.inferred ?? [],
  });
  return mapInvoiceReview(unwrap<Row>(data, error, "That didn’t save"));
}

const INVOICE_REVIEW_CLEARABLE: Record<string, string> = {
  supplier: 'supplier',
  detail: 'detail',
  amount: 'amount',
  invoiceNumber: 'invoice_number',
  dated: 'dated',
  dueOn: 'due_on',
  paidOn: 'paid_on',
  category: 'category',
};

/**
 * Correcting a card before ruling on it.
 *
 * `state` is deliberately absent, for the reason it is absent from
 * `ExpectedCostUpdate`: approving and declining are what change what the page
 * claims, so they are their own calls and cannot ride along beside a corrected
 * supplier name. Trying is a type error rather than a write that does nothing.
 *
 * An emptied field clears the column rather than leaving the old value, the
 * `p_clear` convention every update in this schema follows — somebody blanking
 * an amount is saying they no longer know it.
 */
export interface InvoiceReviewUpdate {
  supplier?: string | null;
  detail?: string | null;
  amount?: number | null;
  amountInclGst?: boolean;
  invoiceNumber?: string | null;
  dated?: string | null;
  dueOn?: string | null;
  paid?: boolean;
  paidOn?: string | null;
  category?: string | null;
}

export async function updateInvoiceReview(
  client: SupabaseClient,
  reviewId: string,
  update: InvoiceReviewUpdate
): Promise<InvoiceReview> {
  const clear = Object.entries(INVOICE_REVIEW_CLEARABLE)
    .filter(([key]) => key in update && (update as Record<string, unknown>)[key] === null)
    .map(([, column]) => column);

  const { data, error } = await client.rpc('update_invoice_review', {
    p_review_id: reviewId,
    p_supplier: update.supplier ?? null,
    p_detail: update.detail ?? null,
    p_amount: update.amount ?? null,
    p_amount_incl_gst: update.amountInclGst ?? null,
    p_invoice_number: update.invoiceNumber ?? null,
    p_dated: update.dated ?? null,
    p_due_on: update.dueOn ?? null,
    p_paid: update.paid ?? null,
    p_paid_on: update.paidOn ?? null,
    p_category: update.category ?? null,
    p_clear: clear,
  });
  return mapInvoiceReview(unwrap<Row>(data, error, "That didn’t save"));
}

/**
 * Yes — it becomes a real bill on the job.
 *
 * The server calls `create_quote`, the one door every other price comes
 * through, so an approved invoice is indistinguishable from one typed by hand.
 * A paid one also records its payment, and only where there is an amount for
 * the payment to be about.
 */
export async function approveInvoiceReview(
  client: SupabaseClient,
  reviewId: string,
  elementId?: string | null
): Promise<ProjectQuote> {
  const { data, error } = await client.rpc('approve_invoice_review', {
    p_review_id: reviewId,
    p_element_id: elementId ?? null,
  });
  return mapQuote(unwrap<Row>(data, error, "That didn’t save"));
}

/**
 * Where a waiting bill will land: none of the rooms is the whole job, one is
 * that room, and two or more keep it on the whole job shared between them.
 *
 * `amounts` is each room's share in the bill's own GST basis, or null for
 * "these rooms, not split". It is ignored for fewer than two rooms, because
 * one room takes the whole bill. The server is the one writer of where a card
 * lands, so the room and the split cannot disagree.
 */
export async function setInvoiceReviewRooms(
  client: SupabaseClient,
  reviewId: string,
  elementIds: string[],
  amounts: number[] | null
): Promise<InvoiceReview> {
  const { data, error } = await client.rpc('set_invoice_review_rooms', {
    p_review_id: reviewId,
    p_element_ids: elementIds,
    p_amounts: elementIds.length > 1 ? amounts : null,
  });
  return mapInvoiceReview(unwrap<Row>(data, error, "That didn’t save"));
}

/**
 * Which rooms a price on the whole job is for, replacing whatever it said.
 *
 * One call for the whole answer, for the reason `setSnagThings` is one call:
 * a picker with a Done button is answering one question. It changes nothing
 * about the price itself — the room breakdown reads it, and no total does.
 * An empty list clears it back to the whole job.
 */
export async function setQuoteRooms(
  client: SupabaseClient,
  quoteId: string,
  elementIds: string[],
  amounts: number[] | null
): Promise<ProjectQuoteRoom[]> {
  const { data, error } = await client.rpc('set_quote_rooms', {
    p_quote_id: quoteId,
    p_element_ids: elementIds,
    p_amounts: elementIds.length > 0 ? amounts : null,
  });
  if (error) throw asError(error, "That didn’t save");
  return ((data ?? []) as Row[]).map(mapQuoteRoom);
}

/** No — it leaves the deck, and it is still there to be put back. */
export async function declineInvoiceReview(
  client: SupabaseClient,
  reviewId: string
): Promise<InvoiceReview> {
  const { data, error } = await client.rpc('decline_invoice_review', { p_review_id: reviewId });
  return mapInvoiceReview(unwrap<Row>(data, error, "That didn’t save"));
}

/** The undo, and the reason declining is a state rather than a delete. */
export async function restoreInvoiceReview(
  client: SupabaseClient,
  reviewId: string
): Promise<InvoiceReview> {
  const { data, error } = await client.rpc('restore_invoice_review', { p_review_id: reviewId });
  return mapInvoiceReview(unwrap<Row>(data, error, "That didn’t save"));
}

/** For good. Its own call, so a swipe and a deletion are never one press. */
export async function deleteInvoiceReview(
  client: SupabaseClient,
  reviewId: string
): Promise<void> {
  const { error } = await client.rpc('delete_invoice_review', { p_review_id: reviewId });
  if (error) throw asError(error, "That didn’t delete");
}

// ------------------------------------------------------ reading the deck

/** The cards still waiting on a judgement, oldest bill first. */
export function pendingReviews(reviews: InvoiceReview[]): InvoiceReview[] {
  return reviews.filter((r) => r.state === 'pending');
}

/** The bin. Newest decision first, because a mistake is looked for straight after. */
export function declinedReviews(reviews: InvoiceReview[]): InvoiceReview[] {
  return reviews
    .filter((r) => r.state === 'declined')
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
}

/**
 * What the bell says when it is pressed.
 *
 * **Absent at nought, in the caller.** Like the shopping pill and *Fit* in
 * `PhotoViewer`, a bell with nothing behind it is a control dressed as a
 * choice — so this returns null there rather than "you have 0 objects to
 * review", and the header draws nothing.
 *
 * It counts **pending only**. The bin is reachable through the same bell, but
 * a declined card is not something to review; it is something already ruled
 * on, and counting it would make the number go up when somebody clears one.
 */
export function reviewAlert(reviews: InvoiceReview[]): string | null {
  const n = pendingReviews(reviews).length;
  if (n === 0) return null;
  return `You have ${n} object${n === 1 ? '' : 's'} to review`;
}

/**
 * What a card is called.
 *
 * The supplier is what somebody recognises — "ReliaBuilder" answers the
 * question before the amount does — and the invoice number disambiguates the
 * fourth one from them. With neither, the subject line the email arrived under
 * is better than nothing, and *An invoice* is the last resort rather than a
 * blank heading, on the same argument `snagHeadline` makes for a photo with no
 * words.
 */
export function invoiceReviewHeadline(review: InvoiceReview): string {
  const supplier = review.supplier?.trim();
  const number = review.invoiceNumber?.trim();
  if (supplier && number) return `${supplier} · ${number}`;
  if (supplier) return supplier;
  if (number) return number;
  const subject = review.sourceSubject?.trim();
  if (subject) return subject;
  return 'An invoice';
}

/** Where a project's bills are emailed: `<token>@` this. See `supabase/functions/inbound-bill`. */
export const BILLS_EMAIL_DOMAIN = 'bills.snaghq.co.nz';

/**
 * This project's address for emailed bills, minted the first time anybody asks.
 *
 * A bill forwarded here from the address somebody signs in with lands as a card
 * on this project and waits to be checked — nothing reaches a figure until it
 * is allocated.
 */
export async function getProjectInboxAddress(client: SupabaseClient, projectId: string): Promise<string> {
  const { data, error } = await client.rpc('project_inbox_token', { p_project_id: projectId });
  return `${unwrap<string>(data, error, "Couldn't get the address")}@${BILLS_EMAIL_DOMAIN}`;
}

/** A new address; the old one stops working. For an address that has got out. */
export async function rotateProjectInbox(client: SupabaseClient, projectId: string): Promise<string> {
  const { data, error } = await client.rpc('rotate_project_inbox', { p_project_id: projectId });
  return `${unwrap<string>(data, error, "Couldn't change the address")}@${BILLS_EMAIL_DOMAIN}`;
}

/**
 * Whether a field on this card is the app's guess rather than the invoice's
 * answer. The card dims and marks these; nothing else reads `inferred`.
 */
export function wasInferred(review: InvoiceReview, field: string): boolean {
  return review.inferred.includes(field);
}

/**
 * How the card states the paid answer, with what it was read from.
 *
 * Never the flag alone. "Paid" on its own is the app asserting something it
 * cannot see a bank statement for; "Paid — you replied *this is now paid* on
 * 7 Jul" is a reader being shown the evidence and left to disagree. Where
 * there is no evidence the wording says so rather than borrowing confidence it
 * has not got.
 */
export function describePaidInference(review: InvoiceReview): string {
  if (!review.paid) {
    return review.paidEvidence
      ? `Nothing in the thread says it was paid — ${review.paidEvidence}`
      : 'Nothing in the thread says it was paid';
  }
  return review.paidEvidence ? `Paid — ${review.paidEvidence}` : 'Paid — no sentence to show for it';
}

export * from './summary';
export * from './split';
