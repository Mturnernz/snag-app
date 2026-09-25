import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import Icon from './Icon';
import Sheet from './Sheet';
import MoneyField from './MoneyField';
import DateField from './DateField';
import Attachments from './Attachments';
import ConfirmDialog from './ConfirmDialog';
import KindPill from './KindPill';
import KindSheet, { type KindOption } from './KindSheet';
import RoomSplit, { describeRooms, resolveSplit, splitValueFrom, type RoomSplitValue } from './RoomSplit';
import { Group, Pill, PrimaryButton, RadioRow, Row, Segmented, TextButton, groupedStyles } from './Grouped';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  addPayment, deletePayment, deleteQuote, deleteStoredFiles, formatMoney, payBill,
  setFileTags, setQuoteKind, setQuoteRooms, setQuoteStatus, updateExpectedCost, updateQuote,
} from '../lib/supabase';
import {
  billHosts, billsInside, dayKey, expectedAmountIncl, expectedPaidBy, formatDayFirst, formatExactDate, inclGst,
  isInsideAnotherBill, parseLooseDate,
} from '@snag/supabase-queries';
import type {
  FileTags, Location, ProjectElement, ProjectExpectedCost, ProjectPayment, ProjectQuote, ProjectQuoteLine,
  ProjectQuoteRoom,
} from '../types';

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
  /** The parts of the job, which rooms a price on the whole job can be shared with. */
  elements: ProjectElement[];
  locations: Location[];
  quoteRooms: ProjectQuoteRoom[];
  /** Adds a room to the job, answering with its element id or null. */
  onAddRoom: (name: string) => Promise<string | null>;
  /** What each file on the job has been tagged as. */
  fileTags?: FileTags;
  /** The job's expected payments, so a bill can say which one it paid off. */
  expected?: ProjectExpectedCost[];
}

/** What a price can be said to be. Paperwork is a waiting card's answer, never a price's. */
const PRICE_KIND_OPTIONS: KindOption<'quote' | 'invoice'>[] = [
  { value: 'quote', label: 'Quote', hint: 'A price — it counts once you’ve agreed to it' },
  { value: 'invoice', label: 'Invoice', hint: 'Something you’ve been charged for, and pay' },
];

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
 *
 * **A price on the whole job says which rooms it is for.** The tiles that went
 * on two floors, the builder's contract that covers three rooms: the price
 * stays on the whole job, where every total reads it, and *Rooms* records which
 * rooms and — if anybody knows — how it splits, which is what the room
 * breakdown reads. A price on one room already says so; a claim follows its
 * contract, so it is the contract that is shared.
 *
 * **A bill can be inside another bill.** A plumber's variation made out to the
 * builder is already in the builder's invoice; recorded as its own bill the
 * same money counts twice. *Part of another bill?* points it at the one it is
 * inside (`billed_through_id`), which the views already read as passed
 * through: it leaves Agreed, To pay and the supplier rows, keeps its figure
 * and its paper, and the builder's bill lists it under *Includes*. It says
 * which bill, never merely "ignored" — a figure that stops counting says why.
 *
 * **It says what it is, and can be told otherwise.** The pill above the figure
 * reads *Quote* or *Invoice* and opens the choice between them. The change is
 * `setQuoteKind`'s alone, because it moves money between Agreed and Invoiced:
 * the server refuses the ones that would leave the figures lying — a paid
 * invoice becoming a quote, a contract with progress bills becoming an invoice
 * — and says so in the chooser. Either way it comes back *not agreed yet*.
 */
export default function PriceSheet({
  visible, quote, householdId, quotes, payments, lines, onClose, onChanged,
  onOpenBuildUp, onOpenSchedule, onOpen, elements, locations, quoteRooms, onAddRoom, fileTags, expected = [],
}: Props) {
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [rooming, setRooming] = useState(false);
  const [rooms, setRooms] = useState<RoomSplitValue>({ ids: [], kind: 'even', typed: {} });
  const [roomError, setRoomError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [partAmount, setPartAmount] = useState('');
  const [supplier, setSupplier] = useState('');
  const [detail, setDetail] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [choosingKind, setChoosingKind] = useState(false);

  useEffect(() => {
    if (!visible || !quote) return;
    setEditing(false);
    setPlacing(false);
    setRooming(false);
    setChoosingKind(false);
    setRoomError(null);
    setPaying(false);
    setPartAmount('');
    setSupplier(quote.supplier ?? '');
    setDetail(quote.detail ?? '');
    setInvoiceNo(quote.invoiceNumber ?? '');
    setAmount(quote.amount === null ? '' : String(quote.amount));
    setIncl(quote.amountInclGst);
    setDue(quote.dueOn ? formatDayFirst(quote.dueOn) : '');
  }, [visible, quote?.id]);

  if (!quote) return null;

  const isBill = quote.kind === 'invoice';
  const inside = isInsideAnotherBill(quote);
  const host = inside ? quotes.find((q) => q.id === quote.billedThroughId) ?? null : null;
  const hosts = billHosts(quote, quotes);
  const holds = billsInside(quote, quotes);
  // Only a bill of its own can be put inside another: a claim counts through
  // its contract already, and a price answering a set-aside uses the same link
  // for the builder's contract, which the thing's own sheet decides.
  const canPlace = isBill && quote.againstQuoteId === null && quote.supersedesLineId === null
    && (inside || (hosts.length > 0 && holds.length === 0));
  const mine = payments.filter((p) => p.quoteId === quote.id);
  const unpaid = quote.unpaid ?? 0;
  const contract = quote.againstQuoteId ? quotes.find((q) => q.id === quote.againstQuoteId) ?? null : null;
  const claims = quotes.filter((q) => q.againstQuoteId === quote.id);
  const setAsideCount = lines.filter((l) => l.quoteId === quote.id && l.isAllowance).length;
  const today = dayKey(new Date());
  const overdue = isBill && unpaid > 0 && quote.dueOn !== null && quote.dueOn < today;
  const shareable = quote.projectId !== null && quote.againstQuoteId === null;
  const mineRooms = quoteRooms.filter((r) => r.quoteId === quote.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const roomIds = mineRooms.map((r) => r.elementId);
  const roomAmounts = mineRooms.some((r) => r.amount === null) ? null : mineRooms.map((r) => r.amount);
  const onePart = quote.elementId ? elements.find((e) => e.id === quote.elementId && !e.implicit) ?? null : null;
  // The earmark this bill paid off. Linking is always one press from undone:
  // a wrong match puts the earmark back on *Expected to pay* and nothing else.
  const paidOff = expectedPaidBy(quote.id, expected);
  const paidOffAmount = paidOff ? expectedAmountIncl(paidOff) : null;

  function openRooms() {
    setRooms(splitValueFrom(roomIds, roomAmounts, quote!.amount, 1));
    setRoomError(null);
    setRooming(true);
  }

  function saveRooms() {
    const split = resolveSplit(rooms, quote!.amount, 1);
    if ('error' in split) { setRoomError(split.error); return; }
    run(() => setQuoteRooms(quote!.id, split.ids, split.amounts), 'Saved').then(() => setRooming(false));
  }

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
      ...(isBill ? { dueOn: dueOn ?? null, invoiceNumber: invoiceNo.trim() || null } : {}),
    }), 'Saved').then(() => setEditing(false));
  }

  const hostName = (q: ProjectQuote) => [q.supplier ?? 'No supplier', q.invoiceNumber].filter(Boolean).join(' · ');

  const status = inside ? 'Inside another bill' : !isBill
    ? quote.status === 'accepted' ? 'Agreed' : quote.status === 'declined' ? 'Turned down' : 'Not agreed yet'
    : unpaid <= 0 ? 'Paid'
      : overdue ? `Overdue since ${formatExactDate(quote.dueOn)}`
        : quote.dueOn ? `Due ${formatExactDate(quote.dueOn)}`
          : mine.length > 0 ? 'Part paid' : 'To pay';
  const tone = inside || !isBill ? 'neutral' : unpaid <= 0 ? 'neutral' : overdue ? 'overdue' : 'due';

  const footer = placing
    ? null
    : rooming
    ? <PrimaryButton label="Save" onPress={saveRooms} busy={busy} />
    : editing
    ? <PrimaryButton label="Save" onPress={saveEdit} busy={busy} />
    : isBill && !inside && unpaid > 0 && !paying
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
        visible={visible && !confirmDelete && !choosingKind}
        title={placing ? 'Part of another bill?' : rooming ? 'Rooms' : editing ? 'Edit' : quote.detail ?? (isBill ? 'An invoice' : 'A quote')}
        subtitle={editing ? null : quote.supplier}
        onClose={placing ? () => setPlacing(false) : rooming ? () => setRooming(false) : editing ? () => setEditing(false) : paying ? () => setPaying(false) : onClose}
        closeLabel={placing || rooming || editing || paying ? 'Cancel' : 'Done'}
        footer={footer}
      >
        {placing ? (
          <>
            <Group>
              <RadioRow
                title="No — we pay this one"
                selected={!inside}
                onPress={() => {
                  if (!inside) { setPlacing(false); return; }
                  run(() => updateQuote(quote.id, { billedThroughId: null }), 'Counted on its own').then(() => setPlacing(false));
                }}
              />
            </Group>
            <Text style={styles.heading}>Inside</Text>
            <Group>
              {hosts.map((q) => (
                <RadioRow
                  key={q.id}
                  title={hostName(q)}
                  subtitle={[q.kind === 'invoice' ? 'Invoice' : 'Agreed price', formatMoney(q.amountIncl), q.dated ? formatExactDate(q.dated) : null]
                    .filter(Boolean).join(' · ')}
                  selected={quote.billedThroughId === q.id}
                  onPress={() => {
                    if (quote.billedThroughId === q.id) { setPlacing(false); return; }
                    run(() => updateQuote(quote.id, { billedThroughId: q.id }), 'Counted inside that bill').then(() => setPlacing(false));
                  }}
                />
              ))}
            </Group>
          </>
        ) : rooming ? (
          <>
            <RoomSplit
              elements={elements}
              locations={locations}
              value={rooms}
              onChange={setRooms}
              total={quote.amount}
              inclusive={quote.amountInclGst}
              splitFrom={1}
              onAddRoom={onAddRoom}
            />
            {roomError ? <Text style={styles.error} accessibilityLiveRegion="polite">{roomError}</Text> : null}
          </>
        ) : editing ? (
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
                <TextInput style={styles.input} value={invoiceNo} onChangeText={setInvoiceNo} placeholder="Invoice number" placeholderTextColor={Colors.textMuted} accessibilityLabel="Invoice number" autoCapitalize="characters" />
              </View>
            ) : null}
            {isBill ? (
              <View style={styles.field}>
                <DateField label="Due" value={due} onChangeValue={setDue} pickerTitle="When it’s due" />
              </View>
            ) : null}
          </Group>
        ) : (
          <>
            <View style={styles.hero}>
              <KindPill
                label={isBill ? 'Invoice' : 'Quote'}
                onPress={() => setChoosingKind(true)}
                accessibilityLabel={`${isBill ? 'Invoice' : 'Quote'}. Change what it is`}
                style={styles.kind}
              />
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
              {isBill && quote.invoiceNumber ? <Row title="Invoice" value={quote.invoiceNumber} tone="muted" /> : null}
              {isBill && quote.dueOn ? <Row title="Due" value={formatExactDate(quote.dueOn)} tone="muted" /> : null}
              {paidOff ? (
                <Row
                  title={`Pays off ${paidOff.name}`}
                  subtitle={paidOffAmount !== null
                    ? `${formatMoney(paidOffAmount)} expected · off Expected to pay`
                    : 'Off Expected to pay'}
                  accessory={(
                    <Pill
                      label="Undo"
                      disabled={busy}
                      accessibilityLabel={`Put ${paidOff.name} back on Expected to pay`}
                      onPress={() => run(
                        () => updateExpectedCost(paidOff.id, { settledBy: null }),
                        `${paidOff.name} is back on Expected to pay`,
                      )}
                    />
                  )}
                />
              ) : null}
              {canPlace ? (
                <Row
                  title="Part of another bill?"
                  subtitle={host ? `Inside ${hostName(host)} — not counted on its own` : 'No — we pay this one'}
                  onPress={() => setPlacing(true)}
                />
              ) : null}
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
              {onePart ? <Row title="Room" value={onePart.name} tone="muted" /> : null}
              {shareable ? (
                <Row
                  title="Rooms"
                  subtitle={describeRooms(roomIds, roomAmounts, quote.amount, elements)}
                  onPress={openRooms}
                />
              ) : null}
              <Row title="Recorded" value={formatExactDate(dayKey(quote.createdAt))} tone="muted" />
            </Group>

            {holds.length > 0 ? (
              <View style={groupedStyles.block}>
                <Text style={styles.heading}>Includes</Text>
                <Group>
                  {holds.map((inner) => (
                    <Row
                      key={inner.id}
                      title={inner.supplier ?? 'No supplier'}
                      subtitle={inner.invoiceNumber ?? inner.detail}
                      value={formatMoney(inner.amountIncl)}
                      onPress={() => onOpen(inner)}
                    />
                  ))}
                  {quote.amountIncl !== null ? (
                    <Row
                      title="The rest of this bill"
                      value={formatMoney(Math.round((quote.amountIncl - holds.reduce((t, q) => t + (q.amountIncl ?? 0), 0)) * 100) / 100)}
                      tone="muted"
                    />
                  ) : null}
                </Group>
              </View>
            ) : null}

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
                  tags={fileTags}
                  onTag={async (path, tag) => { await run(() => setFileTags([path], tag), tag ? 'Tagged' : 'Tag removed'); }}
                />
              </View>
            </Group>

            <View style={styles.actions}>
              <TextButton label="Edit" onPress={() => setEditing(true)} />
              <TextButton label={isBill ? 'Delete invoice' : 'Delete quote'} tone="danger" onPress={() => setConfirmDelete(true)} />
            </View>
          </>
        )}
      </Sheet>

      <KindSheet<'quote' | 'invoice'>
        visible={visible && choosingKind}
        subtitle={quote.supplier}
        options={PRICE_KIND_OPTIONS}
        value={isBill ? 'invoice' : 'quote'}
        onPick={async (next) => {
          await setQuoteKind(quote.id, next);
          await onChanged(next === 'invoice' ? 'Now an invoice' : 'Now a quote — not agreed yet');
        }}
        onClose={() => setChoosingKind(false)}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title={isBill ? 'Delete this invoice?' : 'Delete this quote?'}
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
  kind: { alignSelf: 'center' },
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
  error: { fontSize: Typography.sm, color: Colors.danger, paddingHorizontal: 4 },
});
