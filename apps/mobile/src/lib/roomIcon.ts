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
  [/\b(shed|workshop)\b/i, 'hammer-outline'],
  [/\b(kitchen|kitchenette|dining|pantry|scullery)\b/i, 'restaurant-outline'],
  [/\b(bath|bathroom|ensuite|en-suite|toilet|wc|powder|shower)\b/i, 'water-outline'],
  [/\b(bed|bedroom|nursery|baby|boy|girl|kids?|guest|master)\b/i, 'bed-outline'],
  [/\b(living|lounge|family|movie|media|tv|sitting)\b/i, 'tv-outline'],
  [/\b(laundry|utility)\b/i, 'shirt-outline'],
  [/\b(hall|hallway|entry|entrance|foyer|stairs?|landing)\b/i, 'footsteps-outline'],
  [/\b(garage|carport)\b/i, 'car-outline'],
  [/\b(under the house|basement|cellar|subfloor)\b/i, 'layers-outline'],
  [/\b(outside|garden|yard|exterior|lawn|driveway)\b/i, 'leaf-outline'],
  [/\b(deck|patio|balcony|veranda|verandah|porch|courtyard)\b/i, 'sunny-outline'],
  [/\b(roof|attic|loft|ceiling space)\b/i, 'home-outline'],
  [/\b(study|office|library)\b/i, 'book-outline'],
  [/\b(play|playroom|rumpus|games?)\b/i, 'game-controller-outline'],
];

/** Null is Whole house — the place itself rather than a room in it. */
export function roomIcon(room: string | null): IconName {
  if (room === null) return 'home-outline';
  return RULES.find(([pattern]) => pattern.test(room))?.[1] ?? 'cube-outline';
}
