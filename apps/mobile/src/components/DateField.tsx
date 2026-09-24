import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Modal, Pressable, StyleSheet } from 'react-native';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import Icon from './Icon';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { dayKey, formatDayFirst, monthGrid, parseLooseDate } from '@snag/supabase-queries';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
/** Monday-first, matching `monthGrid`'s own lead-in arithmetic. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface CalendarProps {
  visible: boolean;
  /** `YYYY-MM-DD`, or null when nothing is set yet. */
  selected: string | null;
  onPick: (iso: string) => void;
  onClear?: () => void;
  onClose: () => void;
  title?: string;
}

/**
 * A month of days to tap, and nothing else.
 *
 * **Hand-rolled, and the dependency is the trap.**
 * `@react-native-community/datetimepicker` is a native module first: on the
 * build people actually install it is react-native-web's problem, which is the
 * same shape of failure `Alert.alert` and `KeyboardAvoidingView` have already
 * caught this codebase out with twice — it type-checks, it renders, and it does
 * nothing. The deployed CSP is `default-src 'self'` with no CDN reachable, and
 * `"output": "single"` means anything added ships in the one bundle that has
 * just paid 490 KB for the PDF renderer.
 *
 * **And the arithmetic already exists.** `monthGrid` and `dayKey` were written
 * for the Schedule tab and are pinned by `schedule.test.ts`, so this is a
 * rendering job rather than a date-maths job — which also means the calendar
 * somebody picks a due date from and the calendar the Schedule tab draws can
 * never disagree about what a month looks like. That is worth more than it
 * sounds: two month grids built two ways drift at exactly the edges nobody
 * tests, the lead-in week and the leap year.
 *
 * **A day is a local day.** `dayKey` is the one place an instant becomes a
 * calendar cell, because `toISOString().slice(0, 10)` files a September evening
 * in Auckland under the next day for half the year. The suite runs under
 * `TZ=Pacific/Auckland` so that is a real assertion rather than one that
 * happens to hold on a UTC runner.
 */
export function CalendarSheet({
  visible, selected, onPick, onClear, onClose, title = 'Pick a date',
}: CalendarProps) {
  const insets = useEdgeInsets();
  const [cursor, setCursor] = useState(() => new Date());

  // Opens on the month of what is already set, so somebody correcting a date
  // lands beside it rather than in today and paging back four years.
  useEffect(() => {
    if (!visible) return;
    const at = selected ? new Date(`${selected}T00:00:00`) : new Date();
    setCursor(Number.isNaN(at.getTime()) ? new Date() : at);
  }, [visible, selected]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const days = useMemo(() => monthGrid(year, month), [year, month]);
  const today = dayKey(new Date());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.grab} />
        <Text style={styles.title}>{title}</Text>

        <View style={styles.monthRow}>
          <Pressable
            onPress={() => setCursor(new Date(year, month - 1, 1))}
            style={styles.monthTap}
            accessibilityRole="button"
            accessibilityLabel="Previous month"
          >
            <Icon name="chevron-back" size="md" color={Colors.textSecondary} />
          </Pressable>
          <Text style={styles.month}>{MONTH_NAMES[month]} {year}</Text>
          <Pressable
            onPress={() => setCursor(new Date(year, month + 1, 1))}
            style={styles.monthTap}
            accessibilityRole="button"
            accessibilityLabel="Next month"
          >
            <Icon name="chevron-forward" size="md" color={Colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.week}>
          {WEEKDAYS.map((day, i) => (
            <Text key={`${day}${i}`} style={styles.weekday}>{day}</Text>
          ))}
        </View>

        <View style={styles.grid}>
          {days.map((day) => {
            const key = dayKey(day);
            const outside = day.getMonth() !== month;
            const on = key === selected;
            return (
              <Pressable
                key={key}
                onPress={() => onPick(key)}
                style={styles.cell}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={day.toDateString()}
              >
                <View style={[styles.day, on && styles.dayOn]}>
                  <Text
                    style={[
                      styles.dayLabel,
                      // A day from the month either side is still tappable —
                      // the 1st sits in the last row of the month before it and
                      // refusing it would be a cell that looks like a date and
                      // is not one.
                      outside && styles.dayOutside,
                      on && styles.dayLabelOn,
                      !on && key === today && styles.dayToday,
                    ]}
                  >
                    {day.getDate()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={() => onPick(today)}
            style={styles.footerTap}
            accessibilityRole="button"
            accessibilityLabel="Today"
          >
            <Text style={styles.footerLabel}>Today</Text>
          </Pressable>
          {onClear ? (
            <Pressable
              onPress={onClear}
              style={styles.footerTap}
              accessibilityRole="button"
              accessibilityLabel="Clear the date"
            >
              <Text style={styles.footerClear}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

interface Props {
  label?: string;
  /** Exactly what is in the box — a string, so a half-typed date is not a date yet. */
  value: string;
  onChangeValue: (next: string) => void;
  onBlur?: () => void;
  /**
   * Left unset almost everywhere, deliberately.
   *
   * **No example values in any box** is a rule this app already pins: a grey
   * `Nov 2019` under INSTALLED does not read as a prompt, it reads as a date
   * somebody already entered, on the one page whose whole job is to be believed
   * in a shop eight months later. Even `dd/mm/yyyy` is redundant now — the
   * calendar sitting in the box says what it wants better than grey text does.
   * Pass one only when it says something an example never could, like "No date
   * — that's fine".
   */
  placeholder?: string;
  /** What the calendar calls itself: "When did it go in?" */
  pickerTitle?: string;
}

/**
 * A date somebody can type or tap.
 *
 * **Both, and the typed half is not the fallback.** A calendar can only say one
 * exact day, and `installed_at` on a forty-year-old villa is honestly answered
 * "Nov 2019" or just "1998" — `parseLooseDate` stores a missing day as the
 * first of the month and `formatLooseDate` then declines to show it back,
 * precisely so the record never claims a precision nobody offered. Replacing
 * the box with a picker would force everybody to invent a day. So the calendar
 * is an **addition** to the field, never a replacement for it, and that is the
 * rule to keep if this is ever tidied.
 *
 * What the calendar writes is `dd/mm/yyyy` through `formatDayFirst`, which
 * `parseLooseDate` reads back exactly — the two halves of one control have to
 * round-trip, or tapping a day and then leaving the field would change the
 * answer.
 */
export default function DateField({
  label, value, onChangeValue, onBlur, placeholder, pickerTitle,
}: Props) {
  const [open, setOpen] = useState(false);
  // `undefined` means "typed something I can't read" — which is not the same as
  // an empty box, and must not open the calendar on a wrong month.
  const parsed = parseLooseDate(value);
  const selected = typeof parsed === 'string' ? parsed : null;

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeValue}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          accessibilityLabel={label ?? 'Date'}
        />
        <Pressable
          onPress={() => setOpen(true)}
          style={styles.calendarTap}
          accessibilityRole="button"
          accessibilityLabel={label ? `Pick ${label.toLowerCase()} from a calendar` : 'Pick a date'}
        >
          <Icon name="calendar-outline" size="md" color={Colors.primary} />
        </Pressable>
      </View>

      <CalendarSheet
        visible={open}
        selected={selected}
        title={pickerTitle ?? label ?? 'Pick a date'}
        onPick={(iso) => {
          onChangeValue(formatDayFirst(iso));
          setOpen(false);
          onBlur?.();
        }}
        onClear={() => {
          onChangeValue('');
          setOpen(false);
          onBlur?.();
        }}
        onClose={() => setOpen(false)}
      />
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingRight: Spacing.xs,
  },
  input: {
    // On web a TextInput is an <input> with an intrinsic ~20-character width
    // that `min-width: auto` will not shrink below, so anything flexed around
    // one needs minWidth: 0 or it grows past the card and off the screen edge.
    flex: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  calendarTap: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  title: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
  monthTap: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  month: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  week: { flexDirection: 'row', marginTop: Spacing.xs },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: Typography.xs,
    color: Colors.textMuted,
    fontWeight: Typography.medium,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: Spacing.xs },
  // Seven to a row, and the width is a fraction rather than a measured pixel so
  // it holds on every phone width without a layout pass.
  cell: { width: `${100 / 7}%`, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: Colors.primary },
  dayLabel: { fontSize: Typography.sm, color: Colors.textPrimary, fontFamily: Fonts.mono },
  dayOutside: { color: Colors.textMuted, opacity: 0.55 },
  dayLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  dayToday: { color: Colors.primary, fontWeight: Typography.bold },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  footerTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  footerLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.primary },
  footerClear: { fontSize: Typography.sm, color: Colors.textMuted },
});
