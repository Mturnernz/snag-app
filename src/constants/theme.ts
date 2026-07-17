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
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',

  // Status colours (Snagv1's real snag_status enum: flagged/in_progress/resolved/rca_pending)
  status: {
    flagged: '#3B82F6',
    flaggedBg: '#EFF6FF',
    inProgress: '#F59E0B',
    inProgressBg: '#FFFBEB',
    resolved: '#10B981',
    resolvedBg: '#ECFDF5',
    rcaPending: '#DC2626',
    rcaPendingBg: '#FEE2E2',
  },

  // Priority colours — only "high" carries an alert colour; low/medium are
  // rendered as neutral dots so they never collide with status badge hues.
  priority: {
    high: '#EF4444',
    highBg: '#FEF2F2',
    medium: '#6B7280',
    mediumBg: '#F3F4F6',
    low: '#9CA3AF',
    lowBg: '#F3F4F6',
  },

  // Category pill — muted background tones
  category: {
    niggle: '#6B7280',
    niggleBg: '#F3F4F6',
    brokenEquipment: '#B45309',
    brokenEquipmentBg: '#FEF3C7',
    healthAndSafety: '#DC2626',
    healthAndSafetyBg: '#FEE2E2',
    other: '#7C3AED',
    otherBg: '#EDE9FE',
  },

  // Relevance reasons — why a snag surfaced in a member's default "Relevant
  // to me" feed (IssueListScreen). Distinct from status/category colours
  // since they answer "why is this here" rather than describing the snag.
  relevance: {
    rcaPending: '#DC2626',
    rcaPendingBg: '#FEE2E2',
    assigned: '#2563EB',
    assignedBg: '#DBEAFE',
    tagged: '#7C3AED',
    taggedBg: '#EDE9FE',
    reported: '#6B7280',
    reportedBg: '#F3F4F6',
  },

  // Success — save confirmations, positive vote state, "copied" feedback
  success: '#16A34A',
  successBg: '#F0FDF4',
  successBorder: '#BBF7D0',

  // Serious / incident lane identity colour — reserved exclusively for the
  // health & safety category and the incident report flow. Never reused for
  // "priority" so it can't collide with priority.high.
  serious: '#DC2626',
  seriousBg: '#FEE2E2',

  white: '#FFFFFF',
  black: '#000000',
  danger: '#EF4444',
};

// Work group tile colours — a curated palette an admin/supervisor picks from
// rather than a freeform colour picker, so tiles always stay legible with
// white icon/label text on top.
export const WorkGroupPalette = [
  '#2563EB', // blue
  '#DC2626', // red
  '#16A34A', // green
  '#D97706', // amber
  '#7C3AED', // purple
  '#0891B2', // cyan
  '#DB2777', // pink
  '#4B5563', // slate
];

// Card alert borders — a deliberate, narrow exception to "elevated cards
// drop their border": severity/kind-driven borders that make injury,
// critical, and improvement snags immediately scannable in the list, layered
// on top of the card's normal shadow rather than replacing it.
export const CardAlertBorder = {
  injury: Colors.black,
  critical: Colors.priority.high,
  improvement: Colors.category.other,
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
