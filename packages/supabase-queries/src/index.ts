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
  SnagFilter,
  SnagPriority,
  SnagSort,
  SnagStatus,
  Thing,
  ThingKind,
  ThingSpec,
  ThingSuggestion,
  AbsentThing,
} from '@snag/shared-types';
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  ROOM_SUGGESTIONS,
  STATUS_LABELS,
  THING_KIND_LABELS,
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
    description: row.description ?? null,
    status: row.status,
    priority: row.priority ?? null,
    parts: row.parts ?? [],
    needsParts: !!row.needs_parts,
    dueAt: row.due_at ?? null,
    repeatDays: row.repeat_days ?? null,
    assigneeId: row.assignee_id ?? null,
    thingId: row.thing_id ?? null,
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
    .select('id, display_name, created_at, deleted_at')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (error) throw asError(error, "Couldn't load your profile");
  if (!data) return null;
  return {
    id: data.id,
    displayName: data.display_name,
    createdAt: data.created_at,
    deletedAt: data.deleted_at ?? null,
  };
}

export async function upsertProfile(
  client: SupabaseClient,
  displayName: string
): Promise<Profile> {
  const { data, error } = await client.rpc('upsert_profile', { p_display_name: displayName });
  const row = unwrap<Row>(data, error, "Couldn't save your name");
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    deletedAt: row.deleted_at ?? null,
  };
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
    .select('id, household_id, name, property_members(count)')
    .order('created_at');

  if (error) throw asError(error, "Couldn't load your properties");
  return (data ?? []).map((row: Row) => ({
    id: row.id,
    householdId: row.household_id,
    name: row.name,
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
  return { id: row.id, householdId: row.household_id, name: row.name, memberCount: 1 };
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
  if (filter.priority?.length) query = query.in('priority', filter.priority);
  if (filter.needsParts !== undefined) query = query.eq('needs_parts', filter.needsParts);
  if (filter.dueOnly) query = query.not('due_at', 'is', null).lte('due_at', new Date().toISOString());

  switch (sort) {
    case 'oldest':
      query = query.order('created_at', { ascending: true });
      break;
    case 'due':
      query = query.order('due_at', { ascending: true, nullsFirst: false });
      break;
    case 'priority':
      // Postgres orders enums by declaration order, which is now → soon →
      // someday. Unset priority sorts last rather than first.
      query = query.order('priority', { ascending: true, nullsFirst: false });
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
    priority?: SnagPriority | null;
    thingId?: string | null;
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
    p_priority: input.priority ?? null,
    p_thing_id: input.thingId ?? null,
    p_due_at: input.dueAt ?? null,
    p_repeat_days: input.repeatDays ?? null,
  });
  const row = unwrap<Row>(data, error, "Couldn't save that");
  // create_snag returns the base row, not the joined view.
  return getSnag(client, row.id);
}

export interface SnagUpdate {
  room?: string | null;
  description?: string | null;
  priority?: SnagPriority | null;
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
}

const CLEARABLE: Record<string, string> = {
  room: 'room',
  description: 'description',
  priority: 'priority',
  dueAt: 'due_at',
  repeatDays: 'repeat_days',
  assigneeId: 'assignee_id',
  thingId: 'thing_id',
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
    p_priority: update.priority ?? null,
    p_due_at: update.dueAt ?? null,
    p_repeat_days: update.repeatDays ?? null,
    p_assignee_id: update.assigneeId ?? null,
    p_photo_paths: update.photoPaths ?? null,
    p_parts: update.parts ?? null,
    p_thing_id: update.thingId ?? null,
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Takes what somebody typed and returns a date Postgres will accept, or null.
 *
 * The column is a real `date`, so an unparsed "Nov 2019" is a 22008 raised
 * from inside an RPC — a database error surfaced to somebody who answered the
 * question correctly. This accepts every form the label and the person are
 * likely to use: `2019`, `2019-11`, `11/2019`, `Nov 2019`, `November 2019`,
 * `2019-11-08`, `8 Nov 2019`. A missing day is the first of the month, which
 * `formatLooseDate` then declines to show back.
 *
 * Returns `undefined` when it cannot tell — the caller keeps what was typed and
 * says so, rather than silently discarding it or storing a wrong date.
 */
export function parseLooseDate(input: string): string | null | undefined {
  const text = input.trim();
  if (!text) return null;

  const iso = (y: number, m: number, d: number) =>
    `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

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
export type ScheduleKind = 'filed' | 'done' | 'due' | 'next';

export interface ScheduleMark {
  /** Local `YYYY-MM-DD`, which is what a calendar cell is keyed by. */
  day: string;
  kind: ScheduleKind;
  snag: Snag;
}

/** The order marks are listed and drawn in: what happened, then what's coming. */
const KIND_ORDER: ScheduleKind[] = ['filed', 'done', 'due', 'next'];

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
export function scheduleMarks(snags: Snag[], from: Date, to: Date): ScheduleMark[] {
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
      'Reference', 'What', 'Room', 'Status', 'Priority', 'Needs parts', 'Parts',
      'Due', 'Repeats', 'About', 'Assigned to', 'Filed by', 'Filed', 'Done', 'Photos',
    ],
    rows: snags.map((snag) => [
      snag.reference,
      snagHeadline(snag),
      snag.room ?? '',
      STATUS_LABELS[snag.status] ?? snag.status,
      snag.priority ? PRIORITY_LABELS[snag.priority] : '',
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
