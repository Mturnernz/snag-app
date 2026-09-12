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


export const STATUS_ORDER: SnagStatus[] = ['open', 'doing', 'done'];
export const PRIORITY_ORDER: SnagPriority[] = ['high', 'low'];

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
   * Capture — a photo, or a line of text, from the bar at the foot of the list.
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
  /**
   * What it needs from the shop, in the words you'd read in the aisle.
   *
   * Was a yes/no. A tick told you a trip was needed and not what for, which is
   * the half of the problem that actually blocks a small job for weeks.
   */
  parts: string[];
  /** Derived from `parts` server-side, so the two can never disagree. */
  needsParts: boolean;
  dueAt: string | null;
  repeatDays: number | null;
  assigneeId: string | null;

  /**
   * What this snag is about, from the house record — the heat pump, the
   * hallway paint.
   *
   * Deliberately part of capture's tail rather than triage: saying what
   * something is about is the same gesture as tagging the room, so setting it
   * does NOT move a snag to 'doing'. Nulled rather than cascaded when the
   * thing is deleted, because what was wrong with the old dishwasher is still
   * what was wrong.
   */
  thingId: string | null;

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
  /** The thing it points at, for a card that can say so without a second read. */
  thingName: string | null;
  thingMake: string | null;
  thingModel: string | null;
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
  needsParts?: boolean;
}

export type SnagSort = 'newest' | 'oldest' | 'due' | 'priority';

// ------------------------------------------------------------- the house record

/**
 * The five kinds of thing a house record holds.
 *
 * The app ships two — `appliance` and `finish` — because those are the ones
 * with the sharpest read moments: a model number read out on a repair call, a
 * colour code read in a hardware aisle. The other three are in the enum from
 * the first migration so that adding them is a screen and not a migration.
 */
export type ThingKind = 'appliance' | 'finish' | 'fitting' | 'fabric' | 'contact';

/** The two that are built. Everything else is deliberately not offered yet. */
export const THING_KINDS: ThingKind[] = ['appliance', 'finish'];

export const THING_KIND_LABELS: Record<ThingKind, string> = {
  appliance: 'Appliance',
  finish: 'Paint',
  fitting: 'Fitting',
  fabric: 'The house',
  contact: 'Who to call',
};

/**
 * What each kind calls its two identifying strings.
 *
 * `make`/`model` carry the paint case as readily as the appliance one — Resene
 * / 7BB 83/018 sits in the same two columns as Bosch / SMS46MI01A, and both are
 * things somebody reads aloud to somebody else. Only the words change.
 */
export const THING_KIND_FIELD_LABELS: Record<ThingKind, { make: string; model: string }> = {
  appliance: { make: 'Make', model: 'Model' },
  finish: { make: 'Brand', model: 'Colour code' },
  fitting: { make: 'Brand', model: 'Part' },
  fabric: { make: 'Type', model: 'Spec' },
  contact: { make: 'Trade', model: 'Phone' },
};

/**
 * The per-kind tail, kept out of the columns.
 *
 * Paint uses `sheen`, `product`, `tint` and `leftOver`; an appliance uses none
 * of it. Values are strings because every one of them is read back rather than
 * computed on — a tint formula is not a number, it is a thing you hand to
 * someone behind a counter.
 */
export type ThingSpec = Record<string, string>;

/** The spec keys paint offers, in the order the sheet shows them. */
export const FINISH_SPEC_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'sheen', label: 'Sheen', placeholder: 'Low sheen' },
  { key: 'product', label: 'Product', placeholder: 'Zylone Sheen' },
  { key: 'tint', label: 'Tint formula', placeholder: 'BS2 · Y 12.5 · R 3.0' },
  { key: 'leftOver', label: "What's left", placeholder: '~4L, garage top shelf' },
];

/**
 * Something in the house, as opposed to something wrong with it.
 *
 * A thing needs a photo, a name or a model number and nothing else — the same
 * shape as a snag, for the same reason. The failure mode this is built against
 * is the thirty-field form that never gets filled in.
 */
export interface Thing {
  id: string;
  householdId: string;
  propertyId: string;
  kind: ThingKind;

  /** Capture: a photograph of the label, and four seconds of tapping. */
  name: string | null;
  /** TEXT server-side, so removing a room tag never rewrites what is filed under it. */
  room: string | null;
  photoPaths: string[];

  make: string | null;
  model: string | null;
  serial: string | null;

  /** What you re-buy for it. This is what a snag's parts list inherits. */
  consumables: string[];

  installedAt: string | null;
  warrantyUntil: string | null;
  /** Feeds `repeatDays` on a snag about this thing, rather than scheduling anything itself. */
  serviceDays: number | null;
  spec: ThingSpec;
  notes: string | null;

  createdBy: string;
  createdAt: string;
  updatedAt: string;

  /** Joined in by `home.things_with_details`. */
  propertyName: string;
  snagCount: number;
  openSnagCount: number;
}

/**
 * How the record is grouped on screen.
 *
 * By room for when you are standing in one; by kind for "what appliances do we
 * actually have". Search sits above both and is the primary control, because
 * every read moment starts with a half-remembered noun.
 */
export type ThingGrouping = 'room' | 'kind';


// ---------------------------------------------------------------- navigation

export type RootStackParamList = {
  Main: undefined;
  SnagDetail: { snagId: string };
  Household: undefined;
  /** Profile → Location tags. Editing the pick-list capture offers. */
  LocationTags: undefined;
  /** A thing's spec sheet. Presented as a sheet, like SnagDetail. */
  ThingDetail: { thingId: string };
};

export type MainTabParamList = {
  /**
   * The list, and the app's home.
   *
   * There is no Capture tab: adding something is a compose bar at the foot of
   * this screen, not a place you navigate to. Opening on the list is how one
   * person finds out what the other added — with no notifications anywhere in
   * this product, it is the only channel there is.
   */
  Snags: undefined;
  /**
   * The house record — what's *there*, beside the list of what's wrong.
   *
   * Named "House" rather than "My House" because the moment there is a bach,
   * "my house" is the wrong name for half of what the tab holds. The property
   * name goes in the screen header instead, through the same picker capture
   * has.
   */
  House: undefined;
  Profile: undefined;
};
