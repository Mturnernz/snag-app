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

export const PRIORITY_ORDER: SnagPriority[] = ['high', 'low'];

/**
 * The intervals a house actually runs on — one vocabulary, two selections from
 * it, and every one of them a whole number of months or years.
 *
 * **That last part is load-bearing and was broken.** `describeCycle` only
 * reaches months on a multiple of 30, so the six-month repeat at 182 days came
 * back out as "26 weeks" — the app failing to say back the words on the chip
 * somebody had just pressed. Worse, the service sheet used **180** for the same
 * phrase, so "every 6 months" meant two different numbers depending on which
 * screen set it, and a service scheduled at 180 days became a snag repeating at
 * 180 while a repeat chosen at 182 stayed 182. Same intent, two numbers, two
 * different sentences.
 *
 * So six months is 180 days everywhere. It is not half of 365, and that is
 * fine: this is a list of household chores, not an amortisation schedule, and
 * the number nobody types matters far less than the words everybody reads.
 *
 * `cycles.test.ts` pins the property rather than the values — every day count
 * either list offers must describe in months or years, never in weeks or days.
 */
export const REPEAT_PRESETS: { days: number; label: string }[] = [
  { days: 30, label: 'Monthly' },
  { days: 90, label: 'Every 3 months' },
  { days: 180, label: 'Every 6 months' },
  { days: 365, label: 'Yearly' },
];

/**
 * What a thing is serviced on. A different selection from the same vocabulary,
 * deliberately: a chore repeats monthly, a heat pump does not, and a heat pump
 * can run two years between services where a gutter cannot.
 *
 * It lived in `ThingDetailScreen` as a bare array, which is how it came to
 * disagree with the list above about what six months is. Here, beside it, the
 * two are visibly one family.
 */
export const SERVICE_CYCLES: number[] = [90, 180, 365, 730];

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
  /**
   * Set when the account behind this profile was deleted.
   *
   * The row stays: `snags.reporter_id`, `comments.author_id` and
   * `things.created_by` are NOT NULL, so a household that survives somebody
   * leaving still names them. The name is replaced, which is the part that was
   * theirs. See `20260915091000`.
   */
  deletedAt?: string | null;
}

/**
 * Somebody invited to a household who hasn't answered yet.
 *
 * It waits on an *address*, not an account, which is the whole point: you can
 * invite your partner before they have signed up, in whatever order suits. When
 * an account appears on that address, the invitation is there waiting.
 *
 * **Nothing emails them and the app never says it did.** That is the line the
 * retired product crossed — "Invite sent", nothing sent, for the life of the
 * feature. Telling them is still something you do out loud; what the row buys
 * is that they no longer have to finish signing up before you can type their
 * address.
 */
export interface Invitation {
  id: string;
  householdId: string;
  /**
   * Null for a link invitation — the QR kind, which is addressed to whoever
   * holds it rather than to anybody in particular.
   *
   * Exactly one of `email` and `token` is ever set (`invitations_addressed_one_way`).
   * Deliberately one table and one accept path rather than two mechanisms: the
   * moment there are two ways to join a household, neither is trustworthy.
   */
  email: string | null;
  /** Set for a link invitation. The URL is `<APP_URL>/join/<token>`. */
  token?: string | null;
  /** Set for a link invitation. A code is short-lived; that is its whole security model. */
  expiresAt?: string | null;
  /** Empty means every property in the household. */
  propertyIds: string[];
  invitedBy: string;
  createdAt: string;
}

/**
 * What somebody scanning a code is told before they answer.
 *
 * `alreadyAMember` is there so a second scan reads as "you're already in"
 * rather than as an invitation — people do scan twice.
 */
export interface InvitationByToken {
  id: string;
  householdId: string;
  householdName: string;
  invitedByName: string;
  expiresAt: string;
  alreadyAMember: boolean;
}

/** An invitation seen from the other end, by the person it names. */
export interface InvitationToMe {
  id: string;
  householdId: string;
  householdName: string;
  invitedByName: string;
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
  /**
   * Suburb and town, for the one question a property name cannot answer:
   * *near here*.
   *
   * Suburb and town rather than a street address, because the only thing it is
   * read for is finding a tradesman in the right part of the country, and it
   * rides out of the app in every briefed extract — a file that gets forwarded.
   * The precision a street number would add is precision nobody needs and
   * everybody who receives the PDF would then hold.
   */
  suburb: string | null;
  town: string | null;
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

/** On a chip, where it names one thing. */
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
export const THING_KIND_FIELD_LABELS: Record<
  ThingKind,
  { make: string; model: string; notes: string }
> = {
  appliance: { make: 'Make', model: 'Model', notes: 'Notes' },
  // A paint's note is not an afterthought, it is what tells two of them apart:
  // a bathroom holds Half Spanish White on the main wall and Quarter Alabaster
  // on the windows, and "Notes" is the wrong word for the only thing
  // distinguishing them.
  finish: { make: 'Brand', model: 'Colour code', notes: 'Where it went' },
  fitting: { make: 'Brand', model: 'Part', notes: 'Notes' },
  fabric: { make: 'Type', model: 'Spec', notes: 'Notes' },
  contact: { make: 'Trade', model: 'Phone', notes: 'What they did' },
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
  /** Manuals and receipts, in `home-photos` under `<household_id>/docs/`. */
  documentPaths: string[];

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
 * What a New Zealand house probably has, room by room.
 *
 * This is the furniture the House tab arrives holding: every room shows a
 * greyed, dashed entry for each of these until somebody records the real one.
 * **A suggestion is never a row.** It lives here, in a constant, and it never
 * reaches `home.things`, never appears in search, and can never be pointed at
 * by a snag — because a record full of entries nobody has confirmed looks full
 * and answers nothing, which is worse than an empty one. You believe it, check
 * it in the shop, and find nothing there.
 *
 * A constant rather than a table, for the same reason the seeded order of
 * `home.locations` is one: it is an interface, not data. "What a house has"
 * changes far less often than "what this house calls its rooms", and changing
 * it should cost nothing.
 *
 * **Only `appliance` and `finish` appear here**, because those are the two
 * kinds the app can actually record properly. The obvious absentees — the toby,
 * the switchboard, the meter numbers, bathroom tapware, bulb fittings — are
 * `fabric` and `fitting`, and suggesting something the spec sheet cannot then
 * describe is how a prompt becomes a dead end. They arrive with those kinds.
 *
 * Keyed by the seeded room names exactly. A room with no entry here simply
 * arrives empty, which is the right answer for `Elsewhere`.
 *
 * **The paint prompt is one general one per room, and it works differently from
 * the rest.** A room has one rangehood and a name for it; a room has several
 * paints and the names are colours — Half Spanish White on the main wall,
 * Quarter Alabaster on the windows. So the prompt is just "Paint", it is
 * answered by *any* finish recorded in that room (see `ghostsForRoom`), and the
 * second and third ones are added from the +, which offers Paint in every room
 * whatever is already recorded. A prompt that stayed up after the first paint
 * would be nagging; one that only ever allowed one would be wrong.
 */
export interface ThingSuggestion {
  name: string;
  kind: ThingKind;
}

export const ROOM_SUGGESTIONS: Record<string, ThingSuggestion[]> = {
  Kitchen: [
    { name: 'Oven', kind: 'appliance' },
    { name: 'Cooktop', kind: 'appliance' },
    { name: 'Rangehood', kind: 'appliance' },
    { name: 'Dishwasher', kind: 'appliance' },
    { name: 'Fridge/freezer', kind: 'appliance' },
    { name: 'Waste disposal', kind: 'appliance' },
    { name: 'Paint', kind: 'finish' },
  ],
  Bathroom: [
    { name: 'Extractor fan', kind: 'appliance' },
    { name: 'Heated towel rail', kind: 'appliance' },
    { name: 'Paint', kind: 'finish' },
  ],
  Bedroom: [
    { name: 'Heat pump head', kind: 'appliance' },
    { name: 'Smoke alarm', kind: 'appliance' },
    { name: 'Paint', kind: 'finish' },
  ],
  'Living room': [
    { name: 'Heat pump · indoor', kind: 'appliance' },
    { name: 'Wood burner', kind: 'appliance' },
    { name: 'Paint', kind: 'finish' },
  ],
  Laundry: [
    { name: 'Washing machine', kind: 'appliance' },
    { name: 'Dryer', kind: 'appliance' },
    { name: 'Water filter', kind: 'appliance' },
    { name: 'Paint', kind: 'finish' },
  ],
  Hallway: [
    { name: 'Smoke alarm', kind: 'appliance' },
    { name: 'Heat pump controller', kind: 'appliance' },
    { name: 'Paint', kind: 'finish' },
  ],
  Garage: [
    { name: 'Garage door opener', kind: 'appliance' },
    { name: 'Hot water cylinder', kind: 'appliance' },
    { name: 'Lawnmower', kind: 'appliance' },
    { name: 'Water blaster', kind: 'appliance' },
    { name: 'Paint', kind: 'finish' },
  ],
  Outside: [
    { name: 'Gas water heater', kind: 'appliance' },
    { name: 'Heat pump · outdoor unit', kind: 'appliance' },
    { name: 'Stain', kind: 'finish' },
  ],
  Deck: [
    { name: 'Stain', kind: 'finish' },
  ],
  Roof: [
    // A roof is coated rather than painted, and saying so is the difference
    // between a prompt that reads as knowing the subject and one that reads as
    // generated. Spouting, cladding and skylights wait for the `fabric` kind.
    { name: 'Roof coating', kind: 'finish' },
  ],
  // Piles, subfloor insulation, the toby, the sewer gully — all `fabric`, none
  // of it paint. Empty on purpose until that kind lands, because the generic
  // paint prompt every unknown room gets would be nonsense down here.
  'Under the house': [],
  // Present and empty on purpose, which is different from absent. `Elsewhere`
  // is the location seed's escape hatch — the room whose whole meaning is
  // "somewhere else" — and suggesting its contents is nonsense. A room that is
  // simply *absent* from this table is an unknown room somebody added, and gets
  // the paint prompt every room deserves. See `suggestionsForRoom`.
  Elsewhere: [],
};

/**
 * What this particular place hasn't got.
 *
 * The only thing the server remembers about suggestions, and it is the
 * negative: a flat with no dryer should stop being asked about a dryer. Per
 * property rather than per person — there is one house, and two people
 * disagreeing about whether there is a dryer is not a state worth modelling.
 */
export interface AbsentThing {
  propertyId: string;
  room: string;
  name: string;
}


// ---------------------------------------------------------------- advice
//
// What came back when somebody asked about the list.
//
// The loop is deliberately outside the app: a briefed PDF goes out, an answer
// comes back as text, and `parseSnagActions` turns it into rows. Nothing here
// is written by the app itself, which is why every field is treated as a claim
// rather than a fact — see `SnagAdvice.source`.

/**
 * Whether the person holding the phone can do it.
 *
 * `unclear` is a first-class answer, not a failure. A photograph of a damp
 * patch cannot say whether the pipe behind it is leaking, and an assessment
 * that guesses confidently is worse than one that says what it would need to
 * see — which is what `needToSee` carries.
 */
export type AdviceVerdict = 'diy' | 'trade' | 'unclear';

export const ADVICE_VERDICT_LABELS: Record<AdviceVerdict, string> = {
  diy: 'You can probably do this',
  trade: 'This needs a tradesman',
  unclear: "Can't tell from the photo",
};

/**
 * One thing to buy, and the two facts that make a shopping list worth having.
 *
 * Both are optional because an answer that knows the part but not the shop is
 * still most of the way there, and dropping the row for the missing half would
 * lose the part as well.
 */
export interface AdvicePart {
  item: string;
  /** "Mitre 10", "an appliance parts place" — where, in words. */
  where: string | null;
  /** A range as written, "35-45". Never parsed into a number: see below. */
  approxNzd: string | null;
}

/**
 * Somebody to ring.
 *
 * **`source` is not optional, and that is the whole point.** A model asked for
 * three local tradesmen will produce three plausible names with three
 * plausible-looking mobile numbers whether or not they exist, and they arrive
 * looking exactly like the real thing. So the brief requires a URL the name was
 * found at, and a tradesman with nowhere it came from is dropped by the parser
 * rather than shown unsourced.
 *
 * The two costs are split because "about $200" means something different as a
 * callout fee and as a total, and the difference is the one a household
 * actually decides on: four jobs batched into one visit pay the callout once.
 */
export interface AdviceTradie {
  name: string;
  phone: string | null;
  url: string | null;
  /** Where this name was found. Required — an unsourced name is dropped. */
  source: string;
  /** "180" — what it costs to get them to the door. */
  calloutNzd: string | null;
  /** "180-260" — callout and the work, as a range. */
  totalNzd: string | null;
}

/**
 * The answer for one snag.
 *
 * **Money and quantities stay strings.** They are quoted back exactly as they
 * arrived, with the date they arrived on, because parsing "35-45" into a number
 * is the app asserting a precision the answer never had — and a stale price
 * that says when it was given is useful, while a stale price rendered as data
 * is a number somebody budgets against.
 */
export interface SnagAdvice {
  snagId: string;
  diagnosis: string;
  verdict: AdviceVerdict;
  /** Why it is a trade job — the regulation, the risk, the tool nobody owns. */
  reason: string | null;
  steps: string[];
  parts: AdvicePart[];
  /** "plumber", "registered electrician" — null when it is a DIY job. */
  trade: string | null;
  tradies: AdviceTradie[];
  /** What a better photograph would have to show. Set when `unclear`. */
  needToSee: string | null;
  /**
   * Where the answer came from, in words, because nothing in this app can
   * check it: "Pasted 15 Sep". It is rendered beside the advice for the same
   * reason the invitation card says Snag doesn't email anybody — a claim the
   * screen cannot verify has to read as a claim.
   */
  source: string;
  createdAt: string;
}



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
  /**
   * The same work, arranged by date rather than by room — and across every
   * place you are linked to at once, because "is anything landing that
   * weekend" does not stop at the house you happen to be looking at.
   *
   * A read of the list and never a second way to write to it: there is one
   * scheduling mechanism in this app, and the moment there are two, neither is
   * trustworthy. It still sends nobody a reminder.
   */
  Schedule: undefined;
  Profile: undefined;
};
