/**
 * The colour schemes somebody can choose on the You tab (October 2026).
 *
 * **A scheme changes the action colour and the ground it sits on, and nothing
 * else.** Bone & Glass spends colour on three jobs: the action (the filled
 * button, the capture +, a link, the active tab), the three states (open,
 * doing, overdue) and the household's own photographs. Only the first is a
 * matter of taste. The state hues are a vocabulary — slate is open, brass is
 * doing, clay is overdue, on every phone in the house — so they are the same
 * in every scheme, and so are the inks the words are set in.
 *
 * Each scheme is five values: the action, its tint (behind action-coloured
 * words, and the active tab's capsule), a bright version for an action on ink
 * (a toast's *Undo*), and a ground and a well to go with them. Silver and
 * Metallic cool the ground; Orange and Bronze warm it; Blue sits on a cool bone.
 *
 * **Every pair is measured.** `schemes.test.ts` holds each one to the same
 * floors as the default: white on the action 4.5:1 or better, the action on
 * the ground, the well and its own tint 4.5:1, the muted ink on the well 4.5:1,
 * and the state hues on the ground 4.5:1. A scheme that fails one does not
 * ship; it gets darker, not a waiver.
 *
 * The choice is remembered **per device** (`lib/colourScheme.ts`), like the
 * list's folds: it is about one person's screen, not the house.
 */
export type SchemeId = 'fern' | 'blue' | 'orange' | 'silver' | 'metallic' | 'bronze';

export interface Scheme {
  id: SchemeId;
  /** What the You tab calls it. */
  label: string;
  /** The action: filled buttons, the capture +, links, the active tab. */
  primary: string;
  /** Behind action-coloured words; the active tab's capsule. */
  tint: string;
  /** The action on ink — a toast's *Undo*. */
  bright: string;
  /** The page ground. */
  bone: string;
  /** Sunken wells: fields, unselected chips, the segmented track. */
  well: string;
  /** The 1px line between rows. */
  hairline: string;
}

export const SCHEMES: Record<SchemeId, Scheme> = {
  // Bone & Glass as drawn. The brand's own fern.
  fern: {
    id: 'fern', label: 'Fern',
    primary: '#2E6A4F', tint: '#DCEBE1', bright: '#8CCBA9',
    bone: '#FAF9F6', well: '#F0EEE8', hairline: '#E3E1DA',
  },
  // A clear cobalt, far enough from slate's muted blue that "open" still reads
  // as a state rather than as something to press.
  blue: {
    id: 'blue', label: 'Blue',
    primary: '#1F5AA6', tint: '#DCE7F5', bright: '#9CC2F2',
    bone: '#F8F9FB', well: '#EDF0F4', hairline: '#DEE3EA',
  },
  // Burnt orange at hue 25°, between clay (9°) and brass (37°) and darker
  // than either would need to be: white on it holds 5.8:1.
  orange: {
    id: 'orange', label: 'Orange',
    primary: '#A64A0A', tint: '#FAE8DA', bright: '#F6B27E',
    bone: '#FBF8F4', well: '#F3EDE5', hairline: '#E8DFD4',
  },
  // A light, neutral grey ground with a steel accent.
  silver: {
    id: 'silver', label: 'Silver',
    primary: '#5B6670', tint: '#E7EAED', bright: '#C6CED6',
    bone: '#F8F8F8', well: '#EDEDEE', hairline: '#DFDFE1',
  },
  // Gunmetal on blued steel: darker and cooler than Silver.
  metallic: {
    id: 'metallic', label: 'Metallic',
    primary: '#2F3E4F', tint: '#DFE4EA', bright: '#AFC1D4',
    bone: '#F3F5F7', well: '#E7EAEE', hairline: '#D7DCE2',
  },
  // A dark, low-saturation bronze, so it does not read as brass (doing).
  bronze: {
    id: 'bronze', label: 'Bronze',
    primary: '#6E4A2C', tint: '#F0E5D8', bright: '#E2BC92',
    bone: '#FAF7F2', well: '#F1EAE1', hairline: '#E4DACD',
  },
};

export const SCHEME_ORDER: SchemeId[] = ['fern', 'blue', 'orange', 'silver', 'metallic', 'bronze'];

export const DEFAULT_SCHEME: SchemeId = 'fern';

export function isSchemeId(value: unknown): value is SchemeId {
  return typeof value === 'string' && (SCHEME_ORDER as string[]).includes(value);
}
