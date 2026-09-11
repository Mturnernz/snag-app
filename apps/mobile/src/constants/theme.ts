export const Colors = {
  // Backgrounds
  background: '#F9FAFB',
  surface: '#FFFFFF',

  // Borders
  border: '#E5E7EB',

  // Brand accent
  primary: '#2563EB',
  primaryLight: '#DBEAFE',

  // Text
  textPrimary: '#111827',
  // Darker than the Tailwind greys these started as. WCAG AA (4.5:1) leaves
  // no room for a lighter tier on this background: the old muted #9CA3AF
  // measured 2.43:1 against #F9FAFB. apps/web mirrors these exactly and its
  // axe suite holds the line.
  textSecondary: '#4B5563',
  textMuted: '#6B7280',

  // Status colours (Snagv1's real snag_status enum: flagged/in_progress/resolved/rca_pending)
  //
  // Each status has three values, and the third is the point: `*Fg` is the
  // colour to use for *text on the matching tint*. The base hue is for dots,
  // icons and rails, where WCAG's 3:1 non-text threshold applies; as label
  // text on its own tinted pill it does not clear 4.5:1 — in-progress managed
  // 2.07:1, which on a badge that says whether a hazard is being dealt with
  // is not a rounding error. apps/web mirrors these and its axe suite fails
  // if either regresses.
  status: {
    open: '#3B82F6',
    openFg: '#1D4ED8',
    openBg: '#EFF6FF',
    doing: '#F59E0B',
    doingFg: '#B45309',
    doingBg: '#FFFBEB',
    done: '#10B981',
    doneFg: '#047857',
    doneBg: '#ECFDF5',
  },

  // Effort — deliberately neutral. Effort answers "can I finish this today",
  // which is not an alarm, so it must never compete with priority or due
  // state for attention on the same card.
  effort: {
    fg: '#4B5563',
    bg: '#F3F4F6',
  },

  // Due state. Overdue is the one thing on a household list that has actually
  // earned red — it is a fact, not a judgement about importance.
  due: {
    overdueFg: '#B91C1C',
    overdueBg: '#FEE2E2',
    soonFg: '#B45309',
    soonBg: '#FFFBEB',
    scheduledFg: '#4B5563',
    scheduledBg: '#F3F4F6',
  },

  // Priority colours — only "high" carries an alert colour; low/medium are
  // rendered as neutral dots so they never collide with status badge hues.
  priority: {
    high: '#EF4444',
    highBg: '#FEF2F2',
    low: '#6B7280',
    lowBg: '#F3F4F6',
  },

  // Success — save confirmations, positive vote state, "copied" feedback
  success: '#16A34A',
  successFg: '#15803D',
  successBg: '#F0FDF4',
  successBorder: '#BBF7D0',

  white: '#FFFFFF',
  black: '#000000',
  danger: '#EF4444',
  dangerFg: '#B91C1C',

  // Scrim for chips laid over a photo (site pill, merge indicator, the "new
  // since your last visit" dot). A photo is not a background you can pick a
  // text colour against, so anything sitting on one gets this behind it and
  // white on top.
  photoOverlay: 'rgba(17, 24, 39, 0.75)',
};

export const Radius = {
  card: 12,
  button: 8,
  chip: 4,
  input: 8,
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

  // Font weights — React Native uses string literals
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const MIN_TOUCH_TARGET = 48;

// Elevation scale. Elevated surfaces (Card variant="elevated") drop their
// border and use one of these instead; nested rows inside lists stay
// border-only so long scrolling lists don't stack shadows.
export const Shadow = {
  sm: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  lg: {
    shadowColor: '#0F172A',
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
