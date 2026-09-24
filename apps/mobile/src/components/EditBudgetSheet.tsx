import React, { useEffect, useState } from 'react';
import { View, Text, Modal, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import Icon from './Icon';
import MoneyField from './MoneyField';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';

interface Props {
  visible: boolean;
  budget: number | null;
  budgetInclGst: boolean;
  onSave: (amount: number | null, amountInclGst: boolean) => Promise<void>;
  onClose: () => void;
}

/**
 * What you said you'd spend, typed rather than derived.
 *
 * Unlike every other figure on the project page, the budget has no build-up to
 * sit beside — it is the one figure nobody adds up from prices, so this is a
 * plain edit: one box, the GST pill every money box carries, and a way to clear
 * it back to "no budget set" rather than a half-typed zero.
 */
export default function EditBudgetSheet({ visible, budget, budgetInclGst, onSave, onClose }: Props) {
  const insets = useEdgeInsets();
  const keyboard = useKeyboardInset();

  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setAmount(budget === null ? '' : String(budget));
    setIncl(budgetInclGst);
  }, [visible, budget, budgetInclGst]);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const trimmed = amount.trim();
      if (trimmed.length === 0) {
        await onSave(null, incl);
      } else {
        const parsed = Number(trimmed.replace(/[^0-9.]/g, ''));
        if (!Number.isFinite(parsed)) return;
        await onSave(parsed, incl);
      }
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
          <Text style={styles.title}>Edit budget</Text>
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
          <MoneyField
            label="What you said you'd spend"
            value={amount}
            onChangeValue={setAmount}
            inclusive={incl}
            onChangeInclusive={setIncl}
            autoFocus
          />
          <Text style={styles.hint}>Leave it empty to clear the budget.</Text>
        </ScrollView>

        <Pressable
          onPress={save}
          disabled={busy}
          style={[styles.cta, busy && styles.ctaOff]}
          accessibilityRole="button"
          accessibilityLabel="Save the budget"
        >
          <Text style={[styles.ctaLabel, busy && styles.ctaLabelOff]}>
            {busy ? 'Saving…' : 'Save'}
          </Text>
        </Pressable>
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
  hint: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.xs },
  cta: {
    backgroundColor: Colors.primary, borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { fontSize: Typography.base, color: Colors.white, fontWeight: Typography.semibold },
  ctaLabelOff: { color: Colors.textMuted },
});
