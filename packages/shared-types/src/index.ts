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
  /**
   * Whether this person wants the Projects tab and the work filed under it.
   *
   * **The one setting in this app that belongs to a person rather than to the
   * house.** Everything else the schema remembers is per household or per
   * property, because there is one house and two people disagreeing about
   * whether it has a dryer is not a state worth modelling. This is not that:
   * a renovation is a third noun and a household without one pays a tab, a set
   * of reads and a row of controls for a feature that answers nothing. One
   * member putting that away must not take it off the other's phone.
   *
   * Off hides the tab *and* the jobs filed against a project — a punch list
   * with no way to reach the renovation it belongs to is a row of orphans.
   * See `excludeProjectSnags`.
   */
  projectsEnabled: boolean;
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

/**
 * One of the things a job is about, as the view hands it over.
 *
 * Enough to draw the card and no more — the name to recognise it, the model to
 * read in a shop, the room for the chip. Anything else is a tap away on the
 * thing's own page, and a job that carried whole `Thing` rows would be paying
 * for a spec sheet per link on a screen people open constantly.
 */
export interface LinkedThing {
  id: string;
  name: string | null;
  room: string | null;
  make: string | null;
  model: string | null;
  kind: ThingKind;
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

  /**
   * What the job is about, whole, from `home.snag_things`.
   *
   * `snags.thing_id` is the retired single link: its rows were backfilled into
   * the join table and nothing writes it any more. It stays because
   * `thing_name`/`make`/`model` still read from it for the extract's *About*
   * column, and because deleting a column rewrites what somebody said.
   */
  linkedThings: LinkedThing[];

  /**
   * Triage — added later, from the list.
   *
   * **There is no priority here any more, and `home.snags.priority` is left
   * unread rather than dropped.** It was asked at capture, defended as the one
   * judgement only the person standing there can make — and nearly everything
   * was filed Low, which is the premise of this product rather than a finding.
   * Moving it to triage did not save it: urgency is comparative, a household
   * list is a dozen small jobs none of which is an emergency, and a badge that
   * is grey on every row is a column of noise. What actually sorts this list is
   * a date and a trip to the shop.
   *
   * The column stays because rows still hold answers somebody gave, and
   * dropping it would rewrite what they said. Nothing reads it.
   */
  status: SnagStatus;
  /**
   * What it needs from the shop, in the words you'd read in the aisle.
   *
   * Was a yes/no. A tick told you a trip was needed and not what for, which is
   * the half of the problem that actually blocks a small job for weeks.
   */
  parts: string[];
  /**
   * Which of them have been got, as written on the list above.
   *
   * A trip is a thing that happens halfway: one person is in the aisle with
   * four items and two of them are in the trolley. Kept as the item text rather
   * than as indices, because the list can be edited from the other phone while
   * somebody is standing in the shop.
   */
  bought: string[];
  /**
   * Derived in the view, so the flag the list filters on cannot disagree with
   * the list it describes: true only while something on it has not been bought.
   */
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

  /**
   * The renovation this job belongs to, if any — the punch list, in the app's
   * own word.
   *
   * Like `thingId`, setting it does **not** move the snag to 'doing': saying
   * which renovation a dripping cistern belongs to is the tail of capture, the
   * same gesture as tagging the room.
   */
  projectId: string | null;

  /**
   * Which project item this snag's answer belongs to.
   *
   * An open question about a renovation — what the geotech engineer cost, what
   * the cabinetry came to — is an ordinary snag in its ordinary room, because a
   * project does not get a to-do list of its own. What it carries is a
   * destination, written at the moment the question was written rather than
   * sorted out at the moment it is answered: `answerProjectSnag` needs no
   * target because the row already names one.
   *
   * Set only by `createSnag`, never by `updateSnag`, so like `thingId` and
   * `projectId` it cannot start a job. `on delete set null`: delete the item
   * and the question falls back to the project rather than orphaning.
   */
  projectItemId: string | null;

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
  projectName: string | null;
  /** Where a bound question's answer will land, in words. */
  projectItemName: string | null;
  projectElementName: string | null;
}

/**
 * Something written on another job about the same thing.
 *
 * Carries the reference of the snag it came from, because "the filter was
 * stiff" means something quite different when it was written about a service
 * eight months ago than it does about this morning's fault — and because the
 * row is a door back to that job.
 */
export interface ThingNote {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  snagId: string;
  snagReference: string;
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
  /** Only items with a due date at or before now. */
  dueOnly?: boolean;
  needsParts?: boolean;
  /**
   * Jobs filed against one renovation — the punch list.
   *
   * A project does not get a to-do list of its own; it gets this filter over
   * `home.snags`, and those snags sit on the List tab in their rooms with
   * everything else. One place work lives, or neither is trustworthy.
   */
  projectId?: string | null;
  /**
   * Leave out every job filed against a renovation.
   *
   * What *Projects off* means on the list, and it is a filter rather than a
   * client-side `.filter()` deliberately: the header count, the shopping pill,
   * the Schedule tab and both extracts each read snags separately, and a
   * subtraction applied in one of them is four screens disagreeing about how
   * much there is to do. Asked of Postgres once, every reader gets the same
   * answer.
   */
  excludeProjectSnags?: boolean;
}

export type SnagSort = 'newest' | 'oldest' | 'due';

// ------------------------------------------------------------- the house record

/**
 * The five kinds of thing a house record holds.
 *
 * The app ships two — `appliance` and `finish` — because those are the ones
 * with the sharpest read moments: a model number read out on a repair call, a
 * colour code read in a hardware aisle. The other three are in the enum from
 * the first migration so that adding them is a screen and not a migration.
 */
export type ThingKind =
  | 'appliance'
  | 'finish'
  | 'tile'
  | 'fitting'
  | 'fabric'
  | 'contact';

/**
 * The three that are built. Everything else is deliberately not offered yet.
 *
 * `tile` arrived with the projects work, because a renovation's most durable
 * answer is which tile went on the bathroom floor and a tile is not paint: it
 * has a size and a grout colour, and "Paint" over a tile code is the wrong word
 * on the one page whose job is to be believed in a shop eight months later.
 */
export const THING_KINDS: ThingKind[] = ['appliance', 'finish', 'tile'];

/** On a chip, where it names one thing. */
export const THING_KIND_LABELS: Record<ThingKind, string> = {
  appliance: 'Appliance',
  finish: 'Paint',
  tile: 'Tile',
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
  // A tile takes paint's shape rather than an appliance's, and for paint's
  // reason: a bathroom holds one tile on the floor and another on the walls,
  // the colour is what somebody came to read, and the only thing telling the
  // two apart is where each went.
  tile: { make: 'Range', model: 'Colour or code', notes: 'Where it went' },
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

  /**
   * The renovation that put it here, if it came from one.
   *
   * `on delete set null`, never cascade: deleting the record of the laundry
   * renovation must not delete the washing machine it installed.
   */
  projectId?: string | null;
  /**
   * Which item of that project this record came out of.
   *
   * What `projectId` alone could not say, and without it the handover list has
   * no way to stop offering the dishwasher it put in the record last week. Not
   * unique: a tiled bathroom leaves a tile record and a grout record from one
   * line item.
   */
  projectItemId?: string | null;
  /** Joined in by `home.things_with_details`, for the *Installed during* row. */
  projectName?: string | null;
  projectFinishedOn?: string | null;

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



// ---------------------------------------------------------------- projects

/**
 * What we're *changing*, beside what's wrong (a snag) and what's there (a thing).
 *
 * A project is a body of work on a place: a renovation, a rebuild, a heat pump
 * going in. Planned or already finished — recording the bathroom you did in
 * 2024 is worth as much as planning the one you haven't, because it is where
 * the receipts and the guarantee live.
 */
export type ProjectStatus = 'planned' | 'underway' | 'done';

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: 'Planned',
  underway: 'Underway',
  done: 'Done',
};

/** What the tab groups by, in the order the sections read down the screen. */
export const PROJECT_STATUS_ORDER: ProjectStatus[] = ['underway', 'planned', 'done'];

/**
 * Where one item has got to.
 *
 * Deliberately never `done`. That word belongs to snags, and an item that has
 * been installed is not the same claim as a job that has been finished — the
 * renovation can be installed and still wrong, which is what the snags hanging
 * off it are for.
 */
export type ProjectItemStatus = 'considering' | 'chosen' | 'ordered' | 'installed';

export const PROJECT_ITEM_STATUS_LABELS: Record<ProjectItemStatus, string> = {
  considering: 'Deciding',
  chosen: 'Chosen',
  ordered: 'Ordered',
  installed: 'In',
};

export const PROJECT_ITEM_STATUS_ORDER: ProjectItemStatus[] = [
  'considering',
  'chosen',
  'ordered',
  'installed',
];

/**
 * What a piece of paper *is*.
 *
 * A quote is what something might cost; an invoice is what has been charged.
 *
 * **`receipt` is no longer offered.** A receipt is a payment's evidence, not a
 * third kind of paper — see `ProjectPayment`. It stays in the type because it
 * stays in the database enum, which Postgres cannot drop a value from, and
 * because rows migrated from it keep their history. Nothing writes it.
 */
export type ProjectQuoteKind = 'quote' | 'invoice' | 'receipt';

export const PROJECT_QUOTE_KIND_LABELS: Record<ProjectQuoteKind, string> = {
  quote: 'Quote',
  invoice: 'Invoice',
  receipt: 'Invoice',
};

export const PROJECT_QUOTE_KINDS: ProjectQuoteKind[] = ['quote', 'invoice'];

/**
 * Where a price sits, and the reason there are three answers.
 *
 * A builder's contract covers a whole renovation; a tiling quote covers one
 * room; a toilet's price covers one item. Forcing all three onto the item layer
 * meant inventing an item called "Main contract — ReliaBuilder" and watching it
 * sit beside the vanity, which is how the item layer stops meaning "a thing
 * being bought".
 */
export type ProjectQuoteLevel = 'item' | 'element' | 'project';

/**
 * Accepted, still deciding, or turned down.
 *
 * This was a `chosen` boolean, and a boolean could only ever say "not chosen" —
 * which conflated "we have not decided" with "we said no". The second is worth
 * keeping: what you were quoted and by whom is what makes the next renovation's
 * numbers credible. A declined price leaves every total and stays on the record.
 */
export type ProjectQuoteStatus = 'tbc' | 'accepted' | 'declined';

export const PROJECT_QUOTE_STATUS_LABELS: Record<ProjectQuoteStatus, string> = {
  tbc: 'TBC',
  accepted: 'Accepted',
  declined: 'Declined',
};

/** Accepted first: it is the answer somebody is usually reaching for. */
export const PROJECT_QUOTE_STATUSES: ProjectQuoteStatus[] = ['accepted', 'tbc', 'declined'];

/**
 * Whether this number can move.
 *
 * A fixed-price contract stays what it says whatever the fittings actually cost
 * — the variance is the builder's, and a real change costs a variation, which is
 * a new quote. An estimate moves as its allowances are answered.
 *
 * The app cannot infer which it is holding, and guessing would be a lie about
 * somebody's contract, so it asks once. **The default is `fixed`**, because a
 * householder who has not met the distinction almost certainly has a fixed-price
 * quote, and because it is the answer that does not silently move.
 */
export type ProjectQuoteBasis = 'fixed' | 'estimate';

export const PROJECT_QUOTE_BASIS_LABELS: Record<ProjectQuoteBasis, string> = {
  fixed: 'Fixed price',
  estimate: 'Estimate',
};

export const PROJECT_QUOTE_BASES: ProjectQuoteBasis[] = ['fixed', 'estimate'];

/**
 * New Zealand GST, and the one number this app does arithmetic with.
 *
 * **Every amount is a pair**: the figure as it was typed, and whether that
 * figure already includes GST. Quotes come both ways here and the difference is
 * 15% — which on a renovation is the difference between on budget and $2,000
 * over — so asking once at the household level and assuming it forever is how a
 * total ends up quietly wrong. The pill sits beside the box, on every box.
 *
 * Rollups normalise to **inclusive**, because that is what leaves the bank
 * account. `home.incl_gst` is the server's copy of this and the two must agree;
 * `projects.test.ts` pins the arithmetic on this side.
 */
export const GST_RATE = 0.15;

/**
 * The figures every level of a project carries, and the rule that comes with
 * them.
 *
 * **A total always ships its denominator.** `itemCount` and `pricedCount` are
 * in this shape rather than fetched separately precisely so that no screen can
 * render `chosenTotal` without having been handed "5 of 9 items priced" in the
 * same object. A renovation total assembled from half the items is the most
 * misleading number this app could show, and it misleads in the direction that
 * costs money.
 *
 * **An unpriced item is not zero.** It is counted in `itemCount`, excluded from
 * every sum, and that gap is the whole point of reporting both.
 *
 * Nulls are meant: `sum` over nothing is "nobody has said", never $0.
 */
export interface ProjectTotals {
  /** How many items exist at this level, priced or not. */
  itemCount: number;
  /** How many have a committed figure — the denominator's numerator. */
  pricedCount: number;
  /** Quoted and still undecided. A different state from "nobody has asked". */
  quotedCount: number;
  /**
   * What has been agreed, GST-inclusive. Null when nothing has been.
   *
   * The accepted quote at each level — or, when nothing was ever quoted there,
   * its invoices. A consultant billing time by the month has no quote and never
   * will, and reading that as "not priced" while money goes out of the door is
   * how `committed - paid` comes out negative.
   */
  committedTotal: number | null;
  /** What has been charged. Invoices, whether or not they have been paid. */
  invoicedTotal: number | null;
  /** What has actually gone out — payments against those invoices. */
  paidTotal: number | null;
  /**
   * How much of `committedTotal` is still somebody's guess.
   *
   * The unanswered allowances inside accepted quotes. It rides beside the total
   * for the same reason `itemCount` does: a figure a third of which the builder
   * made up is exactly as misleading as a total assembled from half the items.
   *
   * **An allowance is not an unpriced item.** An unpriced item contributes
   * nothing and is counted in the denominator; an allowance is somebody's
   * written number and it counts. The two are never worded the same.
   */
  allowanceOpen: number;
  /**
   * Ballparks sitting *outside* a contract that nobody has priced.
   *
   * The distinction from `allowanceOpen` is the whole reason both exist, and it
   * is worth 15% of a renovation when it blurs. An allowance is a written
   * number **inside** a contract somebody has signed, so it is committed and
   * merely soft. A builder who says "and budget another $10,000 for the
   * laundry" has committed to nothing — that number is not in the contract sum
   * and must not reach `committedTotal`. It goes to forecast, named as a guess.
   */
  additionalOpen: number;
}

export interface Project extends ProjectTotals {
  id: string;
  householdId: string;
  propertyId: string;
  name: string;
  summary: string | null;
  status: ProjectStatus;

  /** Three dates, none of them a schedule. This app has one scheduler and it is a snag's. */
  startedOn: string | null;
  targetOn: string | null;
  finishedOn: string | null;

  budget: number | null;
  budgetInclGst: boolean;

  /**
   * What the parts have been budgeted, against what the project was.
   *
   * Both are kept and the gap is named on screen rather than resolved. A
   * renovation is budgeted top-down and broken down later, the breakdown
   * deliberately does not add up (the contingency lives nowhere), and a derived
   * figure that silently replaced the typed one would be the app insisting
   * somebody did not mean what they typed.
   */
  partsBudgetTotal: number | null;
  partsBudgetedCount: number;

  /**
   * Committed, plus every guess that is not already inside it.
   *
   *   forecast = committed + additionalOpen + expectedOpen + budgetGap
   *
   * Committed answers *what have we agreed to*. Three months into a job with
   * five items unpriced it is not the answer to *are we over*, and it fails in
   * the direction that costs money: everything nobody has priced counts as
   * nought, so the budget looks comfortable until the week it does not.
   *
   * Null only when nothing anywhere has been said.
   */
  forecastTotal: number | null;
  /**
   * What the prices actually add up to, kept whatever anybody typed over it.
   *
   * These four are the reason an override is honest rather than a lie: the
   * derivation is never replaced, so the page can name the discrepancy and go on
   * naming it for as long as the edit lasts.
   */
  forecastDerived: number | null;
  committedDerived: number | null;
  invoicedDerived: number | null;
  paidDerived: number | null;
  /** What somebody typed, or null where nobody has. GST-normalised. */
  forecastOverride: number | null;
  committedOverride: number | null;
  invoicedOverride: number | null;
  paidOverride: number | null;
  forecastNote: string | null;
  committedNote: string | null;
  invoicedNote: string | null;
  paidNote: string | null;
  /** How many parts carry an edited figure of their own. */
  partsEditedCount: number;
  /**
   * How much of the forecast is somebody's estimate rather than an agreed price.
   *
   * Rides beside `forecastTotal` exactly as `itemCount` rides beside every sum,
   * and for the same reason: **no screen can render the figure without being
   * handed what it is made of.** It counts `allowanceOpen` (soft, but already
   * inside committed) as well as the three additions.
   */
  forecastGuess: number;
  /** Costs somebody has been told to expect that nobody has quoted. */
  expectedOpen: number;
  expectedCount: number;
  /**
   * What the budgeted parts still have to cover for their unpriced items.
   *
   * The only term in the forecast that invents anything, and fenced hard: a
   * part must have a budget, it must still have unpriced items, it is the
   * remainder of that budget or nothing, and a part whose items are all priced
   * contributes zero — the money left over there is a saving, not a cost still
   * to come. A project with no part budgets gets no term at all.
   */
  budgetGap: number;

  /**
   * The first of two gaps that used to be one figure called Outstanding.
   *
   *   stillToBill = committed - invoiced
   *
   * *"ReliaBuilder have $88,780 of the contract left to claim."* How much of
   * what was agreed is still coming.
   *
   * **Signed, deliberately.** Negative means somebody has billed more than was
   * ever committed, which is the over-billing signal and the last thing that
   * should be floored away into a tidy zero.
   */
  stillToBill: number | null;
  /**
   * The second, and the only figure in this feature that is about **today**.
   *
   *   dueToPay = invoiced - paid
   *
   * *"$43,987.50 to ReliaBuilder, due 20 October."* Everything else on the page
   * is a position; this is a task, which is why it is the one with a date.
   */
  dueToPay: number;
  /** Of `dueToPay`, what is already past its date. */
  overdueTotal: number;
  /** The soonest a bill is due. Null when nothing is owed or nothing is dated. */
  nextDueOn: string | null;
  /** How many bills are waiting on money. */
  dueCount: number;

  photoPaths: string[];
  documentPaths: string[];

  createdBy: string;
  createdAt: string;
  updatedAt: string;

  /** Joined in by `home.projects_with_totals`. */
  propertyName: string;
  createdByName: string;
  elementCount: number;
  /**
   * How many elements the client should actually draw.
   *
   * Zero means the project's one element is implicit — a layer that has not
   * earned its place — so the items hang directly off the project and the word
   * "element" is never said.
   */
  shownElementCount: number;
  /** Every file under the project, at any level. Files roll up, never down. */
  fileCount: number;
  snagCount: number;
  openSnagCount: number;
  /** What this project put into the house record. */
  thingCount: number;
  /**
   * What it says it installed.
   *
   * The gap between this and `thingCount` is the one place two halves of the
   * record can be quietly out of step: the laundry has a new washing machine in
   * it and the House tab has never heard of it. `looseEnds` reads exactly that
   * subtraction, and it is a count of things somebody can do — never a score.
   */
  installedCount: number;
}

/**
 * A part of a project, usually a room.
 *
 * `implicit` is the layer's visibility, and it is stored rather than derived
 * from "is this the only one". Derived was the first shape and it is wrong:
 * deleting the second of two elements would silently re-hide the first, which
 * by then had a name somebody chose and paperwork attached to it. Once a person
 * has seen the layer, it stays.
 */
export interface ProjectElement extends ProjectTotals {
  id: string;
  projectId: string;
  name: string;
  room: string | null;
  implicit: boolean;
  sortOrder: number;
  notes: string | null;
  /** This part's share of the budget. See `Project.partsBudgetTotal`. */
  budget: number | null;
  budgetInclGst: boolean;
  /** Costs expected against this part specifically. See `ProjectExpectedCost`. */
  expectedOpen: number;
  expectedCount: number;
  /** See `Project.budgetGap` — this is the term, per part. */
  budgetGap: number;
  /** What this part's prices add up to, kept whatever was typed over it. */
  committedDerived: number | null;
  invoicedDerived: number | null;
  paidDerived: number | null;
  committedOverride: number | null;
  invoicedOverride: number | null;
  paidOverride: number | null;
  committedNote: string | null;
  invoicedNote: string | null;
  paidNote: string | null;
  photoPaths: string[];
  documentPaths: string[];
  createdAt: string;
}

/** One thing to decide or buy. Its price is whichever quote was chosen. */
export interface ProjectItem {
  id: string;
  elementId: string;
  name: string;
  status: ProjectItemStatus;
  sortOrder: number;
  notes: string | null;
  photoPaths: string[];
  documentPaths: string[];
  createdAt: string;
  /**
   * Decided against, without deleting it. An excluded item and its quotes
   * stay on the record — its own price still shows on its own row — but it
   * stops counting in its element's or the project's price build.
   */
  excluded: boolean;

  /** Joined in by `home.project_items_with_totals`, all GST-inclusive. */
  quoteCount: number;
  /** Prices on the table that nobody has decided about. */
  tbcCount: number;
  /** Null when nothing has been agreed — never zero. */
  committed: number | null;
  invoiced: number | null;
  paid: number | null;
  allowanceOpen: number;
  /** See `ProjectTotals.additionalOpen`. */
  additionalOpen: number;
}

/**
 * One supplier's number, with the paper behind it.
 *
 * `amount` is exactly what was typed and `amountInclGst` says what it meant.
 * Nothing in this app ever reads a figure out of an attachment: a scraped total
 * has a source nobody can check, and it will be wrong about GST, about
 * provisional sums, and about which of three revisions it read.
 */
export interface ProjectQuote {
  id: string;
  /** Exactly one of these three is set. See `ProjectQuoteLevel`. */
  itemId: string | null;
  elementId: string | null;
  projectId: string | null;
  supplier: string | null;
  /** What is being offered — "Methven Krome". The item's name is usually enough. */
  detail: string | null;
  amount: number | null;
  amountInclGst: boolean;
  kind: ProjectQuoteKind;
  /** At most one accepted *quote* per item, enforced by a partial unique index. */
  status: ProjectQuoteStatus;
  basis: ProjectQuoteBasis;
  dated: string | null;
  notes: string | null;
  /**
   * The allowance this price was got for.
   *
   * **A quote that supersedes a line contributes only through that line**, never
   * also on its own account. That is the whole answer to "is the toilet inside
   * the contract" — linking is the answer, and linking is the same act that
   * produces the breakdown. A price pointing at nothing is a separate purchase
   * and sums normally.
   */
  supersedesLineId: string | null;
  /**
   * When the money has to leave, as distinct from the date on the paper.
   *
   * `dated` is what the invoice says at the top; this is the payment term. The
   * schema held the first and not the second, so nothing could answer "is there
   * a bill due this week" — which is the question somebody opens this page with
   * far more often than any other.
   */
  dueOn: string | null;
  /**
   * The head contract this price is passed through, if it is.
   *
   * Null — the ordinary case — means this supplier bills the household direct.
   * Set, the money is owed to the contract holder rather than to this supplier:
   * a cabinetmaker whose $12,000 goes through the builder is owed nothing by the
   * household, and the supplier rollup was silently saying otherwise.
   *
   * **The total is the same either way.** What changes is who is owed, which is
   * a different question and the one people act on.
   */
  billedThroughId: string | null;
  /** The milestone this bill claims against, when the commitment has a schedule. */
  settlesMilestoneId: string | null;
  photoPaths: string[];
  documentPaths: string[];
  createdAt: string;

  /** Joined in by `home.project_quotes_with_totals`, all GST-inclusive. */
  amountIncl: number | null;
  lineCount: number;
  /** What the lines add up to. Not required to equal the quote — see below. */
  linesTotal: number | null;
  /**
   * What the quote reads once its allowances have been answered.
   *
   * Null when it has no lines, in which case the amount as typed is the whole
   * story.
   */
  buildUp: number | null;
  allowanceOpen: number;
  /** Unpriced ballparks sitting outside this quote's number. Forecast's, not committed's. */
  additionalOpen: number;
  /**
   * What this quote actually contributes, with all four allowance cases resolved.
   *
   * `basis` decides whether the build-up or the stated amount leads, and then:
   * an inside allowance bought **direct** leaves the contract sum (the sub's own
   * quote already counts it) while its attendance stays; an additional line
   * bought **through** the contract adds to it. Counting a passed-through price
   * both here and on the sub's own row is the one remaining way this feature
   * could have made a total disagree with itself.
   */
  effectiveAmount: number | null;
  /** Payments recorded against it. Only an invoice can carry any. */
  paidTotal: number | null;
  /** What is still to go out on this bill. Null unless it is a live invoice. */
  unpaid: number | null;
}

/**
 * Which kind of allowance a line is, in the contract's own word.
 *
 * In New Zealand practice these are not interchangeable. A **PC sum** (prime
 * cost) is money allowed for goods the builder will supply but has not yet
 * priced — tapware, tiles. A **provisional sum** covers work whose extent is
 * not yet known — piling, drainage found under the house. A **ballpark** is
 * neither: it is the builder saying "budget about this", with no contractual
 * standing at all, which is why it is the one most likely to be `additional`.
 *
 * The app does not treat them differently in the arithmetic. It records which
 * word was used, because at final account the difference is the householder's
 * to argue and they need to know what they signed.
 */
export type ProjectAllowanceKind = 'pc_sum' | 'provisional' | 'ballpark';

export const PROJECT_ALLOWANCE_KIND_LABELS: Record<ProjectAllowanceKind, string> = {
  pc_sum: 'PC sum',
  provisional: 'Provisional sum',
  ballpark: 'Ballpark',
};

/** Ballpark first: it is what a householder is most often being handed. */
export const PROJECT_ALLOWANCE_KINDS: ProjectAllowanceKind[] = [
  'ballpark',
  'pc_sum',
  'provisional',
];

/**
 * Which of the five figures an edit is standing in for.
 *
 * `budget` is absent deliberately — it is already a typed number on the project
 * itself, so it has nothing to override. These four are the derived ones.
 */
export type ProjectFigure = 'forecast' | 'committed' | 'invoiced' | 'paid';

export const PROJECT_FIGURE_LABELS: Record<ProjectFigure, string> = {
  forecast: 'Forecast',
  committed: 'Committed',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

/**
 * A figure somebody typed over the one the prices add up to.
 *
 * **Every figure on the project page is derived, and that is the rule the whole
 * feature rests on** — a maintained total and the quotes beneath it will
 * disagree the first time somebody edits an amount from the other phone, and
 * the one people would trust is the wrong one.
 *
 * So this does not store a total. It stores an **override beside** the derived
 * figure, and the derivation is untouched: `committedDerived` is still what the
 * prices say, `committedOverride` is what somebody typed, and `committedTotal`
 * is what the page shows. Both survive, so the discrepancy is a fact the schema
 * holds rather than something the screen forgets — and lifting the edit puts the
 * truth back rather than recovering it from nowhere.
 *
 * **An edited figure renders in clay**, which is the third thing in this app to
 * earn red after overdue and priority-high, and it earns it on the same terms:
 * it is a fact about a number, not a judgement. This figure is not what the
 * paperwork says.
 */
export interface ProjectOverride {
  id: string;
  projectId: string;
  /** Null for the job's own figure; set, it is that part's. */
  elementId: string | null;
  field: ProjectFigure;
  amount: number;
  amountInclGst: boolean;
  /**
   * Why — and the one part of this a reader eight months later will want.
   *
   * *"Builder confirmed the variation by email, 12 Sept"* is the difference
   * between a number somebody trusts and a number somebody has to re-derive.
   */
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A cost somebody has been told to expect, that nobody has quoted.
 *
 * The architect says: *"you'll need an engineer, and the council will want
 * their share."* No vendor, no quote, no invoice — just a number from somebody
 * who knows the industry.
 *
 * Until this existed there were two places to put that and both were wrong. An
 * **item with no price** contributes nought to every figure, so a cost the
 * household knows about reads as zero — which is exactly what happened on the
 * live job with *Geotech engineer*. Or a **quote nobody gave you**, which is a
 * fabricated commitment against a vendor who has never heard of you, and which
 * would then appear under who's owed what.
 *
 * **It is never committed and never invoiced.** It feeds forecast alone and
 * every figure it touches names it as a guess. The distinction from an
 * allowance is the one that must not blur: an allowance is a written number
 * inside a contract somebody has signed, so it counts as committed and is
 * merely soft; an expected cost is not committed at all, because nobody has
 * agreed to anything.
 *
 * **It is replaced, not added to.** `settledBy` points at the real price when
 * one arrives and the expectation stops counting — otherwise the forecast
 * double-counts as the job firms up. It is kept rather than deleted because
 * "we thought the engineer would be $4,000 and it was $5,600" is the sentence
 * that makes the next renovation's guesses better, and this is the only place
 * the app can learn it.
 */
export interface ProjectExpectedCost {
  id: string;
  projectId: string;
  /** Against a part, or null for the job itself — council fees are not the bathroom's. */
  elementId: string | null;
  name: string;
  /**
   * Nullable, deliberately.
   *
   * "There will be council costs" with no figure is still worth recording: it
   * shows on the page as a named gap rather than being silently absent, and the
   * forecast says how many such gaps it is holding.
   */
  amount: number | null;
  amountInclGst: boolean;
  /**
   * Who it will probably come from, if that is known.
   *
   * A hint, not a supplier. It deliberately never reaches the supplier rollup,
   * because you cannot owe money to a guess.
   */
  likelySupplier: string | null;
  note: string | null;
  /** The real price, once it exists. Set, this stops counting. */
  settledBy: string | null;
  createdAt: string;
}

/**
 * A record of money actually moved against an expected cost, before it ever
 * got a real quote — a payment on account to the architect, with whatever
 * reference number was on the bank statement.
 *
 * Deliberately thin: free text name, free text reference, a value, and
 * somewhere to put a photo or a document. It is never committed, never
 * invoiced and never reaches Forecast — the parent expected cost still
 * carries the one guessed figure that feeds it, and these lines are read the
 * way a bank statement is read, not priced.
 */
export interface ProjectExpectedCostLine {
  id: string;
  expectedCostId: string;
  name: string;
  reference: string | null;
  amount: number | null;
  amountInclGst: boolean;
  photoPaths: string[];
  documentPaths: string[];
  createdAt: string;
}

/**
 * One step of a payment schedule — the builder's 25% at each milestone.
 *
 * The live job carried this as free text (*"INV-0208 — claim 2, 25%"*) where
 * nothing could read it, so the app knew about the claim that had arrived and
 * nothing about the three that were coming.
 *
 * Three rules keep it from becoming a second scheduler. It is **optional and
 * absent by default** — a tile shop takes payment and that is that, so it is
 * offered on a contract and never asked for. It is **not a bill**: it is what
 * somebody said would be claimed, and the claim is the invoice that arrives
 * pointing back at it. And **nothing sends anything** — a due date is a fact on
 * a row that a page sorts by, not a reminder.
 */
export interface ProjectMilestone {
  id: string;
  /** The commitment it breaks up. */
  quoteId: string;
  name: string;
  /**
   * A percentage of the commitment, or a flat amount — one or the other, never
   * both. Two ways to say the same number is two numbers that can disagree, and
   * this one gets multiplied by a six-figure contract.
   */
  percent: number | null;
  amount: number | null;
  amountInclGst: boolean;
  dueOn: string | null;
  sortOrder: number;
}

/**
 * One live bill on a job, with what is still to go out on it and when.
 *
 * A read and nothing else. There is no notification anywhere in this product
 * and there is not going to be one for money either: this is a list a page can
 * sort, and a mark the Schedule tab can draw, exactly as it already draws a
 * project's own dates.
 */
export interface ProjectBill {
  id: string;
  projectId: string;
  supplier: string | null;
  detail: string | null;
  dated: string | null;
  dueOn: string | null;
  billedThroughId: string | null;
  settlesMilestoneId: string | null;
  amountIncl: number | null;
  paidTotal: number | null;
  /** Floored at zero: a payment larger than the bill is somebody settling two at once. */
  unpaid: number | null;
  overdue: boolean;
}

/**
 * One line of a quote — and the reason a renovation goes over.
 *
 * A builder's number is not one number. It is a list, and against the fittings
 * and the tiles it carries an **allowance**: a figure written down for something
 * they are not themselves supplying, or have not yet priced. In a New Zealand
 * building contract these are provisional and PC sums, and they are the lines
 * that move.
 *
 * **The quote's own amount stays the authority.** Lines explain it and are not
 * required to sum to it: trade quotes round, bundle, and carry a margin line
 * that is nobody's business, and a form that refuses a quote whose lines do not
 * balance teaches people to fudge a line until it does. Where the two differ the
 * page says so quietly and corrects neither.
 */
export interface ProjectQuoteLine {
  id: string;
  quoteId: string;
  name: string;
  /** "Caroma Luna Cleanflush" — where a model number for the house record lives. */
  detail: string | null;
  amount: number | null;
  amountInclGst: boolean;
  isAllowance: boolean;
  /**
   * Which kind of allowance, in the contract's own word.
   *
   * A PC sum, a provisional sum and a builder's ballpark behave differently at
   * final account, and a householder reading the contract back in March wants
   * the word the contract used. Null on an ordinary line.
   */
  allowanceKind: ProjectAllowanceKind | null;
  /**
   * Whether this sits **on top of** the quoted total rather than inside it.
   *
   * One of the three questions the app must ask and can never infer. A builder
   * who quotes $150,000 "including a $10,000 laundry allowance" and one who
   * quotes $150,000 "and budget another $10,000" have said different things, and
   * the difference is $10,000. Guess it and the forecast is wrong by the whole
   * allowance.
   *
   * An additional line that nobody has priced is **not committed** — see
   * `ProjectTotals.additionalOpen`.
   */
  additional: boolean;
  /**
   * The margin the head contractor keeps when this is bought direct.
   *
   * A percentage of the **actual**, never of the allowance: their cut moves with
   * the real price, which is the whole reason they ask for it. Null means none,
   * and null is also what "nobody has asked yet" looks like — which is why the
   * sheet asks once, at the moment the line is created.
   */
  attendancePct: number | null;
  sortOrder: number;
}

/**
 * Money that has actually gone out, against the bill it settles.
 *
 * A deposit and a balance are two payments against one invoice, which is what
 * happens and what sibling rows could not say. It is also what makes the old
 * double-count unrepresentable: a payment is no longer the sort of row that can
 * be summed alongside a bill.
 */
export interface ProjectPayment {
  id: string;
  /** Always an invoice. `home.add_payment` refuses anything else, in words. */
  quoteId: string;
  amount: number;
  amountInclGst: boolean;
  paidOn: string | null;
  /**
   * The invoice number on the piece of paper this settled — or "Deposit",
   * "Progress claim 2", whatever the bank statement will call it. One column,
   * because two writers of one fact is the failure this schema keeps naming.
   */
  reference: string | null;
  notes: string | null;
  /** The bill itself, photographed or attached. Same bucket as everything else. */
  photoPaths: string[];
  documentPaths: string[];
  createdAt: string;
}

/**
 * "ReliaBuilder — committed $177,594, paid $84,000, outstanding $93,594."
 *
 * The check worth keeping, and the one `projects.test.ts` pins: **these rows sum
 * to the project's committed total.** They are two views over one rule, and if
 * they disagree one of them is lying about who is owed money.
 */
export interface ProjectSupplierTotals {
  projectId: string;
  /** The trimmed, lower-cased name the rollup groups on. */
  supplierKey: string;
  /** Displayed with the spelling used most recently. Null when nobody was named. */
  supplier: string | null;
  /**
   * Everything they have quoted that has not been declined — accepted prices
   * included, because an accepted quote was still quoted.
   *
   * The line above Committed on the project page, broken down by who said it.
   * Null where this supplier has only ever invoiced, which is not zero: a
   * consultant billing time by the month has no quote and never will.
   */
  quoted: number | null;
  committed: number | null;
  invoiced: number | null;
  paid: number | null;
  /** Still to go out to them — invoiced less paid, across their live bills. */
  unpaid: number | null;
  /** The soonest one of their bills is due. */
  nextDueOn: string | null;
  tbcCount: number;
}

/**
 * Which level a file belongs to.
 *
 * **Files roll up, never down.** A file is owned by exactly one level — the
 * council consent by the project, the tiling quote by the item it prices — and
 * a project's paperwork list gathers everything beneath it, saying where each
 * came from. Opening the bathroom element does *not* show the project's
 * consent, because that document is not about the bathroom.
 */
export type ProjectFileLevel = 'project' | 'element' | 'item' | 'quote';

export const PROJECT_FILE_LEVEL_LABELS: Record<ProjectFileLevel, string> = {
  project: 'The project',
  element: 'Part of the job',
  item: 'An item',
  quote: 'A quote',
};

export interface ProjectFile {
  projectId: string;
  level: ProjectFileLevel;
  /** The row it is attached to — the project, element, item or quote id. */
  ownerId: string;
  /** What to call that row on screen, so a list can say where a file lives. */
  ownerName: string;
  kind: 'photo' | 'document';
  path: string;
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
  /**
   * One renovation: the money, the parts of it, the paperwork.
   *
   * A push rather than a sheet, unlike SnagDetail and ThingDetail. Those are a
   * dozen small decisions each taken against a list still visible underneath. A
   * project is a page you read — three figures, a set of elements that open,
   * and a folder — and it is deep enough that a sheet would spend its height on
   * the list it is covering.
   */
  ProjectDetail: { projectId: string };
  /**
   * Where an answer to a briefed extract comes back in.
   *
   * A screen rather than a sheet: it is a paste, then a list of what that paste
   * would change, and both want the whole height. Reached from the foot of the
   * list, beside the way out — the two halves of the same journey.
   */
  PasteAdvice: undefined;
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
  /**
   * What we're changing about the place — renovations, rebuilds, the heat pump
   * going in — planned or already done.
   *
   * A fifth tab rather than a mode on the House tab. Both describe the fabric
   * of the place, which is why it sits beside it, but a tab with two minds is
   * how a tab becomes two tabs badly — see the `By room / By kind` rail this
   * app already removed for that reason.
   *
   * **Five is the ceiling.** At 375pt each tab gets 75pt, and `Projects` and
   * `Schedule` are both eight characters. If a sixth noun ever arrives, the
   * answer is not a sixth tab; it is that two of these five were never really
   * different.
   */
  Projects: undefined;
  Profile: undefined;
};
