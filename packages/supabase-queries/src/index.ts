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
import { PRIORITY_ORDER, ROOM_SUGGESTIONS } from '@snag/shared-types';

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
    .select('id, display_name, created_at')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (error) throw asError(error, "Couldn't load your profile");
  if (!data) return null;
  return { id: data.id, displayName: data.display_name, createdAt: data.created_at };
}

export async function upsertProfile(
  client: SupabaseClient,
  displayName: string
): Promise<Profile> {
  const { data, error } = await client.rpc('upsert_profile', { p_display_name: displayName });
  const row = unwrap<Row>(data, error, "Couldn't save your name");
  return { id: row.id, displayName: row.display_name, createdAt: row.created_at };
}

/**
 * Returns null for someone who has signed up but isn't in a household yet —
 * the only branch the onboarding flow needs.
 */
export async function getMyHousehold(client: SupabaseClient): Promise<Household | null> {
  const { data, error } = await client
    .from('households')
    .select('id, name, created_at')
    .order('created_at')
    .limit(1)
    .maybeSingle();

  if (error) throw asError(error, "Couldn't load your household");
  if (!data) return null;
  return { id: data.id, name: data.name, createdAt: data.created_at };
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

/**
 * v1's entire "invite" flow: the other person signs up, then you add them by
 * the address they used. No tokens and no email delivery — which is also why
 * none of the ways the old invite pipeline failed silently can happen here.
 */
export async function addMemberByEmail(
  client: SupabaseClient,
  householdId: string,
  email: string,
  propertyIds?: string[]
): Promise<void> {
  const { error } = await client.rpc('add_member_by_email', {
    p_household_id: householdId,
    p_email: email,
    // Omitted means every property in the household, which is right while
    // there is one place and wrong the moment there is a bach — so the caller
    // passes an explicit list once there is more than one to choose between.
    p_property_ids: propertyIds ?? null,
  });
  if (error) throw asError(error, "That didn’t save");
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

/** Capture. Everything else about a snag is set later, in triage. */
export async function createSnag(
  client: SupabaseClient,
  input: {
    propertyId: string;
    room?: string | null;
    description?: string | null;
    photoPaths?: string[];
    priority?: SnagPriority | null;
    thingId?: string | null;
  }
): Promise<Snag> {
  const { data, error } = await client.rpc('create_snag', {
    p_property_id: input.propertyId,
    p_room: input.room ?? null,
    p_description: input.description ?? null,
    p_photo_paths: input.photoPaths ?? [],
    p_priority: input.priority ?? null,
    p_thing_id: input.thingId ?? null,
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
 * One field at a time, written immediately — the spec sheet has no Save button
 * for the same reason triage doesn't: a page of small independent facts behind
 * one button turns filling in a heat pump into forty taps and a commitment.
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

/**
 * Bring a room's dismissed suggestions back — all of them, not one at a time.
 * Dismissing is a tap; undoing it is a rescue, and a rescue that costs six taps
 * is a dead end.
 */
export async function restoreAbsentThings(
  client: SupabaseClient,
  propertyId: string,
  room?: string
): Promise<void> {
  const { error } = await client.rpc('restore_absent_things', {
    p_property_id: propertyId,
    p_room: room ?? null,
  });
  if (error) throw asError(error, "Couldn't bring those back");
}

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
