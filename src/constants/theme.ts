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

  // Status colours
  status: {
    open: '#3B82F6',
    openBg: '#EFF6FF',
    inProgress: '#F59E0B',
    inProgressBg: '#FFFBEB',
    resolved: '#10B981',
    resolvedBg: '#ECFDF5',
    closed: '#9CA3AF',
    closedBg: '#F3F4F6',
  },

  // Priority colours
  priority: {
    high: '#EF4444',
    highBg: '#FEF2F2',
    medium: '#F59E0B',
    mediumBg: '#FFFBEB',
    low: '#3B82F6',
    lowBg: '#EFF6FF',
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

  white: '#FFFFFF',
  black: '#000000',
  danger: '#EF4444',
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

  // Font weights — React Native uses string literals
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const MIN_TOUCH_TARGET = 48;
