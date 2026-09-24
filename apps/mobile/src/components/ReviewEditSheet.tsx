import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

import Sheet from './Sheet';
import MoneyField from './MoneyField';
import DateField from './DateField';
import { Group, PrimaryButton, RadioRow, groupedStyles } from './Grouped';
import { Colors, Spacing, Typography } from '../constants/theme';
import { formatDayFirst, parseLooseDate, type InvoiceReviewUpdate } from '@snag/supabase-queries';
import type { InvoiceReview, ProjectElement } from '../types';

interface Props {
  review: InvoiceReview | null;
  /** The parts of the job. Only ones somebody has seen are offered — an implicit one is the job. */
  elements: ProjectElement[];
  onClose: () => void;
  onSave: (update: InvoiceReviewUpdate) => Promise<void>;
}

const parseAmount = (text: string): number | null | undefined => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Correcting what was read off an emailed bill, before it counts.
 *
 * **This is the "confirm the way it's uploaded" half of emailing a bill in.**
 * The card shows what the invoice seemed to say, marks what was guessed, and
 * takes a yes or a no; this is where a wrong answer is put right first — who it
 * is from, the figure and whether it includes GST, the numbers and dates, and
 * **which part of the job it lands on**, which nothing reading an email can
 * know. It writes only to the card (`update_invoice_review`): nothing here
 * reaches a total, and allocating is still the card's own button.
 *
 * Every box loads what the card holds and an emptied one clears it, the
 * convention every update in this schema follows. A date or a figure it cannot
 * read holds the sheet open and says which, rather than saving something else.
 */
export default function ReviewEditSheet({ review, elements, onClose, onSave }: Props) {
  const [supplier, setSupplier] = useState('');
  const [detail, setDetail] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [dated, setDated] = useState('');
  const [due, setDue] = useState('');
  const [elementId, setElementId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!review) return;
    setSupplier(review.supplier ?? '');
    setDetail(review.detail ?? '');
    setAmount(review.amount === null ? '' : String(review.amount));
    setIncl(review.amountInclGst);
    setInvoiceNo(review.invoiceNumber ?? '');
    setDated(formatDayFirst(review.dated));
    setDue(formatDayFirst(review.dueOn));
    setElementId(review.elementId);
    setError(null);
    setBusy(false);
  }, [review]);

  const parts = elements.filter((e) => !e.implicit);

  async function save() {
    if (!review || busy) return;
    const figure = parseAmount(amount);
    const datedIso = parseLooseDate(dated);
    const dueIso = parseLooseDate(due);
    if (figure === undefined) { setError('That amount isn’t a figure.'); return; }
    if (datedIso === undefined) { setError('The date on the bill isn’t a day the calendar has.'); return; }
    if (dueIso === undefined) { setError('The due date isn’t a day the calendar has.'); return; }

    setBusy(true);
    setError(null);
    try {
      await onSave({
        supplier: supplier.trim() || null,
        detail: detail.trim() || null,
        amount: figure,
        amountInclGst: incl,
        invoiceNumber: invoiceNo.trim() || null,
        dated: datedIso,
        dueOn: dueIso,
        elementId,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That didn’t save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={review !== null}
      title="Check this bill"
      subtitle={review?.sourceSubject ?? null}
      onClose={onClose}
      footer={<PrimaryButton label="Save" onPress={save} busy={busy} />}
    >
      <Group>
        <View style={styles.field}>
          <TextInput
            style={styles.input}
            value={supplier}
            onChangeText={setSupplier}
            placeholder="Who it’s from"
            placeholderTextColor={Colors.textMuted}
            accessibilityLabel="Who it’s from"
          />
        </View>
        <View style={styles.field}>
          <TextInput
            style={styles.input}
            value={detail}
            onChangeText={setDetail}
            placeholder="What it’s for"
            placeholderTextColor={Colors.textMuted}
            accessibilityLabel="What it’s for"
          />
        </View>
      </Group>

      <MoneyField label="Amount" value={amount} onChangeValue={setAmount} inclusive={incl} onChangeInclusive={setIncl} />

      <Group>
        <View style={styles.field}>
          <TextInput
            style={styles.input}
            value={invoiceNo}
            onChangeText={setInvoiceNo}
            placeholder="Invoice number"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters"
            accessibilityLabel="Invoice number"
          />
        </View>
        <View style={styles.field}>
          <DateField label="Dated" value={dated} onChangeValue={setDated} pickerTitle="The date on the bill" />
        </View>
        <View style={styles.field}>
          <DateField label="Due" value={due} onChangeValue={setDue} pickerTitle="When it’s due" />
        </View>
      </Group>

      {parts.length > 0 ? (
        <View style={groupedStyles.block}>
          <Text style={groupedStyles.question}>Which part of the job?</Text>
          <Group>
            <RadioRow title="The whole job" selected={elementId === null} onPress={() => setElementId(null)} />
            {parts.map((part) => (
              <RadioRow
                key={part.id}
                title={part.name}
                selected={elementId === part.id}
                onPress={() => setElementId(part.id)}
              />
            ))}
          </Group>
        </View>
      ) : null}

      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm + 2 },
  input: { fontSize: Typography.body, color: Colors.textPrimary, minHeight: 32 },
  error: { fontSize: Typography.sm, color: Colors.danger, paddingHorizontal: 4 },
});
