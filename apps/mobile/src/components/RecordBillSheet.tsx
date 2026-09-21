import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import MoneyField from './MoneyField';
import DateField from './DateField';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { parseLooseDate } from '@snag/supabase-queries';
import type { QuoteInput } from '@snag/supabase-queries';
import {
  ProjectElement, ProjectItem, ProjectQuote, ProjectQuoteKind,
} from '../types';

interface Props {
  visible: boolean;
  elements: ProjectElement[];
  items: ProjectItem[];
  /** Commitments a sub's price could be passed through — contracts, mainly. */
  contracts: ProjectQuote[];
  projectId: string;
  /** Whether the element layer is drawn. An implicit part is never offered by name. */
  showElements: boolean;
  onSave: (input: QuoteInput) => Promise<void>;
  onClose: () => void;
}

type Level = 'project' | 'element' | 'item';

/**
 * A bill arrived. Where does it go?
 *
 * **The most frequent thing anybody does on a live job, and it used to be the
 * deepest buried.** Recording the engineer's third invoice meant Projects →
 * project → expand the part → tap the item → the item sheet → *Add a price* →
 * flip the kind chip to Invoice: six levels, and only if a scope item already
 * existed to hang it on. That is why the live renovation grew a part called
 * "Whole job" holding five supplier accounts wearing items' clothes.
 *
 * So this is the one filled button on the project page, and it asks four things
 * in the order somebody holding a piece of paper can answer them: **what kind of
 * paper, who from, how much, and what it is against.**
 *
 * **It never creates scope.** An invoice maps to something that already exists
 * or it is a cost against the job as a whole — it does not get to invent a part.
 * That is the rule the whole redesign turns on: invoices describe money, and
 * scope is described somewhere else by somebody deciding what the job is.
 *
 * **A bill asks when it has to be paid, and a quote does not.** The due date is
 * the only fact here that is about today rather than about a position, and it is
 * the one the schema had no column for.
 */
export default function RecordBillSheet({
  visible, elements, items, contracts, projectId, showElements, onSave, onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [kind, setKind] = useState<ProjectQuoteKind>('invoice');
  const [supplier, setSupplier] = useState('');
  const [detail, setDetail] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [dated, setDated] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [level, setLevel] = useState<Level>('project');
  const [elementId, setElementId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [billedThrough, setBilledThrough] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setKind('invoice');
    setSupplier('');
    setDetail('');
    setAmount('');
    setIncl(true);
    setDated('');
    setDueOn('');
    setLevel('project');
    setElementId(null);
    setItemId(null);
    setBilledThrough(null);
  }, [visible]);

  /** Parts worth naming. An implicit one has no name anybody chose. */
  const namedElements = useMemo(
    () => (showElements ? elements : []),
    [elements, showElements]
  );

  const itemsToOffer = useMemo(() => {
    const byElement = elementId ? items.filter((i) => i.elementId === elementId) : items;
    return byElement;
  }, [items, elementId]);

  const canSave =
    amount.trim().length > 0 &&
    (level !== 'element' || elementId !== null) &&
    (level !== 'item' || itemId !== null);

  async function save() {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      const parsed = Number(amount.replace(/[^0-9.]/g, ''));
      await onSave({
        projectId: level === 'project' ? projectId : null,
        elementId: level === 'element' ? elementId : null,
        itemId: level === 'item' ? itemId : null,
        supplier: supplier.trim() || null,
        detail: detail.trim() || null,
        amount: Number.isFinite(parsed) ? parsed : null,
        amountInclGst: incl,
        kind,
        // A bill is a fact, so it lands accepted. A quote is a decision nobody
        // has taken yet, and saying otherwise here would be the sheet deciding
        // for them — accepting stays on its own control, where it can clear a
        // sibling.
        status: kind === 'invoice' ? 'accepted' : 'tbc',
        dated: parseLooseDate(dated) ?? null,
        dueOn: kind === 'invoice' ? parseLooseDate(dueOn) ?? null : null,
        billedThroughId: billedThrough,
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
          <Text style={styles.title}>Record a bill or a quote</Text>
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
          {/* What kind of paper. Two named halves rather than one chip that
              toggles, for the reason the GST pill is two: an unlabelled absence
              of a press is not an answer somebody gave. */}
          <Text style={styles.question}>What have you got?</Text>
          <View style={styles.chips}>
            {([
              ['invoice', 'A bill'],
              ['quote', 'A quote'],
            ] as [ProjectQuoteKind, string][]).map(([option, label]) => {
              const on = kind === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setKind(option)}
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

          <Text style={styles.label}>WHO FROM</Text>
          <TextInput
            style={styles.input}
            value={supplier}
            onChangeText={setSupplier}
            autoCapitalize="words"
            accessibilityLabel="Who it is from"
          />

          <Text style={styles.label}>REFERENCE</Text>
          <TextInput
            style={styles.input}
            value={detail}
            onChangeText={setDetail}
            accessibilityLabel="Reference"
          />

          <MoneyField
            label="How much"
            value={amount}
            onChangeValue={setAmount}
            inclusive={incl}
            onChangeInclusive={setIncl}
          />

          <DateField label="Dated" value={dated} onChangeValue={setDated} />

          {/* Only a bill has to be paid by a date. A quote's date is when it was
              written, which `dated` already holds. */}
          {kind === 'invoice' ? (
            <DateField
              label="Due"
              value={dueOn}
              onChangeValue={setDueOn}
              placeholder="No date — that’s fine"
            />
          ) : null}

          {/* What it is against. Never a naming box: an invoice maps to scope
              that exists, or it is a cost against the whole job. It does not get
              to invent a part. */}
          <Text style={styles.question}>What&rsquo;s it against?</Text>
          <View style={styles.chips}>
            {([
              ['project', 'The whole job'],
              ...(namedElements.length > 0 ? [['element', 'A part of it'] as [Level, string]] : []),
              ...(items.length > 0 ? [['item', 'One item'] as [Level, string]] : []),
            ] as [Level, string][]).map(([option, label]) => {
              const on = level === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => {
                    setLevel(option);
                    if (option !== 'item') setItemId(null);
                    if (option === 'project') setElementId(null);
                  }}
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

          {level === 'element' ? (
            <View style={styles.chips}>
              {namedElements.map((element) => {
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
          ) : null}

          {level === 'item' ? (
            <View style={styles.chips}>
              {itemsToOffer.map((item) => {
                const on = itemId === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setItemId(item.id)}
                    style={styles.chipTap}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={item.name}
                  >
                    <View style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{item.name}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* Who is actually billing us. Offered only where a contract exists to
              be passed through, and defaulted to nobody — the ordinary case is
              that a supplier invoices the household direct. The total is the
              same either way; what changes is who is owed. */}
          {contracts.length > 0 ? (
            <>
              <Text style={styles.question}>Who&rsquo;s billing you?</Text>
              <View style={styles.chips}>
                <Pressable
                  onPress={() => setBilledThrough(null)}
                  style={styles.chipTap}
                  accessibilityRole="button"
                  accessibilityState={{ selected: billedThrough === null }}
                  accessibilityLabel="They bill us direct"
                >
                  <View style={[styles.chip, billedThrough === null && styles.chipOn]}>
                    <Text
                      style={[styles.chipLabel, billedThrough === null && styles.chipLabelOn]}
                    >
                      They bill us direct
                    </Text>
                  </View>
                </Pressable>
                {contracts.map((contract) => {
                  const on = billedThrough === contract.id;
                  return (
                    <Pressable
                      key={contract.id}
                      onPress={() => setBilledThrough(contract.id)}
                      style={styles.chipTap}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Through ${contract.supplier ?? 'the contract'}`}
                    >
                      <View style={[styles.chip, on && styles.chipOn]}>
                        <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                          Through {contract.supplier ?? 'the contract'}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>
                Passed through a contract, it&rsquo;s owed to whoever holds that contract — not to
                this supplier.
              </Text>
            </>
          ) : null}
        </ScrollView>

        <Pressable
          onPress={save}
          disabled={!canSave || busy}
          style={[styles.cta, (!canSave || busy) && styles.ctaOff]}
          accessibilityRole="button"
          accessibilityLabel="Save it"
        >
          <Text style={[styles.ctaLabel, (!canSave || busy) && styles.ctaLabelOff]}>
            {busy ? 'Saving…' : 'Save it'}
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
  question: {
    fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary,
    marginTop: Spacing.lg, marginBottom: Spacing.sm,
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
  cta: {
    backgroundColor: Colors.primary, borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.lg,
  },
  // A disabled filled button goes neutral rather than faded: fern at half
  // strength is a pale sage that reads as broken, and white on it fails contrast.
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: {
    fontSize: Typography.base, color: Colors.white, fontWeight: Typography.semibold,
  },
  ctaLabelOff: { color: Colors.textMuted },
});
