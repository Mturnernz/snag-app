import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import MoneyField from './MoneyField';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import type { ExpectedCostInput } from '@snag/supabase-queries';
import { ProjectElement } from '../types';

interface Props {
  visible: boolean;
  elements: ProjectElement[];
  /** Whether the part layer is drawn. An implicit part has no name anybody chose. */
  showElements: boolean;
  onSave: (input: ExpectedCostInput) => Promise<void>;
  onClose: () => void;
}

/**
 * A cost somebody has told you to expect.
 *
 * The architect says *"you'll need an engineer, and the council will want their
 * share"*. That is the beat the money model could not hold: no vendor, no quote,
 * no invoice — just a number from somebody who knows the industry.
 *
 * Recording it as an **item with no price** made it worth nought to every figure
 * on the page, which is how the live renovation ended up with a *Geotech
 * engineer* row contributing zero while everybody's mental arithmetic carried
 * $4,000 for it. Recording it as a **quote** would be inventing a commitment
 * from a firm that has never heard of you, and it would then turn up under who
 * is owed what.
 *
 * So this writes the one row in the feature whose number is allowed to be
 * somebody's estimate. **It is never committed and never invoiced** — it reaches
 * the forecast and nothing else, and every figure it touches names it as a guess.
 *
 * **The amount is optional on purpose.** "There will be council costs" with no
 * figure yet is still worth recording: it shows on the page as a named gap
 * rather than being silently absent, and the forecast says how many such gaps it
 * is carrying.
 */
export default function ExpectedCostSheet({
  visible, elements, showElements, onSave, onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [likelySupplier, setLikelySupplier] = useState('');
  const [elementId, setElementId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName('');
    setAmount('');
    setIncl(true);
    setLikelySupplier('');
    setElementId(null);
  }, [visible]);

  const canSave = name.trim().length > 0;

  async function save() {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      const parsed = amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) : NaN;
      await onSave({
        name: name.trim(),
        amount: Number.isFinite(parsed) ? parsed : null,
        amountInclGst: incl,
        likelySupplier: likelySupplier.trim() || null,
        elementId,
      });
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
          <Text style={styles.title}>Something else you&rsquo;re expecting</Text>
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
          <Text style={styles.blurb}>
            A cost somebody has warned you about but nobody has quoted — the engineer, the council.
            It counts towards the forecast and never towards what you&rsquo;ve agreed to.
          </Text>

          <Text style={styles.label}>WHAT IS IT</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            accessibilityLabel="What the cost is for"
          />

          <MoneyField
            label="Roughly how much"
            value={amount}
            onChangeValue={setAmount}
            inclusive={incl}
            onChangeInclusive={setIncl}
          />
          <Text style={styles.hint}>
            Leave it empty if nobody has given you a figure. It&rsquo;ll show as a gap rather than
            disappearing.
          </Text>

          <Text style={styles.label}>PROBABLY FROM</Text>
          <TextInput
            style={styles.input}
            value={likelySupplier}
            onChangeText={setLikelySupplier}
            autoCapitalize="words"
            accessibilityLabel="Who it will probably come from"
          />
          <Text style={styles.hint}>
            A hint, not a supplier — you can&rsquo;t owe money to a guess, so this never reaches
            who&rsquo;s owed what.
          </Text>

          {showElements && elements.length > 0 ? (
            <>
              <Text style={styles.question}>Which part of the job?</Text>
              <View style={styles.chips}>
                <Pressable
                  onPress={() => setElementId(null)}
                  style={styles.chipTap}
                  accessibilityRole="button"
                  accessibilityState={{ selected: elementId === null }}
                  accessibilityLabel="The whole job"
                >
                  <View style={[styles.chip, elementId === null && styles.chipOn]}>
                    <Text style={[styles.chipLabel, elementId === null && styles.chipLabelOn]}>
                      The whole job
                    </Text>
                  </View>
                </Pressable>
                {elements.map((element) => {
                  const on = elementId === element.id;
                  return (
                    <Pressable
                      key={element.id}
                      onPress={() => setElementId(element.id)}
                      style={styles.chipTap}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={element.name}
                    >
                      <View style={[styles.chip, on && styles.chipOn]}>
                        <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                          {element.name}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
        </ScrollView>

        <Pressable
          onPress={save}
          disabled={!canSave || busy}
          style={[styles.cta, (!canSave || busy) && styles.ctaOff]}
          accessibilityRole="button"
          accessibilityLabel="Add it"
        >
          <Text style={[styles.ctaLabel, (!canSave || busy) && styles.ctaLabelOff]}>
            {busy ? 'Saving…' : 'Add it'}
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
  blurb: { fontSize: Typography.sm, color: Colors.textSecondary, marginBottom: Spacing.sm },
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
  hint: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.xs },
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
  cta: {
    backgroundColor: Colors.primary, borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { fontSize: Typography.base, color: Colors.white, fontWeight: Typography.semibold },
  ctaLabelOff: { color: Colors.textMuted },
});
