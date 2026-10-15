import { Platform } from 'react-native';
import { activeSchemeId } from '../lib/colourScheme';
import { SCHEMES } from './schemes';

/**
 * Every design token in the app: **Bone & Glass** (October 2026).
 *
 * The precision of black ink on bone, and the warmth of photographs under
 * floating glass. The chrome is monochrome and exact. Colour comes from three
 * places only: the household's own photographs, the **action** colour when
 * something can be done, and three **state** hues that each mean one thing.
 * The full direction is the *Snag Bone & Glass* design system; the rules that
 * decide code are in CLAUDE.md under *Bone & Glass*.
 *
 *   1. **Ink sets the order; photographs bring the colour.** Words, rules and
 *      controls are ink on bone.
 *   2. **The action colour is for actions only** — the one filled button, the
 *      capture +, links, the active tab. It never marks a state and never marks
 *      a selection: **a selected chip or segment is ink**, with bone words.
 *   3. **State hues appear only in a state mark** (a dot and a word): slate
 *      open, brass doing and due soon, clay overdue. Done is graphite.
 *
 * The action colour and the ground come from the **colour scheme** chosen on
 * the You tab (`constants/schemes.ts`), read before this module loads
 * (`lib/colourScheme.ts`). Fern is the default and the brand. The inks and the
 * state hues are the same in every scheme.
 *
 * It replaced the warm plaster palette (`#FAF7F2`, ink `#2B2724`), which in
 * turn replaced the retired SnagHQ B2B palette.
 *
 * **Every pair below is measured, not eyeballed**: ink 17.5:1 on bone,
 * graphite 7.0:1, pencil 4.75:1 at its worst (on the well), each state hue
 * 6.1:1 or better on bone. `schemes.test.ts` holds every scheme to the same
 * floors.
 *
 * `apps/web/src/app/globals.css` and `apps/staff/src/app/globals.css` mirror the
 * default (fern) values — change all three.
 */
const scheme = SCHEMES[activeSchemeId()];

/** `hex` moved `t` of the way to white. For the tints a scheme derives. */
function towardWhite(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()}`;
}

const INK = '#141413';
const GRAPHITE = '#57564F';
const PENCIL = '#6A6962';
const SLATE = '#35526E';
const BRASS = '#825611';
const CLAY = '#9E3522';

export const Colors = {
  // ── Bone & Glass, by name ───────────────────────────────────────────────
  /** The page ground on every screen. */
  bone: scheme.bone,
  /** Sheets, groups and the one raised surface a screen needs. */
  paper: '#FFFFFF',
  /** Sunken wells: fields, the segmented track, unselected chips. */
  well: scheme.well,
  /** All primary text, the 2px rule under a count, and a selection's fill. */
  ink: INK,
  /** Secondary text. */
  graphite: GRAPHITE,
  /** Mono metadata and placeholders. Never on glass or over a photo. */
  pencil: PENCIL,
  /** The 1px line between rows. */
  hairline: scheme.hairline,
  /** Floating chrome over content — the tab bar — always with a blur behind. */
  glass: 'rgba(255, 255, 255, 0.72)',
  /** The 1px inner edge of glass, so it reads against a pale photo. */
  glassEdge: 'rgba(255, 255, 255, 0.9)',
  /** Without a blur (some Android webviews), glass is paper at 94%. */
  glassSolid: 'rgba(255, 255, 255, 0.94)',
  /** Chips laid over a photograph. White on it holds 5:1 on the palest photo. */
  glassInk: 'rgba(20, 20, 19, 0.5)',
  /** The foot of the gradient behind a caption on a photo. White on it is 7:1. */
  photoShade: 'rgba(20, 20, 19, 0.62)',
  /** A selected chip or segment: ink, with `onSelected` words. */
  selected: INK,
  onSelected: scheme.bone,
  /** The action on ink — a toast's *Undo*. */
  primaryBright: scheme.bright,
  onPrimary: '#FFFFFF',

  // ── The names the screens have always used ─────────────────────────────
  background: scheme.bone,
  surface: '#FFFFFF',
  sunken: scheme.well,
  border: scheme.hairline,

  /** The action. Every primary action, the capture +, links, the active tab. */
  primary: scheme.primary,
  primaryLight: scheme.tint,

  textPrimary: INK,
  textSecondary: GRAPHITE,
  textMuted: PENCIL,

  // Status. The base is for dots and icons; `*Fg` for words on the tint.
  // Done is deliberately graphite: the reward for finishing is the job
  // leaving the list, not a colour celebrating it.
  status: {
    open: SLATE,
    openFg: SLATE,
    openBg: '#E6ECF3',
    doing: BRASS,
    doingFg: BRASS,
    doingBg: '#F4EAD6',
    done: GRAPHITE,
    doneFg: GRAPHITE,
    doneBg: scheme.well,
  },

  // The shopping pill — deliberately colourless. What a job needs from the
  // shop is a fact about the trip, not an alarm.
  effort: {
    fg: GRAPHITE,
    bg: scheme.well,
  },

  // Due state. Overdue is the one thing on a household list that has earned
  // red — a fact about a date, not a judgement about importance.
  due: {
    overdueFg: CLAY,
    overdueBg: '#F6E2DB',
    soonFg: BRASS,
    soonBg: '#F4EAD6',
    scheduledFg: GRAPHITE,
    scheduledBg: scheme.well,
  },

  // Priority is gone from the app; kept so an old reader still type-checks.
  priority: {
    high: CLAY,
    highBg: '#F6E2DB',
    low: GRAPHITE,
    lowBg: scheme.well,
  },

  // Feedback on an action — "that worked" — in the action colour. Not a
  // completion state: a job marked done still goes graphite.
  success: scheme.primary,
  successFg: scheme.primary,
  successBg: scheme.tint,
  successBorder: towardWhite(scheme.primary, 0.7),

  white: '#FFFFFF',
  black: '#000000',
  /** Overdue, and destructive words. Nothing else. */
  danger: CLAY,
  dangerFg: CLAY,

  /** Behind anything laid over a photo. */
  photoOverlay: 'rgba(20, 20, 19, 0.62)',
  /** The photo viewer's ground: near-opaque ink. */
  photoViewerBackdrop: 'rgba(20, 20, 19, 0.97)',

  separator: scheme.hairline,
  /** Disclosure chevrons, inactive tab icons. 3.2:1 on bone: an icon, never text. */
  chevron: '#8F8D85',
  /** The empty part of a budget bar. */
  track: scheme.well,
  /** The undecided part of a budget bar: the action, lightened. */
  undecided: towardWhite(scheme.primary, 0.5),
  /** Behind a sheet or dialog. One value everywhere. */
  scrim: 'rgba(20, 20, 19, 0.42)',
  /** A segmented control's track. */
  segment: scheme.well,
};

/**
 * Corners. Bone & Glass: 12 for thumbnails, fields and the segmented track; 16
 * for buttons and groups; 24 for photo cards, room tiles and the top of a
 * sheet; a full round for pills, avatars, the dock and the capture +.
 */
export const Radius = {
  card: 16,
  /** The top corners of a bottom sheet. */
  sheet: 24,
  button: 16,
  /** A pill: tinted inline actions such as Choose or Paid, and every chip. */
  pill: 999,
  /** A chip laid over a photo; the count badge on the cart. */
  chip: 6,
  input: 12,
  avatar: 9999,
  /** A thumbnail in a row. */
  thumb: 12,
  /** A photo card, a room tile. */
  photo: 24,
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const Typography = {
  // Font sizes. 13 is the floor for words and 12 for mono (Bone & Glass), so
  // the smallest step is 12 where it was 11.
  xs: 12,
  sm: 13,
  base: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  xxxl: 32,

  // Named sizes, after the iOS text styles and the Bone & Glass scale.
  footnote: 13,
  subhead: 15,
  body: 17,
  title3: 20,
  title2: 24,
  title1: 28,
  largeTitle: 34,
  /** The one big number on a tab. Used once per screen. */
  count: 88,
  /** Mono section labels and row metadata, uppercased. */
  label: 12,

  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  heavy: '800' as const,
};

export const MIN_TOUCH_TARGET = 48;

/**
 * Two families: **Schibsted Grotesk** for everything people read, and
 * **DM Mono** for things — references, model numbers, serials, colour codes,
 * dates in a row, section labels. Both are bundled (`index.js` loads them),
 * because the deployed CSP reaches no font CDN.
 *
 * A custom font has one file per weight, so the shared `Text` and `TextInput`
 * (`components/Text.tsx`) turn a style's `fontWeight` into the right file.
 * Screens go on writing `fontWeight` and, for data, `fontFamily: Fonts.mono`.
 *
 * Mono is spent on data, never on prose: `I` and `l` and `1`, `O` and `0`
 * stay apart when somebody reads `MSZ-AP50VGK` to a repairer.
 */
const webStack = (family: string, fallback: string) => `${family}, ${fallback}`;
const SANS_FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO_FALLBACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The file behind each weight, by the name `expo-font` registers it under. */
export const FontFiles = {
  sans400: 'SchibstedGrotesk_400Regular',
  sans500: 'SchibstedGrotesk_500Medium',
  sans600: 'SchibstedGrotesk_600SemiBold',
  sans700: 'SchibstedGrotesk_700Bold',
  sans800: 'SchibstedGrotesk_800ExtraBold',
  mono400: 'DMMono_400Regular',
  mono500: 'DMMono_500Medium',
} as const;

/** A family as a style takes it: the bare name on a phone, a stack on the web. */
export function fontFamily(file: string, mono = false): string {
  return Platform.OS === 'web' ? webStack(file, mono ? MONO_FALLBACK : SANS_FALLBACK) : file;
}

export const Fonts = {
  sans: fontFamily(FontFiles.sans400),
  mono: fontFamily(FontFiles.mono400, true),
};

// Elevation. Bone & Glass casts a shadow only on things that float or lift:
// glass, a photo card, the capture +, a sheet. A row never has one. Tinted with
// the ink rather than a blue-black.
export const Shadow = {
  sm: {
    shadowColor: INK,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: INK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  lg: {
    shadowColor: INK,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 40,
    elevation: 8,
  },
  /** Glass that floats: the dock. */
  float: {
    shadowColor: INK,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 30,
    elevation: 10,
  },
  /** Under a photo card, so it lifts off bone. */
  photo: {
    shadowColor: INK,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 6,
  },
  /** Under the capture +, tinted with the action. */
  fab: {
    shadowColor: scheme.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.34,
    shadowRadius: 22,
    elevation: 8,
  },
} as const;

/** Icon sizes. 20 or 24 beside words; 16 only inline with 13pt words. */
export const IconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
  xxl: 40,
};

/** A finished job, or a repeat parked until it comes round. */
export const SETTLED_OPACITY = 0.62;
