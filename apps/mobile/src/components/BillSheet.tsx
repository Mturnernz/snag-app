import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';

import Sheet from './Sheet';
import Attachments from './Attachments';
import ConfirmDialog from './ConfirmDialog';
import { Group, PrimaryButton, RadioRow, Row, TextButton } from './Grouped';
import { Colors, Spacing, Typography } from '../constants/theme';
import {
  asksWhenPaid, billOutstanding, dayKey, formatExactDate, formatMoney, paidDayChoices,
} from '@snag/supabase-queries';
import type { ProjectQuote } from '../types';

interface Props {
  /** Null keeps the sheet shut. */
  price: ProjectQuote | null;
  householdId: string;
  /** The project's own status: a planned job's quotes can be accepted. */
  onAccept: (price: ProjectQuote) => Promise<void>;
  onPay: (price: ProjectQuote, paidOn: string) => Promise<void>;
  onFiles: (price: ProjectQuote, next: { photoPaths?: string[]; documentPaths?: string[] }, toast: string) => Promise<void>;
  onDelete: (price: ProjectQuote) => Promise<void>;
  onClose: () => void;
}

/**
 * One quote or invoice: what it says, its paper, and the one or two things
 * that can be done to it — pay it, accept it, delete it.
 *
 * **Mark as paid** pays what is owing in one payment. A bill past its date
 * asks which day it went (`asksWhenPaid`), so a tidy-up months later does not
 * date every payment today.
 */
export default function BillSheet({ price, householdId, onAccept, onPay, onFiles, onDelete, onClose }: Props) {
  const [asking, setAsking] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setAsking(false);
    setDay(null);
    setConfirmDelete(false);
  }, [price?.id]);

  if (!price) return null;
  const isBill = price.kind !== 'quote';
  const owing = billOutstanding(price);
  const today = dayKey(new Date());
  const money = (n: number | null) => (n === null ? '—' : formatMoney(n) ?? '—');
  const title = isBill
    ? price.invoiceNumber ? `Invoice ${price.invoiceNumber}` : 'Invoice'
    : price.invoiceNumber ? `Quote ${price.invoiceNumber}` : 'Quote';

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  function pay() {
    if (!price) return;
    if (!asking && asksWhenPaid(price, today)) {
      setAsking(true);
      setDay(paidDayChoices(price, today)[0].day);
      return;
    }
    run(() => onPay(price, day ?? today));
  }

  const status = isBill
    ? price.billedThroughId ? 'Included in another invoice'
      : owing > 0.005 ? `${money(owing)} owing` : 'Paid'
    : price.status === 'accepted' ? 'Accepted' : price.status === 'declined' ? 'Turned down' : 'Not accepted';

  const footer = isBill && owing > 0.005 && !price.billedThroughId ? (
    <PrimaryButton label={asking ? 'Paid on this day' : 'Mark as paid'} onPress={pay} busy={busy} />
  ) : !isBill && price.status === 'tbc' ? (
    <PrimaryButton label="Accept this quote" onPress={() => run(() => onAccept(price))} busy={busy} />
  ) : undefined;

  return (
    <Sheet visible title={title} subtitle={price.supplier} onClose={onClose} closeLabel="Done" footer={footer}>
      <Group>
        <Row title="Amount" value={money(price.amountIncl)} bold />
        <Row title={isBill ? 'Status' : 'Decision'} value={status} tone={isBill && owing > 0.005 ? 'danger' : 'default'} />
        {price.dated ? <Row title="Dated" value={formatExactDate(price.dated)} /> : null}
        {price.dueOn ? <Row title="Due" value={formatExactDate(price.dueOn)} /> : null}
        {price.detail ? <Row title="For" subtitle={price.detail} /> : null}
      </Group>

      {asking ? (
        <View style={styles.block}>
          <Text style={styles.question}>When was it paid?</Text>
          <Group>
            {paidDayChoices(price, today).map((choice) => (
              <RadioRow
                key={choice.day}
                title={choice.key === 'today' ? 'Today' : choice.key === 'due' ? 'On its due date' : 'On its date'}
                subtitle={formatExactDate(choice.day)}
                selected={day === choice.day}
                onPress={() => setDay(choice.day)}
              />
            ))}
          </Group>
        </View>
      ) : null}

      <Attachments
        householdId={householdId}
        photoPaths={price.photoPaths}
        documentPaths={price.documentPaths}
        onChange={(next, toast) => onFiles(price, next, toast)}
        emptyLabel={`Nothing attached to this ${isBill ? 'invoice' : 'quote'}`}
      />

      <View style={styles.delete}>
        <TextButton
          label={isBill ? 'Delete invoice' : 'Delete quote'}
          tone="danger"
          onPress={() => setConfirmDelete(true)}
        />
      </View>

      <ConfirmDialog
        visible={confirmDelete}
        title={isBill ? 'Delete this invoice?' : 'Delete this quote?'}
        message={isBill && (price.paidTotal ?? 0) > 0.005 ? 'Its payments go with it.' : undefined}
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          run(() => onDelete(price));
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.sm },
  question: { fontSize: Typography.body, fontWeight: Typography.semibold, color: Colors.textPrimary, paddingHorizontal: 4 },
  delete: { alignItems: 'flex-start', paddingHorizontal: 4 },
});
