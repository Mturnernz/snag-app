import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

import Sheet from './Sheet';
import MoneyField from './MoneyField';
import DateField from './DateField';
import RoomSplit, { resolveSplit, splitValueFrom, type RoomSplitValue } from './RoomSplit';
import { Group, PrimaryButton, Segmented, groupedStyles } from './Grouped';
import { Colors, Spacing, Typography } from '../constants/theme';
import { formatDayFirst, parseLooseDate, type InvoiceReviewUpdate } from '@snag/supabase-queries';
import type { InvoiceReview, InvoiceReviewKind, Location, ProjectElement } from '../types';

const KINDS: { value: InvoiceReviewKind; label: string }[] = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'quote', label: 'Quote' },
  { value: 'paperwork', label: 'Paperwork' },
];

/** Where the bill will land: no rooms is the whole job, one is that room, more is shared. */
export interface ReviewRooms {
  ids: string[];
  /** Each room's share in the bill's own GST basis, or null for not split. */
  amounts: number[] | null;
}

interface Props {
  review: InvoiceReview | null;
  /** The parts of the job. Only ones somebody has seen are offered — an implicit one is the job. */
  elements: ProjectElement[];
  /** The house's rooms, offered when adding one to the job from here. */
  locations: Location[];
  /** Adds a room to the job, answering with its element id or null. */
  onAddRoom: (name: string) => Promise<string | null>;
  onClose: () => void;
  onSave: (update: InvoiceReviewUpdate, rooms: ReviewRooms) => Promise<void>;
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
 * know. It writes only to the card (`update_invoice_review` and
 * `set_invoice_review_rooms`): nothing here reaches a total, and allocating is
 * still the card's own button.
 *
 * **Rooms are ticked, not chosen.** Tiles for the bathroom floor and the
 * laundry splashback are one bill for two rooms, and a single choice made that
 * either a lie about one of them or a bill on the whole job saying nothing.
 * One room puts the bill on that room, as it always did; two or more keep it on
 * the whole job and say how it splits — see `RoomSplit`. The split is worked
 * out against the figure in the box as it is saved, so correcting the amount
 * and the rooms together cannot leave them disagreeing.
 *
 * **What kind of paper it is comes first**, because it decides what the rest
 * means. An invoice is allocated as a bill; a quote as a price nobody has
 * agreed; paperwork — a certificate, a photo, a subcontractor's bill made out to
 * the builder — is filed and moves no figure, so it is not asked when it is due
 * or which rooms it splits between. The reader of an email can only guess
 * which one it is; the person holding the paper knows.
 *
 * Every box loads what the card holds and an emptied one clears it, the
 * convention every update in this schema follows. A date or a figure it cannot
 * read holds the sheet open and says which, rather than saving something else.
 */
export default function ReviewEditSheet({ review, elements, locations, onAddRoom, onClose, onSave }: Props) {
  const [kind, setKind] = useState<InvoiceReviewKind>('invoice');
  const [supplier, setSupplier] = useState('');
  const [detail, setDetail] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [dated, setDated] = useState('');
  const [due, setDue] = useState('');
  const [rooms, setRooms] = useState<RoomSplitValue>({ ids: [], kind: 'even', typed: {} });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!review) return;
    setKind(review.kind);
    setSupplier(review.supplier ?? '');
    setDetail(review.detail ?? '');
    setAmount(review.amount === null ? '' : String(review.amount));
    setIncl(review.amountInclGst);
    setInvoiceNo(review.invoiceNumber ?? '');
    setDated(formatDayFirst(review.dated));
    setDue(formatDayFirst(review.dueOn));
    const ids = review.roomIds.length > 0 ? review.roomIds : review.elementId ? [review.elementId] : [];
    setRooms(splitValueFrom(ids, review.roomIds.length > 0 ? review.roomAmounts : null, review.amount, 2));
    setError(null);
    setBusy(false);
  }, [review]);

  async function save() {
    if (!review || busy) return;
    const figure = parseAmount(amount);
    const datedIso = parseLooseDate(dated);
    const dueIso = parseLooseDate(due);
    if (figure === undefined) { setError('That amount isn’t a figure.'); return; }
    if (datedIso === undefined) { setError('The date on the bill isn’t a day the calendar has.'); return; }
    if (dueIso === undefined) { setError('The due date isn’t a day the calendar has.'); return; }
    const paperwork = kind === 'paperwork';
    // Paperwork is filed on one level when it is filed, so it carries no split.
    const split = paperwork ? { ids: [], amounts: null } : resolveSplit(rooms, figure, 2);
    if ('error' in split) { setError(split.error); return; }

    setBusy(true);
    setError(null);
    try {
      await onSave({
        kind,
        supplier: supplier.trim() || null,
        detail: detail.trim() || null,
        amount: figure,
        amountInclGst: incl,
        invoiceNumber: invoiceNo.trim() || null,
        dated: datedIso,
        dueOn: kind === 'invoice' ? dueIso : null,
      }, split);
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
      title={kind === 'paperwork' ? 'Check this paperwork' : kind === 'quote' ? 'Check this quote' : 'Check this bill'}
      subtitle={review?.sourceSubject ?? null}
      onClose={onClose}
      footer={<PrimaryButton label="Save" onPress={save} busy={busy} />}
    >
      <Text style={groupedStyles.question}>What is it?</Text>
      <Segmented<InvoiceReviewKind>
        options={KINDS}
        value={kind}
        onChange={setKind}
        accessibilityLabel="What kind of paper this is"
      />
      {kind === 'paperwork' ? (
        <Text style={groupedStyles.hint}>Filed on the job — it doesn’t count towards any figure.</Text>
      ) : null}

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
            placeholder={kind === 'quote' ? 'Quote number' : kind === 'paperwork' ? 'Number on it' : 'Invoice number'}
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters"
            accessibilityLabel={kind === 'quote' ? 'Quote number' : kind === 'paperwork' ? 'Number on it' : 'Invoice number'}
          />
        </View>
        <View style={styles.field}>
          <DateField label="Dated" value={dated} onChangeValue={setDated} pickerTitle="The date on the bill" />
        </View>
        {kind === 'invoice' ? (
          <View style={styles.field}>
            <DateField label="Due" value={due} onChangeValue={setDue} pickerTitle="When it’s due" />
          </View>
        ) : null}
      </Group>

      {kind !== 'paperwork' ? (
        <RoomSplit
          elements={elements}
          locations={locations}
          value={rooms}
          onChange={setRooms}
          total={parseAmount(amount) ?? null}
          inclusive={incl}
          splitFrom={2}
          onAddRoom={onAddRoom}
        />
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
