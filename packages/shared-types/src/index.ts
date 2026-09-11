/**
 * The canonical types for Snag, shared by every client.
 *
 * These mirror the `home` schema (supabase/migrations/20260911090000_home_schema.sql).
 * `apps/mobile/src/types/index.ts` re-exports this package; don't add types there.
 *
 * The retired B2B model — lanes, severities, investigations, work groups, sites,
 * roles — is gone. It is recoverable from git at 604a62c if ever needed.
 */

// ---------------------------------------------------------------- enums

export type SnagStatus = 'open' | 'doing' | 'done';
export type SnagPriority = 'high' | 'low';
export type SnagEffort = 'quick' | 'half_day' | 'big_job';

/**
 * Unused by the UI in v1 — both members are owners and nothing gates on this.
 * It exists so a shared bach (a family reports, the owner fixes) doesn't need a
 * backfill later. See SNAG_HOME_PIVOT_REVIEW.md.
 */
export type MemberRole = 'owner' | 'member';

// ---------------------------------------------------------------- labels
//
// One vocabulary, so a label can't drift between the list, the detail screen
// and the filter bar.

export const STATUS_LABELS: Record<SnagStatus, string> = {
  open: 'Open',
  doing: 'Doing',
  done: 'Done',
};

export const PRIORITY_LABELS: Record<SnagPriority, string> = {
  high: 'High',
  low: 'Low',
};

/**
 * Deliberately phrased as time, not size: the question these answer is "can I
 * finish this today", which is what the weekend view is filtering on.
 */
export const EFFORT_LABELS: Record<SnagEffort, string> = {
  quick: 'Under an hour',
  half_day: 'Half a day',
  big_job: 'Big job',
};

export const EFFORT_SHORT_LABELS: Record<SnagEffort, string> = {
  quick: 'Quick',
  half_day: 'Half day',
  big_job: 'Big job',
};

export const STATUS_ORDER: SnagStatus[] = ['open', 'doing', 'done'];
export const PRIORITY_ORDER: SnagPriority[] = ['high', 'low'];
export const EFFORT_ORDER: SnagEffort[] = ['quick', 'half_day', 'big_job'];

/**
 * Offered when someone sets a repeat. Free-form days are still accepted by the
 * RPC; these are just the intervals a house actually runs on.
 */
export const REPEAT_PRESETS: { days: number; label: string }[] = [
  { days: 30, label: 'Monthly' },
  { days: 90, label: 'Every 3 months' },
  { days: 182, label: 'Every 6 months' },
  { days: 365, label: 'Yearly' },
];

// ---------------------------------------------------------------- rows

export interface Household {
  id: string;
  name: string;
  createdAt: string;
}

export interface Profile {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface HouseholdMember {
  householdId: string;
  profileId: string;
  displayName: string;
  role: MemberRole;
}

/**
 * A place — the house, and later the bach.
 *
 * A property is not a location tag. Tags say where in a place something is;
 * a property is the place, has its own people, and its own tag list. The
 * picker renders only when someone is linked to more than one, so a
 * single-property household never sees the concept at all.
 */
export interface Property {
  id: string;
  householdId: string;
  name: string;
  /** How many people are linked to it. Only shown when there's a choice. */
  memberCount?: number;
}

/**
 * A location tag offered at capture, scoped to one property.
 *
 * Seeded per property so the chips are full the moment a place exists — which
 * is the day someone decides whether it's worth using. A list derived from
 * past use is empty exactly then. Per property rather than per household
 * because a bach has a boatshed and a house has a laundry.
 */
export interface Location {
  id: string;
  propertyId: string;
  name: string;
  sortOrder: number;
}

export interface Snag {
  id: string;
  reference: string;
  householdId: string;
  propertyId: string;

  /**
   * Capture — four taps and, at most, one short line.
   *
   * There is no title: a photo of a broken toilet seat says what a title would,
   * and requiring one put a keyboard between someone and the thing in front of
   * them. A snag needs a photo OR a description; one with neither is nothing.
   */
  room: string | null;
  photoPaths: string[];
  description: string | null;
  /** Set at capture — the one judgement only the person standing there can make. */
  priority: SnagPriority | null;

  /** Triage — added later, from the list. */
  status: SnagStatus;
  effort: SnagEffort | null;
  needsParts: boolean;
  dueAt: string | null;
  repeatDays: number | null;
  assigneeId: string | null;

  reporterId: string;
  createdAt: string;
  updatedAt: string;
  /** A repeating snag never reaches 'done', so this is where completion lands. */
  lastDoneAt: string | null;
  doneAt: string | null;

  /** Joined in by `home.snags_with_details`. */
  propertyName: string;
  reporterName: string;
  assigneeName: string | null;
  commentCount: number;
}

export interface Comment {
  id: string;
  snagId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

// ---------------------------------------------------------------- filtering

export interface SnagFilter {
  /** Which place. Omitted means every property you're linked to. */
  propertyId?: string | null;
  status?: SnagStatus[];
  room?: string | null;
  assigneeId?: string | null;
  priority?: SnagPriority[];
  /** Only items with a due date at or before now. */
  dueOnly?: boolean;
  /** Ceiling for the weekend view: everything at or under this effort. */
  maxEffort?: SnagEffort;
  needsParts?: boolean;
}

export type SnagSort = 'newest' | 'oldest' | 'due' | 'priority';

// ---------------------------------------------------------------- navigation

export type RootStackParamList = {
  Main: undefined;
  SnagDetail: { snagId: string };
  Household: undefined;
};

export type MainTabParamList = {
  /** Quick capture. The app opens here — it's the thing done most often. */
  Capture: undefined;
  Snags: undefined;
  Weekend: undefined;
  Profile: undefined;
};
