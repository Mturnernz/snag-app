import React from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';

/**
 * The V2 grouped list: white rounded groups on the plaster ground, rows split
 * by a hairline, a section title above in sentence case.
 *
 * **One set of primitives, so every screen reads alike.** Sizes follow the iOS
 * text styles in `Typography` — 17 for a row, 15 for what sits under it, 20 for
 * a section — and colour is still spent only on interaction: a tinted pill or a
 * fern word is something to press, and nothing else on a row is coloured.
 *
 * **A row says facts, not commentary.** Its subtitle is a count, a date, a
 * supplier or a figure the reader can add up; there is no prop for a sentence
 * of explanation, because the V2 pass removed every one of those that could not
 * be checked.
 */

export function SectionTitle({
  title, count, action,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section} accessibilityRole="header">{title}</Text>
      {count !== undefined ? <Text style={styles.sectionCount}>{count}</Text> : null}
      <View style={styles.spacer} />
      {action}
    </View>
  );
}

export function Group({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, style]}>
      {rows.map((child, index) => (
        <React.Fragment key={index}>
          {index > 0 ? <View style={styles.separator} /> : null}
          {child}
        </React.Fragment>
      ))}
    </View>
  );
}

interface RowProps {
  title: string;
  subtitle?: string | null;
  value?: string | null;
  /** Value colour: muted for undecided figures, fern for "left in budget". */
  tone?: 'default' | 'muted' | 'good' | 'danger';
  onPress?: () => void;
  /** A control that sits after the value — a pill, a switch. Never inside the row's own tap. */
  accessory?: React.ReactNode;
  leading?: React.ReactNode;
  accessibilityLabel?: string;
  dim?: boolean;
  bold?: boolean;
}

export function Row({
  title, subtitle, value, tone = 'default', onPress, accessory, leading,
  accessibilityLabel, dim, bold,
}: RowProps) {
  const body = (
    <>
      {leading}
      <View style={styles.titles}>
        <Text style={[styles.title, bold && styles.bold]} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {value ? (
        <Text
          style={[
            styles.value,
            tone === 'muted' && styles.muted,
            tone === 'good' && styles.good,
            tone === 'danger' && styles.danger,
            bold && styles.bold,
          ]}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      {onPress && !accessory ? <Icon name="chevron-forward" size={16} color={Colors.chevron} /> : null}
    </>
  );
  return (
    <View style={[styles.row, dim && styles.dim]}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          style={styles.rowTap}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? title}
        >
          {body}
        </Pressable>
      ) : (
        <View style={styles.rowTap}>{body}</View>
      )}
      {accessory}
    </View>
  );
}

/** A tinted pill — the inline action on a row: Choose, Paid. */
export function Pill({
  label, onPress, accessibilityLabel, disabled,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={styles.pillTap}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <View style={[styles.pill, disabled && styles.pillOff]}>
        <Text style={[styles.pillLabel, disabled && styles.pillLabelOff]}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** A row whose whole job is to add something: a fern + in a disc, then the words. */
export function AddRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.addRow} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.addDisc}><Icon name="add" size={16} color={Colors.white} /></View>
      <Text style={styles.addLabel}>{label}</Text>
    </Pressable>
  );
}

/** The one filled button on a screen. */
export function PrimaryButton({
  label, onPress, disabled, busy, accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={[styles.primary, off && styles.primaryOff]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
    >
      <Text style={[styles.primaryLabel, off && styles.primaryLabelOff]}>{busy ? 'Saving…' : label}</Text>
    </Pressable>
  );
}

/** Words to press, with no box: Cancel, Record a part payment, Delete. */
export function TextButton({
  label, onPress, tone = 'default', accessibilityLabel, bold,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  accessibilityLabel?: string;
  bold?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.textButton}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={[styles.textButtonLabel, tone === 'danger' && styles.danger, bold && styles.bold]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Two or three named answers in a sunken track, the chosen one raised.
 * `value` may be null: some questions here must be answered, never defaulted.
 */
export function Segmented<T extends string>({
  options, value, onChange, accessibilityLabel,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (next: T) => void;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            // The visible segment is 32pt, like every chip here; the tap area
            // reaches the 48pt minimum without making the track that tall.
            hitSlop={8}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            accessibilityLabel={option.label}
          >
            <View style={[styles.segmentOption, on && styles.segmentOn]}>
              <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]}>{option.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One answer in a list of them, with a radio mark. */
export function RadioRow({
  title, subtitle, selected, onPress,
}: {
  title: string;
  subtitle?: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.radioRow}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={title}
    >
      <Icon
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? Colors.primary : Colors.chevron}
      />
      <View style={styles.titles}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

export const groupedStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl * 2, gap: Spacing.xxl + 4 },
  block: { gap: Spacing.sm + 2 },
  largeTitle: {
    fontSize: Typography.largeTitle, lineHeight: 41, fontWeight: Typography.bold,
    color: Colors.textPrimary, letterSpacing: -0.4,
  },
  caption: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.textMuted },
  hint: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.textMuted, paddingHorizontal: 4 },
  question: { fontSize: Typography.body, fontWeight: Typography.semibold, color: Colors.textPrimary, paddingHorizontal: 4 },
});

const styles = StyleSheet.create({
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, paddingHorizontal: 4 },
  section: {
    fontSize: Typography.title3, lineHeight: 25, fontWeight: Typography.semibold,
    color: Colors.textPrimary, letterSpacing: -0.3,
  },
  sectionCount: { fontSize: Typography.body, color: Colors.textMuted },
  spacer: { flex: 1 },
  group: { backgroundColor: Colors.surface, borderRadius: Radius.card, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth * 2, backgroundColor: Colors.separator, marginLeft: Spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: Spacing.md },
  rowTap: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    minHeight: 52, paddingVertical: Spacing.sm + 2, paddingLeft: Spacing.lg,
  },
  titles: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: Typography.body, lineHeight: 22, color: Colors.textPrimary },
  subtitle: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.textMuted },
  value: {
    fontSize: Typography.body, color: Colors.textPrimary, fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  muted: { color: Colors.textMuted },
  good: { color: Colors.primary, fontWeight: Typography.semibold },
  danger: { color: Colors.danger },
  bold: { fontWeight: Typography.semibold },
  dim: { opacity: 0.55 },
  pillTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingLeft: Spacing.sm },
  pill: {
    height: 32, paddingHorizontal: Spacing.md + 2, borderRadius: Radius.pill,
    backgroundColor: Colors.primaryLight, justifyContent: 'center',
  },
  pillOff: { backgroundColor: Colors.sunken },
  pillLabel: { fontSize: Typography.subhead, fontWeight: Typography.semibold, color: Colors.primary },
  pillLabelOff: { color: Colors.textMuted },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 52,
    paddingHorizontal: Spacing.lg, backgroundColor: Colors.surface, borderRadius: Radius.card,
  },
  addDisc: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  addLabel: { fontSize: Typography.body, color: Colors.primary },
  primary: {
    minHeight: 52, borderRadius: Radius.button, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg,
  },
  primaryOff: { backgroundColor: Colors.sunken },
  primaryLabel: { fontSize: Typography.body, fontWeight: Typography.semibold, color: Colors.white },
  primaryLabelOff: { color: Colors.textMuted },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.sm },
  textButtonLabel: { fontSize: Typography.body, color: Colors.primary },
  segment: {
    flexDirection: 'row', backgroundColor: Colors.segment, borderRadius: 9, padding: 2,
    alignSelf: 'flex-start',
  },
  segmentOption: { height: 32, paddingHorizontal: Spacing.md + 2, borderRadius: 7, justifyContent: 'center' },
  segmentOn: {
    backgroundColor: Colors.surface,
    shadowColor: Colors.textPrimary, shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentLabel: { fontSize: Typography.subhead, color: Colors.textPrimary },
  segmentLabelOn: { fontWeight: Typography.semibold },
  radioRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
});
