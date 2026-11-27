import React, { useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text, TextInput } from './Text';

import Sheet from './Sheet';
import MoneyField from './MoneyField';
import DateField from './DateField';
import { PrimaryButton, Segmented } from './Grouped';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  billsOnJob, describeDuplicate, findDuplicateBill, inclGst, parseLooseDate, supplierKeyOf,
} from '@snag/supabase-queries';
import type { ProjectQuote } from '../types';

export interface NewPrice {
  kind: 'quote' | 'invoice';
  supplier: string;
  amount: number;
  amountInclGst: boolean;
  invoiceNumber: string | null;
  dated: string | null;
  /** An invoice that has already gone out of the bank. */
  paid: boolean;
}

interface Props {
  visible: boolean;
  /** Which way the sheet opens: a planned job is mostly quotes. */
  defaultKind: 'quote' | 'invoice';
  /** Filled in when it was opened from a supplier's page. */
  defaultSupplier?: string | null;
  /** Every price on the job, for the supplier suggestions and the duplicate warning. */
  prices: ProjectQuote[];
  /** Extra names from the rest of the household's jobs. */
  knownSuppliers?: string[];
  onSave: (price: NewPrice) => Promise<void>;
  onClose: () => void;
}

/**
 * Add a quote or an invoice — one screen, the paper in your hand.
 *
 * Who it is from, how much (with the GST pill every money box carries), its
 * number and its date. An invoice can say it is already paid. Nothing else is
 * asked: no part of the job, no rooms, no claims — the November 2026 reset.
 *
 * A bill that looks like one already on the job is said, never refused
 * (`findDuplicateBill`): the button then reads *Save anyway*.
 */
export default function AddPriceSheet({
  visible, defaultKind, defaultSupplier, prices, knownSuppliers = [], onSave, onClose,
}: Props) {
  const [kind, setKind] = useState<'quote' | 'invoice'>(defaultKind);
  const [supplier, setSupplier] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [number, setNumber] = useState('');
  const [date, setDate] = useState('');
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setKind(defaultKind);
    setSupplier(defaultSupplier ?? '');
    setAmount('');
    setIncl(true);
    setNumber('');
    setDate('');
    setPaid(false);
    setError(null);
  }, [visible, defaultKind, defaultSupplier]);

  const value = Number(amount.replace(/[^0-9.]/g, ''));
  const hasAmount = amount.trim().length > 0 && Number.isFinite(value) && value > 0;
  const dated = date.trim() ? parseLooseDate(date) ?? null : null;

  // Names this household has used, closest first, while somebody types.
  const suggestions = useMemo(() => {
    const typed = supplier.trim().toLowerCase();
    if (!typed) return [];
    const names = new Map<string, string>();
    for (const n of [...prices.map((p) => p.supplier), ...knownSuppliers]) {
      if (n && n.trim()) names.set(supplierKeyOf(n), n.trim());
    }
    return [...names.values()]
      .filter((n) => n.toLowerCase().includes(typed) && n.toLowerCase() !== typed)
      .slice(0, 4);
  }, [supplier, prices, knownSuppliers]);

  const duplicate = useMemo(() => {
    if (kind !== 'invoice' || !hasAmount) return null;
    const match = findDuplicateBill(billsOnJob(prices), {
      supplier: supplier.trim() || null,
      invoiceNumber: number.trim() || null,
      amountIncl: inclGst(value, incl),
      dated,
    });
    return match ? describeDuplicate(match.match, 'on the job') : null;
  }, [kind, hasAmount, prices, supplier, number, value, incl, dated]);

  async function save() {
    if (!supplier.trim()) { setError('Who is it from?'); return; }
    if (!hasAmount) { setError('How much is it?'); return; }
    if (date.trim() && !dated) { setError("That date isn't one the calendar has"); return; }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        kind,
        supplier: supplier.trim(),
        amount: value,
        amountInclGst: incl,
        invoiceNumber: number.trim() || null,
        dated,
        paid: kind === 'invoice' && paid,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "That didn't save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      title={kind === 'quote' ? 'Add a quote' : 'Add an invoice'}
      onClose={onClose}
      footer={
        <PrimaryButton
          label={duplicate ? 'Save anyway' : 'Save'}
          onPress={save}
          busy={busy}
        />
      }
    >
      <Segmented
        options={[{ value: 'quote', label: 'Quote' }, { value: 'invoice', label: 'Invoice' }]}
        value={kind}
        onChange={setKind}
        accessibilityLabel="Quote or invoice"
      />

      <View style={styles.field}>
        <Text style={styles.label} nativeID="supplier-label">Who from</Text>
        <TextInput
          value={supplier}
          onChangeText={setSupplier}
          style={styles.input}
          accessibilityLabel="Who from"
          autoCapitalize="words"
        />
        {suggestions.length > 0 ? (
          <View style={styles.suggestions}>
            {suggestions.map((name) => (
              <Pressable
                key={name}
                onPress={() => setSupplier(name)}
                style={styles.suggestionTap}
                accessibilityRole="button"
                accessibilityLabel={`Use ${name}`}
              >
                <View style={styles.suggestion}>
                  <Text style={styles.suggestionLabel}>{name}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <MoneyField
        label="Amount"
        value={amount}
        onChangeValue={setAmount}
        inclusive={incl}
        onChangeInclusive={setIncl}
      />

      <View style={styles.field}>
        <Text style={styles.label}>{kind === 'quote' ? 'Quote number' : 'Invoice number'}</Text>
        <TextInput
          value={number}
          onChangeText={setNumber}
          style={styles.input}
          accessibilityLabel={kind === 'quote' ? 'Quote number' : 'Invoice number'}
          autoCapitalize="characters"
        />
      </View>

      <DateField label="Date on it" value={date} onChangeValue={setDate} />

      {kind === 'invoice' ? (
        <Segmented
          options={[{ value: 'owing', label: 'Still to pay' }, { value: 'paid', label: 'Already paid' }]}
          value={paid ? 'paid' : 'owing'}
          onChange={(v) => setPaid(v === 'paid')}
          accessibilityLabel="Is it paid?"
        />
      ) : null}

      {duplicate ? <Text style={styles.warn}>{duplicate}</Text> : null}
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.xs + 2 },
  label: { fontSize: Typography.subhead, fontWeight: Typography.semibold, color: Colors.textPrimary, paddingHorizontal: 4 },
  input: {
    minHeight: MIN_TOUCH_TARGET, borderRadius: Radius.input, backgroundColor: Colors.sunken,
    paddingHorizontal: Spacing.md, fontSize: Typography.body, color: Colors.textPrimary,
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.sm },
  suggestionTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  suggestion: {
    height: 34, justifyContent: 'center', paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill, backgroundColor: Colors.sunken,
  },
  suggestionLabel: { fontSize: Typography.subhead, color: Colors.textPrimary },
  warn: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.status.doingFg, paddingHorizontal: 4 },
  error: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.danger, paddingHorizontal: 4 },
});
