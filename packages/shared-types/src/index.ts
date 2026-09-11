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
export type SnagPriority = 'now' | 'soon' | 'someday';
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
  now: 'Now',
  soon: 'Soon',
  someday: 'Someday',
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
export const PRIORITY_ORDER: SnagPriority[] = ['now', 'soon', 'someday'];
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
 * There is exactly one of these per household in v1 and the UI never shows it.
 * It is a real row because `snags.property_id` is not-null.
 */
export interface Property {
  id: string;
  householdId: string;
  name: string;
}

export interface Snag {
  id: string;
  reference: string;
  householdId: string;
  propertyId: string;

  /** Capture — all anyone provides standing in the room. */
  title: string;
  room: string | null;
  photoPaths: string[];
  description: string | null;

  /** Triage — added later, from the list. */
  status: SnagStatus;
  priority: SnagPriority | null;
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
