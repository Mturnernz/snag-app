import { Platform } from 'react-native';

/**
 * Every design token in the app.
 *
 * Two rules govern the palette, and they are the whole system:
 *
 *   1. **The ground is warm.** `#FAF7F2` is plaster, not near-white. This is a
 *      household list, not software you are logged into — it sits on a phone on
 *      the kitchen bench and is shared with one other person who did not sign up
 *      for an application.
 *   2. **Colour is spent on state and interaction, never on decoration.** Four
 *      hues, one job each. Anything that is not a state or an action is a
 *      neutral.
 *
 * The corollary that gets second-guessed: **fern is the brand, so fern is not
 * "done"**. A finished snag goes neutral. The reward for finishing a household
 * job is the item leaving the list, not a green tick celebrating it — and
 * spending the brand hue on completion would make the list's calmest state its
 * loudest colour.
 *
 * Replaces the retired SnagHQ B2B palette (cool `#F9FAFB`, Tailwind cobalt
 * `#2563EB`, blue-black `#111827`), which was the right call for a compliance
 * tool read by whoever was the safety officer that month and the wrong one for
 * a house.
 *
 * **Every pair below is measured, not eyeballed**, and the reason matters: a
 * warm ground reads lighter than a cool one while doing nothing at all to its
 * measured luminance. An earlier pass of this palette failed three pairings for
 * exactly that reason. The tightest pair shipped here is muted-on-sunken at
 * 5.31:1. If the ground is ever warmed further, re-run the numbers rather than
 * trusting how it looks.
 *
 * `apps/web/src/app/globals.css` mirrors the light values — change both.
 */
export const Colors = {
  // Backgrounds
  background: '#FAF7F2',
  surface: '#FFFFFF',
  /** Wells: inactive chips, inputs inside a card, every neutral badge. */
  sunken: '#F4EFE7',

  // Borders
  border: '#E7DFD3',

  // Brand accent — fern. Every primary action, and the active tab.
  primary: '#2E6A4F',
  primaryLight: '#E4EFE7',

  // Text. Warm near-black rather than blue-black: a blue-black on a warm ground
  // looks like two palettes stapled together.
  //
  //   ink on ground        13.85    secondary on ground   6.87
  //   muted on ground       5.68    muted on sunken       5.31  ← tightest
  textPrimary: '#2B2724',
  textSecondary: '#5C554C',
  textMuted: '#6A6156',

  // Status. `*Fg` is the colour to use for text on the matching tint; the base
  // is for dots, icons and rails. These hues are dark enough that the two are
  // the same value, which was not true of the cobalt-era palette.
  //
  // Done is deliberately neutral — see the note at the top of this file.
  status: {
    open: '#35526E',      // slate: a state, not a warning
    openFg: '#35526E',
    openBg: '#E9EFF6',
    doing: '#825611',     // brass
    doingFg: '#825611',
    doingBg: '#F7EEDC',
    done: '#5C554C',
    doneFg: '#5C554C',
    doneBg: '#F4EFE7',
  },

  // The shopping pill — deliberately colourless. What a job needs from the shop
  // is a fact about the trip, not an alarm, so it must never compete with
  // priority or due state for attention on the same card. (Named `effort` from
  // when it carried the effort badge; the neutral pill outlived the concept.)
  effort: {
    fg: '#5C554C',
    bg: '#F4EFE7',
  },

  // Due state. Overdue is the one thing on a household list that has actually
  // earned red — it is a fact about a date, not a judgement about importance.
  due: {
    overdueFg: '#9E3522',
    overdueBg: '#F9E7E1',
    soonFg: '#825611',
    soonBg: '#F7EEDC',
    scheduledFg: '#5C554C',
    scheduledBg: '#F4EFE7',
  },

  // Priority — only "high" carries an alert colour; low is a neutral pill, so a
  // second saturated hue can never collide with status on the same card.
  priority: {
    high: '#9E3522',      // clay
    highBg: '#F9E7E1',
    low: '#5C554C',
    lowBg: '#F4EFE7',
  },

  // Success — save confirmations and positive feedback. Fern, because that is
  // the brand's "this worked" colour. Note this is feedback on an action, not a
  // completion *state*: a snag marked done still goes neutral.
  success: '#2E6A4F',
  successFg: '#2E6A4F',
  successBg: '#E4EFE7',
  successBorder: '#C6DDD0',

  white: '#FFFFFF',
  black: '#000000',
  danger: '#9E3522',
  dangerFg: '#9E3522',

  // Scrim for chips laid over a photo. A photo is not a background you can pick
  // a text colour against, so anything sitting on one gets this behind it and
  // white on top. Warm-tinted to match the ink rather than the old blue-black.
  photoOverlay: 'rgba(43, 39, 36, 0.75)',

  /**
   * The photo viewer's ground. Near-opaque rather than a scrim: a photo being
   * read closely — a serial number, a model plate — wants nothing behind it,
   * and the warm ink keeps the one dark surface in a light-mode app from
   * reading as a different application.
   */
  photoViewerBackdrop: 'rgba(43, 39, 36, 0.97)',

  // ── V2 grouped-list surfaces ─────────────────────────────────────────────
  // The hairline between rows inside a white group. Lighter than `border`,
  // which is for the edge of a thing rather than the gap between two rows of it.
  separator: '#EFE9E0',
  /** Disclosure chevrons. Decoration, never text, so it is exempt from 4.5:1. */
  chevron: '#B9AFA3',
  /** The empty part of a budget bar. */
  track: '#EDE7DD',
  /** The undecided part of a budget bar: fern, lightened, still reading as money. */
  undecided: '#9BC0AB',
  /** Behind a sheet. Warm ink rather than black, like every shadow here. */
  scrim: 'rgba(43, 39, 36, 0.45)',
  /** A segmented control's track. */
  segment: '#EFE9E0',
};

/**
 * Corners. V2 moved cards and full-width buttons to the rounder, continuous
 * iOS feel — a grouped list is a 14pt rectangle — while chips keep their tight
 * corner, because a chip is a label and not a surface.
 */
export const Radius = {
  card: 14,
  /** The top corners of a bottom sheet. */
  sheet: 16,
  button: 12,
  /** A pill: tinted inline actions such as Choose or Paid. */
  pill: 999,
  chip: 4,
  input: 10,
  avatar: 9999,
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
  // Font sizes
  xs: 11,
  sm: 13,
  base: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  xxxl: 32,

  // V2 named sizes, after the iOS text styles. Used by the grouped-list
  // primitives in `components/Grouped.tsx`; the numeric keys above stay for
  // screens that have not moved.
  footnote: 13,
  subhead: 15,
  body: 17,
  title3: 20,
  title2: 22,
  title1: 28,
  largeTitle: 34,

  // Font weights — React Native uses string literals
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const MIN_TOUCH_TARGET = 48;

/**
 * The one place a second typeface is spent, and it is spent on data.
 *
 * Model numbers, serials, colour codes and tint formulas are strings people
 * read aloud to somebody else or copy into a search box, character by
 * character — `MSZ-AP50VGK`, `7BB 83/018`, `FA-25`. Proportional type makes
 * that harder in a way nobody notices until they are on the phone to a
 * repairer: I and l and 1 collapse, O and 0 collapse, and there is no column
 * to check your place against.
 *
 * This is not a decorative face and must not be used as one. Prose stays in
 * the system font everywhere.
 */
export const Fonts = {
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    // react-native-web passes the family string straight through to CSS, so
    // this is a stack rather than a name.
    default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  }) as string,
};

// Elevation scale. Elevated surfaces (Card variant="elevated") drop their
// border and use one of these instead; nested rows inside lists stay
// border-only so long scrolling lists don't stack shadows.
//
// Tinted with the ink rather than a blue-black: a cool shadow on a warm ground
// reads as grey haze rather than as depth.
export const Shadow = {
  sm: {
    shadowColor: '#2B2724',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#2B2724',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  lg: {
    shadowColor: '#2B2724',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

// Icon sizing scale — pass directly as the `size` prop to Icon/Ionicons.
export const IconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
  xxl: 40,
};
