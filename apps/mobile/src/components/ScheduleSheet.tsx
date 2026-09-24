import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import Icon from './Icon';
import DateField from './DateField';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { formatLooseDate, formatMoney, milestoneAmount, parseLooseDate } from '@snag/supabase-queries';
import type { MilestoneInput } from '@snag/supabase-queries';
import { ProjectMilestone, ProjectQuote } from '../types';

interface Props {
  visible: boolean;
  quote: ProjectQuote | null;
  milestones: ProjectMilestone[];
  /** Bills already claimed, so a settled milestone can say so. */
  claimedIds: string[];
  onAdd: (input: MilestoneInput) => Promise<void>;
  onDelete: (milestoneId: string) => Promise<void>;
  onClose: () => void;
}

/**
 * When the money is going to be asked for.
 *
 * The builder says 25% at each milestone. Until now that lived in free text on
 * whichever invoice happened to arrive — *"INV-0208 — claim 2, 25%"* — so the
 * app knew about the claim in front of it and nothing about the three still
 * coming. A householder who cannot see that $87,975 more is due before Christmas
 * finds out in November.
 *
 * **Optional, and absent by default.** A tile shop takes payment and that is
 * that. This is offered on a signed contract and never asked for, which is why
 * there is no prompt anywhere that a commitment "needs" a schedule.
 *
 * **A milestone is not a bill.** It is what somebody said would be claimed; the
 * claim is the invoice that turns up pointing back at it. That is what lets the
 * page say *"milestone 3 hasn't been claimed yet"* rather than only counting
 * what has already arrived.
 *
 * **And nothing sends anything.** A due date here is a fact on a row that the
 * page sorts by — this product has no notifications and money does not get an
 * exception.
 */
export default function ScheduleSheet({
  visible, quote, milestones, claimedIds, onAdd, onDelete, onClose,
}: Props) {
  const insets = useEdgeInsets();
  const keyboard = useKeyboardInset();

  const [name, setName] = useState('');
  const [percent, setPercent] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName('');
    setPercent('');
    setDueOn('');
  }, [visible, quote?.id]);

  if (!quote) return null;

  const canSave = name.trim().length > 0 && percent.trim().length > 0;
  const claimed = new Set(claimedIds);

  const allocated = milestones.reduce((sum, m) => sum + (m.percent ?? 0), 0);

  async function save() {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      const parsed = Number(percent.replace(/[^0-9.]/g, ''));
      await onAdd({
        name: name.trim(),
        percent: Number.isFinite(parsed) ? parsed : null,
        dueOn: parseLooseDate(dueOn) ?? null,
      });
      setName('');
      setPercent('');
      setDueOn('');
    } finally {
      setBusy(false);
    }
  }

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
              When {quote.supplier ?? 'they'} will claim
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {formatMoney(quote.amountIncl) ?? '—'}
              {allocated > 0 ? ` · ${allocated}% scheduled` : ''}
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
          {milestones.length === 0 ? (
            <Text style={styles.empty}>
              Nothing scheduled. Most suppliers don&rsquo;t have one — a builder usually does.
            </Text>
          ) : null}

          {milestones.map((milestone) => {
            const due = milestoneAmount(milestone, quote.amountIncl);
            const done = claimed.has(milestone.id);
            return (
              <View key={milestone.id} style={styles.row}>
                <Icon
                  name={done ? 'checkbox-outline' : 'square-outline'}
                  size="md"
                  color={done ? Colors.primary : Colors.textMuted}
                />
                <View style={styles.rowTitles}>
                  <Text style={styles.rowName}>{milestone.name}</Text>
                  <Text style={styles.rowSub}>
                    {[
                      milestone.percent !== null ? `${milestone.percent}%` : null,
                      formatLooseDate(milestone.dueOn) || null,
                      done ? 'claimed' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Text style={styles.rowAmount} numberOfLines={1}>
                  {formatMoney(due) ?? '—'}
                </Text>
                <Pressable
                  onPress={() => onDelete(milestone.id)}
                  style={styles.remove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${milestone.name}`}
                >
                  <Icon name="close" size="sm" color={Colors.textMuted} />
                </Pressable>
              </View>
            );
          })}

          <Text style={styles.label}>WHAT HAS TO HAPPEN</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            accessibilityLabel="What has to happen"
          />

          <Text style={styles.label}>HOW MUCH OF IT (%)</Text>
          <TextInput
            style={styles.input}
            value={percent}
            onChangeText={setPercent}
            keyboardType="decimal-pad"
            accessibilityLabel="What percentage"
          />

          <DateField
            label="Roughly when"
            value={dueOn}
            onChangeValue={setDueOn}
            placeholder="No date — that’s fine"
          />

          <Pressable
            onPress={save}
            disabled={!canSave || busy}
            style={[styles.cta, (!canSave || busy) && styles.ctaOff]}
            accessibilityRole="button"
            accessibilityLabel="Add the milestone"
          >
            <Text style={[styles.ctaLabel, (!canSave || busy) && styles.ctaLabelOff]}>
              {busy ? 'Saving…' : 'Add the milestone'}
            </Text>
          </Pressable>

          <Text style={styles.hint}>
            Snag doesn&rsquo;t remind anybody — this is so the page can tell you what&rsquo;s still
            to come.
          </Text>
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
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  rowTitles: { flex: 1, minWidth: 0 },
  rowName: { fontSize: Typography.base, color: Colors.textPrimary },
  rowSub: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 2 },
  rowAmount: { fontSize: Typography.base, fontFamily: Fonts.mono, color: Colors.textPrimary },
  remove: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md,
  },
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
  cta: {
    backgroundColor: Colors.primary, borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { fontSize: Typography.base, color: Colors.white, fontWeight: Typography.semibold },
  ctaLabelOff: { color: Colors.textMuted },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.sm },
});
