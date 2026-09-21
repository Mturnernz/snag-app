import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import MoneyField from './MoneyField';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import {
  describeBuildUp, describeLineMovement, formatMoney, inclGst,
} from '@snag/supabase-queries';
import type { QuoteLineInput } from '@snag/supabase-queries';
import {
  ProjectAllowanceKind, ProjectQuote, ProjectQuoteLine,
  PROJECT_ALLOWANCE_KIND_LABELS, PROJECT_ALLOWANCE_KINDS,
} from '../types';

interface Props {
  visible: boolean;
  quote: ProjectQuote | null;
  lines: ProjectQuoteLine[];
  /** Prices that answer one of these lines, so each can say what it is now reading. */
  quotes: ProjectQuote[];
  onAddLine: (input: QuoteLineInput) => Promise<void>;
  onDeleteLine: (lineId: string) => Promise<void>;
  onClose: () => void;
}

/**
 * What a builder's number is actually made of.
 *
 * **This is the screen the money model has been waiting for.** Every rule about
 * allowances — the PC sum, the supersession, the variance in both tenses, the
 * recompute from the build-up — was written, granted and tested five months ago
 * and has **never once run against real data**, because nothing anywhere could
 * create a line. The live renovation carries a $176,755 contract as one opaque
 * number, so none of the early warnings the feature exists for can ever fire.
 *
 * A line is either an ordinary part of the price or an **allowance**: a figure
 * the builder wrote down for something they are not supplying, or have not yet
 * priced. If it is an allowance the sheet asks the three things the app must
 * never infer, and each is a number-sized lie when guessed:
 *
 *   1. **Which word did the contract use?** PC sum, provisional sum or ballpark.
 *      They behave differently at final account and that argument is the
 *      householder's to have, so the app records what they signed rather than
 *      flattening all three into "allowance".
 *   2. **Is it inside the quoted total or on top of it?** $150,000 "including a
 *      $10,000 laundry allowance" and $150,000 "and budget another $10,000" are
 *      different by exactly $10,000. An additional line that nobody has priced
 *      is *not committed* — it goes to the forecast, named as a guess.
 *   3. **Does the builder keep a margin if it is bought direct?** The allowance
 *      leaves the contract; the attendance fee usually does not.
 *
 * **Lines are not required to sum to the quote.** Trade quotes round, bundle and
 * carry a margin line that is nobody's business, and a form that refuses a quote
 * whose lines do not balance teaches people to fudge a line until it does. Where
 * the two differ the sheet says so quietly, in `describeBuildUp`, and corrects
 * neither.
 */
export default function BuildUpSheet({
  visible, quote, lines, quotes, onAddLine, onDeleteLine, onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [isAllowance, setIsAllowance] = useState(false);
  const [allowanceKind, setAllowanceKind] = useState<ProjectAllowanceKind>('ballpark');
  const [additional, setAdditional] = useState(false);
  const [attendance, setAttendance] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    reset();
    setAdding(lines.length === 0);
  }, [visible, quote?.id]);

  function reset() {
    setName('');
    setAmount('');
    setIncl(true);
    setIsAllowance(false);
    setAllowanceKind('ballpark');
    setAdditional(false);
    setAttendance('');
  }

  if (!quote) return null;

  const canSave = name.trim().length > 0;

  async function save() {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      const parsedAmount = amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) : NaN;
      const parsedPct = attendance.trim() ? Number(attendance.replace(/[^0-9.]/g, '')) : NaN;
      await onAddLine({
        name: name.trim(),
        amount: Number.isFinite(parsedAmount) ? parsedAmount : null,
        amountInclGst: incl,
        isAllowance,
        allowanceKind: isAllowance ? allowanceKind : null,
        additional: isAllowance && additional,
        attendancePct: isAllowance && Number.isFinite(parsedPct) ? parsedPct : null,
      });
      reset();
      setAdding(false);
    } finally {
      setBusy(false);
    }
  }

  /** What has since been quoted against a line, and whether it was taken. */
  function answeredBy(lineId: string): { total: number | null; accepted: boolean } {
    const answers = quotes.filter((q) => q.supersedesLineId === lineId);
    const accepted = answers.filter((q) => q.status === 'accepted');
    const use = accepted.length > 0 ? accepted : answers;
    if (use.length === 0) return { total: null, accepted: false };
    const total = use.reduce((sum, q) => sum + (inclGst(q.amount, q.amountInclGst) ?? 0), 0);
    return { total, accepted: accepted.length > 0 };
  }

  const buildUpLine = describeBuildUp(quote);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[
          styles.sheet,
          { marginBottom: keyboard, paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + Spacing.lg },
        ]}
      >
        <View style={styles.grab} />
        <View style={styles.head}>
          <View style={styles.headTitles}>
            <Text style={styles.title} numberOfLines={1}>
              What&rsquo;s in {quote.supplier ?? 'this price'}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {formatMoney(quote.amountIncl) ?? '—'}
              {buildUpLine ? ` · ${buildUpLine}` : ''}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            style={styles.headTap}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Icon name="close" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
          {lines.length === 0 && !adding ? (
            <Text style={styles.empty}>
              Nothing broken out yet. A builder&rsquo;s number is usually a list — and the lines
              they call an allowance are the ones that move.
            </Text>
          ) : null}

          {lines.map((line) => {
            const answer = answeredBy(line.id);
            const movement = line.isAllowance
              ? describeLineMovement(line, answer.total, answer.accepted)
              : null;
            return (
              <View key={line.id} style={styles.line}>
                <View style={styles.lineTitles}>
                  <Text style={styles.lineName}>{line.name}</Text>
                  {line.isAllowance ? (
                    <Text style={styles.lineTag}>
                      {line.allowanceKind
                        ? PROJECT_ALLOWANCE_KIND_LABELS[line.allowanceKind]
                        : 'Allowance'}
                      {line.additional ? ' · on top of the total' : ' · inside the total'}
                      {line.attendancePct !== null ? ` · ${line.attendancePct}% margin` : ''}
                    </Text>
                  ) : null}
                  {movement ? <Text style={styles.movement}>{movement}</Text> : null}
                </View>
                <Text style={styles.lineAmount} numberOfLines={1}>
                  {formatMoney(inclGst(line.amount, line.amountInclGst)) ?? '—'}
                </Text>
                <Pressable
                  onPress={() => onDeleteLine(line.id)}
                  style={styles.lineRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${line.name}`}
                >
                  <Icon name="close" size="sm" color={Colors.textMuted} />
                </Pressable>
              </View>
            );
          })}

          {adding ? (
            <View style={styles.form}>
              <Text style={styles.label}>WHAT THE QUOTE CALLS IT</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                accessibilityLabel="What the quote calls it"
              />

              <MoneyField
                label="How much"
                value={amount}
                onChangeValue={setAmount}
                inclusive={incl}
                onChangeInclusive={setIncl}
              />

              {/* Two named halves. An unlabelled absence of a press is not an
                  answer, and here the unlabelled answer decides whether the
                  number can move. */}
              <Text style={styles.question}>Is this a firm price, or an allowance?</Text>
              <View style={styles.chips}>
                {([
                  [false, 'A firm price'],
                  [true, 'An allowance'],
                ] as [boolean, string][]).map(([option, label]) => {
                  const on = isAllowance === option;
                  return (
                    <Pressable
                      key={label}
                      onPress={() => setIsAllowance(option)}
                      style={styles.chipTap}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={label}
                    >
                      <View style={[styles.chip, on && styles.chipOn]}>
                        <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {isAllowance ? (
                <>
                  <Text style={styles.question}>What does the contract call it?</Text>
                  <View style={styles.chips}>
                    {PROJECT_ALLOWANCE_KINDS.map((option) => {
                      const on = allowanceKind === option;
                      return (
                        <Pressable
                          key={option}
                          onPress={() => setAllowanceKind(option)}
                          style={styles.chipTap}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={PROJECT_ALLOWANCE_KIND_LABELS[option]}
                        >
                          <View style={[styles.chip, on && styles.chipOn]}>
                            <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                              {PROJECT_ALLOWANCE_KIND_LABELS[option]}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* The question worth the whole allowance if it is guessed. */}
                  <Text style={styles.question}>
                    Is it inside the {formatMoney(quote.amountIncl) ?? 'quoted total'}?
                  </Text>
                  <View style={styles.chips}>
                    {([
                      [false, 'Inside it'],
                      [true, 'On top of it'],
                    ] as [boolean, string][]).map(([option, label]) => {
                      const on = additional === option;
                      return (
                        <Pressable
                          key={label}
                          onPress={() => setAdditional(option)}
                          style={styles.chipTap}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={label}
                        >
                          <View style={[styles.chip, on && styles.chipOn]}>
                            <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                              {label}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.hint}>
                    {additional
                      ? 'On top: nobody has committed to this, so it sits in the forecast rather than in what you’ve agreed.'
                      : 'Inside: it’s in the contract sum, so it counts as committed — and is flagged as still an allowance.'}
                  </Text>

                  <Text style={styles.label}>MARGIN IF BOUGHT DIRECT (%)</Text>
                  <TextInput
                    style={styles.input}
                    value={attendance}
                    onChangeText={setAttendance}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Margin if bought direct, percent"
                  />
                  <Text style={styles.hint}>
                    Leave it empty if they don&rsquo;t charge one. It&rsquo;s a percentage of what
                    the job actually costs, not of the allowance.
                  </Text>
                </>
              ) : null}

              <View style={styles.formActions}>
                <Pressable
                  onPress={() => {
                    reset();
                    setAdding(false);
                  }}
                  style={styles.wayOut}
                  accessibilityRole="button"
                  accessibilityLabel="Not now"
                >
                  <Text style={styles.wayOutLabel}>Not now</Text>
                </Pressable>
                <Pressable
                  onPress={save}
                  disabled={!canSave || busy}
                  style={[styles.cta, (!canSave || busy) && styles.ctaOff]}
                  accessibilityRole="button"
                  accessibilityLabel="Add the line"
                >
                  <Text style={[styles.ctaLabel, (!canSave || busy) && styles.ctaLabelOff]}>
                    {busy ? 'Saving…' : 'Add the line'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setAdding(true)}
              style={styles.addRow}
              accessibilityRole="button"
              accessibilityLabel="Add a line"
            >
              <Icon name="add" size="md" color={Colors.primary} />
              <Text style={styles.addLabel}>Add a line</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '90%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm,
  },
  grab: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.sm },
  headTitles: { flex: 1, minWidth: 0 },
  title: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  sub: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: 2 },
  headTap: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md,
  },
  scroll: { marginTop: Spacing.sm },
  empty: { fontSize: Typography.sm, color: Colors.textMuted, marginVertical: Spacing.md },
  line: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  lineTitles: { flex: 1, minWidth: 0 },
  lineName: { fontSize: Typography.base, color: Colors.textPrimary },
  lineTag: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 2 },
  movement: { fontSize: Typography.xs, color: Colors.textSecondary, marginTop: 2 },
  lineAmount: {
    fontSize: Typography.base, color: Colors.textPrimary, fontFamily: Fonts.mono,
    marginLeft: Spacing.sm,
  },
  lineRemove: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md,
  },
  form: { marginTop: Spacing.sm },
  label: {
    fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textMuted,
    letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: Spacing.lg, marginBottom: Spacing.xs,
  },
  input: {
    fontSize: Typography.base, color: Colors.textPrimary,
    backgroundColor: Colors.sunken, borderRadius: Radius.input,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET, minWidth: 0,
  },
  question: {
    fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary,
    marginTop: Spacing.lg, marginBottom: Spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingRight: Spacing.sm },
  chip: {
    backgroundColor: Colors.sunken, borderRadius: Radius.chip,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: {
    fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium,
  },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.sm },
  formActions: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg,
  },
  wayOut: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: Spacing.md,
  },
  wayOutLabel: { fontSize: Typography.base, color: Colors.textSecondary },
  cta: {
    flex: 1, backgroundColor: Colors.primary, borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
  },
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { fontSize: Typography.base, color: Colors.white, fontWeight: Typography.semibold },
  ctaLabelOff: { color: Colors.textMuted },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET, marginTop: Spacing.sm,
  },
  addLabel: { fontSize: Typography.base, color: Colors.primary, fontWeight: Typography.medium },
});
