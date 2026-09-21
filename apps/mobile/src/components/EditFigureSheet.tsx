import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import MoneyField from './MoneyField';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { formatMoney } from '@snag/supabase-queries';
import { ProjectFigure, PROJECT_FIGURE_LABELS } from '../types';

interface Props {
  visible: boolean;
  field: ProjectFigure | null;
  /** What the prices add up to. Always shown, and never replaced. */
  derived: number | null;
  /** What was typed before, if this is a second edit. */
  override: number | null;
  note: string | null;
  onSave: (amount: number, amountInclGst: boolean, note: string | null) => Promise<void>;
  onClear: () => Promise<void>;
  onClose: () => void;
}

/**
 * Typing a figure over the one the prices add up to.
 *
 * **Nothing about the derivation changes.** This writes an override that sits
 * *beside* the derived figure — `committed_derived` goes on being what the
 * quotes say, forever, so the page can name the discrepancy and go on naming it
 * for as long as the edit lasts. That is the difference between an override and
 * a lie, and it is also what makes *Use the prices again* a real undo rather
 * than a recovery from nothing.
 *
 * **The derived figure is on screen the whole time somebody is typing.** A form
 * that hid it would be inviting a number with nothing to check it against, and
 * the one moment a person is most likely to mistype a six-figure sum is the
 * moment they are deliberately overriding one.
 *
 * **The note is the part that ages well.** Eight months on, *"builder confirmed
 * the variation by email, 12 Sept"* is the difference between a figure somebody
 * trusts and a figure somebody has to work out again from scratch. It is
 * optional, because a required field here would be answered with a full stop.
 *
 * Everything else the app already decided applies: the GST pill, because every
 * money box carries one and there is no household-wide setting; and clearing as
 * its own control rather than an emptied box, for the reason `set_part_bought`
 * is its own function.
 */
export default function EditFigureSheet({
  visible, field, derived, override, note, onSave, onClear, onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setAmount(override === null ? '' : String(override));
    setIncl(true);
    setWhy(note ?? '');
  }, [visible, field, override, note]);

  if (!field) return null;

  const label = PROJECT_FIGURE_LABELS[field];
  const canSave = amount.trim().length > 0;

  const typed = amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) : NaN;
  const gross = Number.isFinite(typed) ? (incl ? typed : typed * 1.15) : null;
  const gap = gross !== null && derived !== null ? gross - derived : null;

  async function save() {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      const parsed = Number(amount.replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(parsed)) return;
      await onSave(parsed, incl, why.trim() || null);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    try {
      await onClear();
      onClose();
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
          <Text style={styles.title}>Edit {label}</Text>
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
          {/* The derived figure stays on screen the whole time. A form that hid
              what it is overriding invites a number with nothing to check it
              against. */}
          <View style={styles.derived}>
            <Text style={styles.derivedKey}>THE PRICES SAY</Text>
            <Text style={styles.derivedValue} numberOfLines={1}>
              {formatMoney(derived) ?? 'nothing priced yet'}
            </Text>
          </View>

          <MoneyField
            label={`${label}, as you want it read`}
            value={amount}
            onChangeValue={setAmount}
            inclusive={incl}
            onChangeInclusive={setIncl}
          />

          {gap !== null && Math.abs(gap) >= 0.005 ? (
            <Text style={styles.gap}>
              {formatMoney(Math.abs(gap))} {gap > 0 ? 'more' : 'less'} than the prices add up to.
            </Text>
          ) : null}

          <Text style={styles.label}>WHY</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={why}
            onChangeText={setWhy}
            multiline
            accessibilityLabel="Why this figure was edited"
          />
          <Text style={styles.hint}>
            Worth a line. In eight months this is the only thing that says where the number came
            from.
          </Text>

          <Text style={styles.blurb}>
            Snag keeps working out what the prices add up to either way, and says on the page
            where the two differ.
          </Text>
        </ScrollView>

        <Pressable
          onPress={save}
          disabled={!canSave || busy}
          style={[styles.cta, (!canSave || busy) && styles.ctaOff]}
          accessibilityRole="button"
          accessibilityLabel="Save the figure"
        >
          <Text style={[styles.ctaLabel, (!canSave || busy) && styles.ctaLabelOff]}>
            {busy ? 'Saving…' : 'Save the figure'}
          </Text>
        </Pressable>

        {/* Its own control rather than an emptied box: putting the derived
            figure back is the act that changes what the page claims. */}
        {override !== null ? (
          <Pressable
            onPress={clear}
            disabled={busy}
            style={styles.clear}
            accessibilityRole="button"
            accessibilityLabel="Use the prices again"
          >
            <Text style={styles.clearLabel}>Use the prices again</Text>
          </Pressable>
        ) : null}
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
  title: {
    flex: 1, minWidth: 0,
    fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary,
  },
  headTap: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md,
  },
  scroll: { marginTop: Spacing.sm },
  derived: {
    backgroundColor: Colors.sunken, borderRadius: Radius.card,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
  },
  derivedKey: {
    fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  derivedValue: {
    flex: 1, minWidth: 0, textAlign: 'right',
    fontFamily: Fonts.mono, fontSize: Typography.base, color: Colors.textSecondary,
  },
  gap: { fontSize: Typography.sm, color: Colors.danger, marginTop: Spacing.sm },
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
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.xs },
  blurb: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.lg },
  cta: {
    backgroundColor: Colors.primary, borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { fontSize: Typography.base, color: Colors.white, fontWeight: Typography.semibold },
  ctaLabelOff: { color: Colors.textMuted },
  clear: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  clearLabel: { fontSize: Typography.sm, color: Colors.textSecondary },
});
