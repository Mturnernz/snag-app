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
  Profile,
  Property,
  Snag,
  SnagEffort,
  SnagFilter,
  SnagPriority,
  SnagSort,
  SnagStatus,
} from '@snag/shared-types';
import { EFFORT_ORDER, PRIORITY_ORDER } from '@snag/shared-types';

/** Supabase row shapes are snake_case `any`; this is the one place that's true. */
type Row = Record<string, any>;

// ---------------------------------------------------------------- mapping

function mapSnag(row: Row): Snag {
  return {
    id: row.id,
    reference: row.reference,
    householdId: row.household_id,
    propertyId: row.property_id,
    title: row.title,
    room: row.room ?? null,
    photoPaths: row.photo_paths ?? [],
    description: row.description ?? null,
    status: row.status,
    priority: row.priority ?? null,
    effort: row.effort ?? null,
    needsParts: !!row.needs_parts,
    dueAt: row.due_at ?? null,
    repeatDays: row.repeat_days ?? null,
    assigneeId: row.assignee_id ?? null,
    reporterId: row.reporter_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastDoneAt: row.last_done_at ?? null,
    doneAt: row.done_at ?? null,
    propertyName: row.property_name,
    reporterName: row.reporter_name,
    assigneeName: row.assignee_name ?? null,
    commentCount: row.comment_count ?? 0,
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

function unwrap<T>(data: T | null, error: { message: string } | null, what: string): T {
  if (error) throw new Error(`${what}: ${error.message}`);
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

  if (error) throw new Error(`Couldn't load your profile: ${error.message}`);
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

  if (error) throw new Error(`Couldn't load your household: ${error.message}`);
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

  if (error) throw new Error(`Couldn't load the household: ${error.message}`);
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
  email: string
): Promise<void> {
  const { error } = await client.rpc('add_member_by_email', {
    p_household_id: householdId,
    p_email: email,
  });
  if (error) throw new Error(error.message);
}

/** One row per household in v1; the UI never shows it. */
export async function getDefaultProperty(
  client: SupabaseClient,
  householdId: string
): Promise<Property | null> {
  const { data, error } = await client
    .from('properties')
    .select('id, household_id, name')
    .eq('household_id', householdId)
    .order('created_at')
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Couldn't load the property: ${error.message}`);
  if (!data) return null;
  return { id: data.id, householdId: data.household_id, name: data.name };
}

// ---------------------------------------------------------------- snags

export async function getSnags(
  client: SupabaseClient,
  filter: SnagFilter = {},
  sort: SnagSort = 'newest'
): Promise<Snag[]> {
  let query = client.from('snags_with_details').select('*');

  if (filter.status?.length) query = query.in('status', filter.status);
  if (filter.room) query = query.eq('room', filter.room);
  if (filter.assigneeId) query = query.eq('assignee_id', filter.assigneeId);
  if (filter.priority?.length) query = query.in('priority', filter.priority);
  if (filter.needsParts !== undefined) query = query.eq('needs_parts', filter.needsParts);
  if (filter.dueOnly) query = query.not('due_at', 'is', null).lte('due_at', new Date().toISOString());
  if (filter.maxEffort) {
    // "Everything I could finish in half a day" means quick *and* half_day, so
    // this is a ceiling rather than an equality — and an item nobody has sized
    // yet is included, because excluding it hides work behind a missing field.
    const allowed = EFFORT_ORDER.slice(0, EFFORT_ORDER.indexOf(filter.maxEffort) + 1);
    query = query.or(`effort.in.(${allowed.join(',')}),effort.is.null`);
  }

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
  if (error) throw new Error(`Couldn't load the list: ${error.message}`);
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

/** Capture. Everything else about a snag is set later, in triage. */
export async function createSnag(
  client: SupabaseClient,
  input: {
    propertyId: string;
    title: string;
    room?: string | null;
    photoPaths?: string[];
    description?: string | null;
  }
): Promise<Snag> {
  const { data, error } = await client.rpc('create_snag', {
    p_property_id: input.propertyId,
    p_title: input.title,
    p_room: input.room ?? null,
    p_photo_paths: input.photoPaths ?? [],
    p_description: input.description ?? null,
  });
  const row = unwrap<Row>(data, error, "Couldn't save that");
  // create_snag returns the base row, not the joined view.
  return getSnag(client, row.id);
}

export interface SnagUpdate {
  title?: string;
  room?: string | null;
  description?: string | null;
  priority?: SnagPriority | null;
  effort?: SnagEffort | null;
  needsParts?: boolean;
  dueAt?: string | null;
  repeatDays?: number | null;
  assigneeId?: string | null;
  photoPaths?: string[];
}

const CLEARABLE: Record<string, string> = {
  room: 'room',
  description: 'description',
  priority: 'priority',
  effort: 'effort',
  dueAt: 'due_at',
  repeatDays: 'repeat_days',
  assigneeId: 'assignee_id',
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
    p_title: update.title ?? null,
    p_room: update.room ?? null,
    p_description: update.description ?? null,
    p_priority: update.priority ?? null,
    p_effort: update.effort ?? null,
    p_needs_parts: update.needsParts ?? null,
    p_due_at: update.dueAt ?? null,
    p_repeat_days: update.repeatDays ?? null,
    p_assignee_id: update.assigneeId ?? null,
    p_photo_paths: update.photoPaths ?? null,
    p_clear: clear,
  });

  if (error) throw new Error(error.message);
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
  if (error) throw new Error(error.message);
  return getSnag(client, snagId);
}

export async function deleteSnag(client: SupabaseClient, snagId: string): Promise<void> {
  const { error } = await client.rpc('delete_snag', { p_snag_id: snagId });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- comments

export async function getComments(client: SupabaseClient, snagId: string): Promise<Comment[]> {
  const { data, error } = await client
    .from('comments')
    .select('id, snag_id, author_id, body, created_at, author:profiles!inner(display_name)')
    .eq('snag_id', snagId)
    .order('created_at');

  if (error) throw new Error(`Couldn't load the comments: ${error.message}`);
  return (data ?? []).map(mapComment);
}

export async function addComment(
  client: SupabaseClient,
  snagId: string,
  body: string
): Promise<void> {
  const { error } = await client.rpc('add_comment', { p_snag_id: snagId, p_body: body });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- rooms

/**
 * The rooms already used in this household, most-used first.
 *
 * Rooms are free text on the snag rather than a table, so this is the whole of
 * the "room registry" — nobody administers a list of rooms before they can log
 * a dripping tap. It powers the suggestions under the capture field.
 */
export async function getKnownRooms(
  client: SupabaseClient,
  householdId: string
): Promise<string[]> {
  const { data, error } = await client
    .from('snags')
    .select('room')
    .eq('household_id', householdId)
    .not('room', 'is', null);

  if (error) throw new Error(`Couldn't load rooms: ${error.message}`);

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Row[]) {
    counts.set(row.room, (counts.get(row.room) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([room]) => room);
}

// ---------------------------------------------------------------- weekend

export interface WeekendPlan {
  /** Everything that fits, grouped so one room's jobs get done together. */
  byRoom: { room: string; snags: Snag[] }[];
  /** Pulled to the top: one hardware-store trip clears all of these. */
  shoppingList: Snag[];
  total: number;
}

/**
 * The answer to "what can I get done today", which is a different question from
 * "what's outstanding" and the reason the plain list isn't enough.
 *
 * Grouping is by room because that's how the work is actually batched — you do
 * the garage once. The parts list is separate because the trip to the hardware
 * store is the thing that blocks a small job for weeks.
 */
export function planWeekend(snags: Snag[]): WeekendPlan {
  const open = snags.filter((s) => s.status !== 'done');

  const rooms = new Map<string, Snag[]>();
  for (const snag of open) {
    const room = snag.room ?? 'Everywhere else';
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room)!.push(snag);
  }

  const priorityRank = (s: Snag) =>
    s.priority ? PRIORITY_ORDER.indexOf(s.priority) : PRIORITY_ORDER.length;

  const byRoom = [...rooms.entries()]
    .map(([room, items]) => ({
      room,
      snags: items.sort((a, b) => priorityRank(a) - priorityRank(b)),
    }))
    // Most work first: a room with four jobs is the one worth starting in.
    .sort((a, b) => b.snags.length - a.snags.length || a.room.localeCompare(b.room));

  return {
    byRoom,
    shoppingList: open.filter((s) => s.needsParts).sort((a, b) => priorityRank(a) - priorityRank(b)),
    total: open.length,
  };
}

// ---------------------------------------------------------------- due dates

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
