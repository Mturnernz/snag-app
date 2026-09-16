import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import { Colors, Radius, Spacing, Typography, Fonts, MIN_TOUCH_TARGET } from '../constants/theme';
// From the packages directly, never through `lib/supabase`: that module builds
// the client at import time and throws without credentials, which would make a
// presentational component untestable and drag the whole client into any screen
// that only wanted to format a number.
import { formatMoney, inclGst } from '@snag/supabase-queries';
import { GST_RATE } from '../types';

interface Props {
  label: string;
  /** What was typed, as text. Kept as a string so a half-typed "1," is not a number yet. */
  value: string;
  onChangeValue: (next: string) => void;
  inclusive: boolean;
  onChangeInclusive: (next: boolean) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * An amount, and what that amount means.
 *
 * **Every money box in this app carries this pill, and there is deliberately no
 * household-wide GST setting.** New Zealand quotes come both ways — a trade
 * supplier writes ex-GST, a retailer writes inc — and the difference is 15%,
 * which on a renovation is the difference between on budget and two thousand
 * over. Asking once at setup and assuming it forever is how a project total
 * ends up quietly wrong, and quietly wrong is the only way this feature can
 * actually hurt somebody.
 *
 * So the pill sits beside the box, on every box, defaulted to **incl** because
 * that is what a householder reads off a receipt. It is two named halves rather
 * than one chip that toggles: the same argument that made capture's priority
 * step two named pills rather than a single *Urgent* — one chip leaves the
 * other answer as the unlabelled absence of a press, and here that unlabelled
 * answer is worth 15%.
 *
 * The line underneath shows the *other* number as it is typed, which is the
 * whole reason somebody can trust this. Nothing is converted on save: the
 * figure stored is the figure typed, and `amount_incl_gst` records what it
 * meant. The rollups normalise to inclusive because that is what leaves the
 * bank account.
 */
export default function MoneyField({
  label,
  value,
  onChangeValue,
  inclusive,
  onChangeInclusive,
  placeholder,
  autoFocus,
}: Props) {
  const typed = Number(value.replace(/[^0-9.]/g, ''));
  const valid = value.trim().length > 0 && Number.isFinite(typed) && typed > 0;
  // The other side of the pill, shown rather than asserted: somebody who typed
  // an ex-GST trade price sees what it actually comes to before they save it.
  const other = valid
    ? inclusive
      ? formatMoney(Math.round((typed / (1 + GST_RATE)) * 100) / 100)
      : formatMoney(inclGst(typed, false))
    : null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <View style={styles.inputWrap}>
          <Text style={styles.dollar}>$</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={onChangeValue}
            keyboardType="decimal-pad"
            placeholder={placeholder}
            placeholderTextColor={Colors.textMuted}
            autoFocus={autoFocus}
            accessibilityLabel={label}
          />
        </View>
        {/* The app's one chip, in its one styling: a sunken well when off,
            solid fern when on, no border either way. */}
        <View style={styles.pill}>
          <Pressable
            onPress={() => onChangeInclusive(true)}
            style={[styles.half, inclusive && styles.halfOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: inclusive }}
            accessibilityLabel="Includes GST"
          >
            <Text style={[styles.halfLabel, inclusive && styles.halfLabelOn]}>incl GST</Text>
          </Pressable>
          <Pressable
            onPress={() => onChangeInclusive(false)}
            style={[styles.half, !inclusive && styles.halfOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: !inclusive }}
            accessibilityLabel="Excludes GST"
          >
            <Text style={[styles.halfLabel, !inclusive && styles.halfLabelOn]}>excl</Text>
          </Pressable>
        </View>
      </View>
      {other ? (
        <Text style={styles.other}>
          {inclusive ? `${other} before GST` : `${other} with GST`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.md },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  inputWrap: {
    // A TextInput on web is an <input> with an intrinsic ~20-character width
    // that `min-width: auto` will not shrink below, so anything flexed around
    // one needs minWidth: 0 or it grows past the card and off the screen edge.
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
  },
  dollar: {
    fontFamily: Fonts.mono,
    fontSize: Typography.base,
    color: Colors.textMuted,
    marginRight: 2,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.mono,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    paddingVertical: Spacing.md,
  },
  pill: {
    flexDirection: 'row',
    backgroundColor: Colors.sunken,
    borderRadius: Radius.chip,
    overflow: 'hidden',
  },
  half: {
    paddingHorizontal: Spacing.sm,
    // The visible pill is ~34px; the tap area is the full target. Both rails on
    // the list were under 48 before this, which is invisible until somebody is
    // holding the phone one-handed.
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  halfOn: { backgroundColor: Colors.primary },
  halfLabel: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textSecondary },
  halfLabelOn: { color: Colors.white },
  other: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginTop: Spacing.xs,
    fontFamily: Fonts.mono,
  },
});
