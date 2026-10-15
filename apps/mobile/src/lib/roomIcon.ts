import type { IconName } from '../components/Icon';

/**
 * The outline icon beside a room's name on the House tab.
 *
 * Rooms are free text — the seeded twelve plus whatever a household adds, a
 * *Baby's Room*, a *Garden Shed*, a *Downstairs Bathroom* — so this is a list of
 * words rather than a table of names, read **in order, first match wins**, and
 * whole words only so "hall" is not found inside "Marshall". The order is the
 * point: *Garden Shed* is a shed before it is a garden, and *Downstairs
 * Bathroom* is a bathroom however it is qualified.
 *
 * Decoration in the strict sense, and treated as such: a neutral outline glyph,
 * never a hue, hidden from screen readers — the room's name already says what
 * the icon says. Anything the list does not know gets a plain box rather than a
 * guess at what the room is for.
 */
const RULES: [RegExp, IconName][] = [
  [/\b(shed|workshop)\b/i, 'room-shed'],
  [/\b(kitchen|kitchenette|dining|pantry|scullery)\b/i, 'room-kitchen'],
  [/\b(bath|bathroom|ensuite|en-suite|toilet|wc|powder|shower)\b/i, 'room-bathroom'],
  [/\b(bed|bedroom|nursery|baby|boy|girl|kids?|guest|master|sleepout)\b/i, 'room-bedroom'],
  [/\b(living|lounge|family|movie|media|tv|sitting)\b/i, 'room-living'],
  [/\b(laundry|utility)\b/i, 'room-laundry'],
  [/\b(hall|hallway|entry|entrance|foyer|stairs?|landing)\b/i, 'room-hallway'],
  [/\b(garage|carport)\b/i, 'room-garage'],
  [/\b(under the house|basement|cellar|subfloor)\b/i, 'room-under'],
  [/\b(outside|garden|yard|exterior|lawn|driveway)\b/i, 'room-outside'],
  [/\b(deck|patio|balcony|veranda|verandah|porch|courtyard)\b/i, 'room-deck'],
  [/\b(roof|attic|loft|ceiling space)\b/i, 'room-roof'],
  [/\b(study|office|library)\b/i, 'room-study'],
  [/\b(play|playroom|rumpus|games?)\b/i, 'room-play'],
  [/\b(conservatory|sunroom)\b/i, 'room-conservatory'],
];

/** Null is Whole house — the place itself rather than a room in it. */
export function roomIcon(room: string | null): IconName {
  if (room === null) return 'house';
  return RULES.find(([pattern]) => pattern.test(room))?.[1] ?? 'room-other';
}
