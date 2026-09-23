import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import Icon from './Icon';
import Sheet from './Sheet';
import MoneyField from './MoneyField';
import DateField from './DateField';
import Attachments from './Attachments';
import ConfirmDialog from './ConfirmDialog';
import { Group, PrimaryButton, Row, Segmented, TextButton, groupedStyles } from './Grouped';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  addPayment, deletePayment, deleteQuote, deleteStoredFiles, formatMoney, payBill,
  setQuoteStatus, updateQuote,
} from '../lib/supabase';
import { dayKey, formatDayFirst, formatExactDate, inclGst, parseLooseDate } from '@snag/supabase-queries';
import type { ProjectPayment, ProjectQuote, ProjectQuoteLine } from '../types';

interface Props {
  visible: boolean;
  quote: ProjectQuote | null;
  householdId: string;
  quotes: ProjectQuote[];
  payments: ProjectPayment[];
  lines: ProjectQuoteLine[];
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
  onOpenBuildUp: (quote: ProjectQuote) => void;
  onOpenSchedule: (quote: ProjectQuote) => void;
  onOpen: (quote: ProjectQuote) => void;
}

const parseAmount = (text: string): number | null => {
  const n = Number(text.replace(/[^0-9.]/g, ''));
  return text.trim().length > 0 && Number.isFinite(n) ? n : null;
};

/**
 * One bill, or one agreed price, and everything that can be done to it.
 *
 * **Every bill opens.** In the old page a bill recorded against the whole job or
 * a part could not be tapped at all — only prices on an item had a sheet — so it
 * could never be paid, corrected or deleted, and *To pay* only ever grew. This is
 * the one sheet for all of them.
 *
 * **Mark as paid writes a payment**, for exactly what is still owing, dated
 * today, the same row a part payment writes. Nothing flips a flag the rollup
 * would then have to trust.
 */
export default function PriceSheet({
  visible, quote, householdId, quotes, payments, lines, onClose, onChanged,
  onOpenBuildUp, onOpenSchedule, onOpen,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [partAmount, setPartAmount] = useState('');
  const [supplier, setSupplier] = useState('');
  const [detail, setDetail] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!visible || !quote) return;
    setEditing(false);
    setPaying(false);
    setPartAmount('');
    setSupplier(quote.supplier ?? '');
    setDetail(quote.detail ?? '');
    setAmount(quote.amount === null ? '' : String(quote.amount));
    setIncl(quote.amountInclGst);
    setDue(quote.dueOn ? formatDayFirst(quote.dueOn) : '');
  }, [visible, quote?.id]);

  if (!quote) return null;

  const isBill = quote.kind === 'invoice';
  const mine = payments.filter((p) => p.quoteId === quote.id);
  const unpaid = quote.unpaid ?? 0;
  const contract = quote.againstQuoteId ? quotes.find((q) => q.id === quote.againstQuoteId) ?? null : null;
  const claims = quotes.filter((q) => q.againstQuoteId === quote.id);
  const setAsideCount = lines.filter((l) => l.quoteId === quote.id && l.isAllowance).length;
  const today = dayKey(new Date());
  const overdue = isBill && unpaid > 0 && quote.dueOn !== null && quote.dueOn < today;

  async function run(work: () => Promise<unknown>, message: string, close = false) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await onChanged(message);
      if (close) onClose();
    } catch (err: unknown) {
      await onChanged(err instanceof Error ? err.message : 'That didn’t save');
    } finally {
      setBusy(false);
    }
  }

  function saveEdit() {
    const money = parseAmount(amount);
    const dueOn = isBill ? parseLooseDate(due) : null;
    if (isBill && due.trim() && dueOn === undefined) {
      onChanged('That date isn’t one a calendar has');
      return;
    }
    run(() => updateQuote(quote!.id, {
      supplier: supplier.trim() || null,
      detail: detail.trim() || null,
      // An emptied amount box is refused rather than clearing a price.
      ...(money !== null ? { amount: money, amountInclGst: incl } : {}),
      ...(isBill ? { dueOn: dueOn ?? null } : {}),
    }), 'Saved').then(() => setEditing(false));
  }

  const status = !isBill
    ? quote.status === 'accepted' ? 'Agreed' : quote.status === 'declined' ? 'Turned down' : 'Not agreed yet'
    : unpaid <= 0 ? 'Paid'
      : overdue ? `Overdue since ${formatExactDate(quote.dueOn)}`
        : quote.dueOn ? `Due ${formatExactDate(quote.dueOn)}`
          : mine.length > 0 ? 'Part paid' : 'To pay';
  const tone = !isBill ? 'neutral' : unpaid <= 0 ? 'neutral' : overdue ? 'overdue' : 'due';

  const footer = editing
    ? <PrimaryButton label="Save" onPress={saveEdit} busy={busy} />
    : isBill && unpaid > 0 && !paying
      ? (
        <>
          <PrimaryButton
            label="Mark as paid"
            accessibilityLabel={`Mark as paid, ${formatMoney(unpaid)}`}
            onPress={() => run(() => payBill(quote.id, unpaid, today), 'Paid')}
            busy={busy}
          />
          <TextButton label="Record a part payment" onPress={() => setPaying(true)} />
        </>
      )
      : paying
        ? (
          <PrimaryButton
            label="Save payment"
            disabled={parseAmount(partAmount) === null}
            busy={busy}
            onPress={() => {
              const money = parseAmount(partAmount);
              if (money === null) return;
              run(() => addPayment(quote.id, { amount: money, amountInclGst: true, paidOn: today }), 'Payment recorded')
                .then(() => setPaying(false));
            }}
          />
        )
        : null;

  return (
    <>
      <Sheet
        visible={visible && !confirmDelete}
        title={editing ? 'Edit' : quote.detail ?? (isBill ? 'A bill' : 'A price')}
        subtitle={editing ? null : quote.supplier}
        onClose={editing ? () => setEditing(false) : paying ? () => setPaying(false) : onClose}
        closeLabel={editing || paying ? 'Cancel' : 'Done'}
        footer={footer}
      >
        {editing ? (
          <Group>
            <View style={styles.field}>
              <TextInput style={styles.input} value={supplier} onChangeText={setSupplier} placeholder="Who it’s from" placeholderTextColor={Colors.textMuted} accessibilityLabel="Who it’s from" />
            </View>
            <View style={styles.field}>
              <TextInput style={styles.input} value={detail} onChangeText={setDetail} placeholder="What it’s for" placeholderTextColor={Colors.textMuted} accessibilityLabel="What it’s for" />
            </View>
            <View style={styles.field}>
              <MoneyField label="Amount" value={amount} onChangeValue={setAmount} inclusive={incl} onChangeInclusive={setIncl} />
            </View>
            {isBill ? (
              <View style={styles.field}>
                <DateField label="Due" value={due} onChangeValue={setDue} pickerTitle="When it’s due" />
              </View>
            ) : null}
          </Group>
        ) : (
          <>
            <View style={styles.hero}>
              <Text style={styles.amount}>{formatMoney(quote.amountIncl) ?? '—'}</Text>
              <View style={[styles.badge, tone === 'overdue' && styles.badgeOverdue, tone === 'due' && styles.badgeDue]}>
                <Text style={[styles.badgeLabel, tone === 'overdue' && styles.badgeLabelOverdue, tone === 'due' && styles.badgeLabelDue]}>
                  {status}
                </Text>
              </View>
            </View>

            {!isBill ? (
              <View style={groupedStyles.block}>
                <Text style={groupedStyles.question}>Have you agreed to go ahead?</Text>
                <Segmented
                  accessibilityLabel="Have you agreed to go ahead?"
                  options={[
                    { value: 'accepted', label: 'Agreed' },
                    { value: 'tbc', label: 'Not yet' },
                    { value: 'declined', label: 'Turned down' },
                  ]}
                  value={quote.status}
                  onChange={(next) => {
                    if (next === quote.status) return;
                    run(() => setQuoteStatus(quote.id, next), next === 'accepted' ? 'Agreed' : next === 'declined' ? 'Turned down' : 'Saved');
                  }}
                />
              </View>
            ) : null}

            <Group>
              {isBill && unpaid > 0 && mine.length > 0 ? <Row title="Still to pay" value={formatMoney(unpaid)} bold /> : null}
              {isBill && quote.dueOn ? <Row title="Due" value={formatExactDate(quote.dueOn)} tone="muted" /> : null}
              {contract ? (
                <Row title="Part of" value={contract.detail ?? 'Agreed price'} tone="muted" onPress={() => onOpen(contract)} />
              ) : null}
              {!isBill && quote.status === 'accepted' ? (
                <Row title="Billed so far" value={formatMoney(quote.claimedTotal ?? 0)} />
              ) : null}
              {!isBill && quote.status === 'accepted' ? (
                <Row
                  title="Left to bill"
                  value={formatMoney(Math.max((quote.amountIncl ?? 0) - (quote.claimedTotal ?? 0), 0))}
                />
              ) : null}
              {!isBill && quote.status === 'accepted' ? (
                <Row
                  title="Set aside for things you’ll choose"
                  value={setAsideCount ? String(setAsideCount) : 'None'}
                  tone="muted"
                  onPress={() => onOpenBuildUp(quote)}
                />
              ) : null}
              {!isBill && quote.status === 'accepted' ? (
                <Row title="Payment schedule" onPress={() => onOpenSchedule(quote)} />
              ) : null}
              <Row title="Recorded" value={formatExactDate(dayKey(quote.createdAt))} tone="muted" />
            </Group>

            {claims.length > 0 ? (
              <View style={groupedStyles.block}>
                <Text style={styles.heading}>Progress bills</Text>
                <Group>
                  {claims.map((claim) => (
                    <Row
                      key={claim.id}
                      title={claim.detail ?? 'Progress bill'}
                      subtitle={(claim.unpaid ?? 0) > 0 ? 'To pay' : 'Paid'}
                      value={formatMoney(claim.amountIncl)}
                      onPress={() => onOpen(claim)}
                    />
                  ))}
                </Group>
              </View>
            ) : null}

            {isBill && mine.length > 0 ? (
              <View style={groupedStyles.block}>
                <Text style={styles.heading}>Payments</Text>
                <Group>
                  {mine.map((payment) => (
                    <Row
                      key={payment.id}
                      title={payment.paidOn ? formatExactDate(payment.paidOn) : 'Payment'}
                      subtitle={payment.reference}
                      value={formatMoney(inclGst(payment.amount, payment.amountInclGst))}
                      accessory={(
                        <Pressable
                          onPress={() => run(() => deletePayment(payment.id), 'Payment removed')}
                          style={styles.remove}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove the ${formatMoney(inclGst(payment.amount, payment.amountInclGst))} payment`}
                        >
                          <Icon name="close" size={18} color={Colors.textMuted} />
                        </Pressable>
                      )}
                    />
                  ))}
                </Group>
              </View>
            ) : null}

            {paying ? (
              <Group>
                <View style={styles.field}>
                  <MoneyField label="Amount paid" value={partAmount} onChangeValue={setPartAmount} inclusive onChangeInclusive={() => {}} autoFocus />
                </View>
              </Group>
            ) : null}

            <Group>
              <View style={styles.field}>
                <Attachments
                  householdId={householdId}
                  photoPaths={quote.photoPaths}
                  documentPaths={quote.documentPaths}
                  onChange={async (next, toast) => { await run(() => updateQuote(quote.id, next), toast); }}
                />
              </View>
            </Group>

            <View style={styles.actions}>
              <TextButton label="Edit" onPress={() => setEditing(true)} />
              <TextButton label={isBill ? 'Delete bill' : 'Delete'} tone="danger" onPress={() => setConfirmDelete(true)} />
            </View>
          </>
        )}
      </Sheet>

      <ConfirmDialog
        visible={confirmDelete}
        title={isBill ? 'Delete this bill?' : 'Delete this price?'}
        message={mine.length > 0 ? `${mine.length === 1 ? 'Its payment goes' : `Its ${mine.length} payments go`} with it.` : undefined}
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          run(async () => {
            const paths = await deleteQuote(quote.id);
            await deleteStoredFiles(paths);
          }, 'Deleted', true);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  amount: {
    fontSize: 44, lineHeight: 52, fontWeight: Typography.bold, color: Colors.textPrimary,
    letterSpacing: -1, fontVariant: ['tabular-nums'],
  },
  badge: { height: 26, paddingHorizontal: 10, borderRadius: 13, justifyContent: 'center', backgroundColor: Colors.sunken },
  badgeDue: { backgroundColor: Colors.due.soonBg },
  badgeOverdue: { backgroundColor: Colors.due.overdueBg },
  badgeLabel: { fontSize: Typography.footnote, fontWeight: Typography.semibold, color: Colors.textSecondary },
  badgeLabelDue: { color: Colors.due.soonFg },
  badgeLabelOverdue: { color: Colors.due.overdueFg },
  heading: {
    fontSize: Typography.title3, fontWeight: Typography.semibold, color: Colors.textPrimary,
    letterSpacing: -0.3, paddingHorizontal: 4,
  },
  field: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm + 2 },
  input: { fontSize: Typography.body, color: Colors.textPrimary, minHeight: 32 },
  remove: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
});
