import React, { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text, TextInput } from './Text';

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
  setFileTags, setQuoteClaim, setQuoteKind, setQuoteRooms, setQuoteStatus, updateExpectedCost, updateQuote,
} from '../lib/supabase';
import {
  asksWhenPaid, billHosts, billsInside, claimCandidates, dayKey, expectedAmountIncl, expectedCoveredBy, expectedPaidBy,
  formatDayFirst, formatExactDate, inclGst, isInsideAnotherBill, paidDayChoices, parseLooseDate, priceSaysQuote,
  suggestedClaim,
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
  /** Opened from a *Paid* press: go straight to asking when it was paid. */
  askWhenPaid?: boolean;
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
  onOpen, elements, locations, quoteRooms, onAddRoom, fileTags, expected = [], askWhenPaid = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  /** Choosing what it is part of: a quote it is a stage of, or a bill it sits inside. */
  const [linking, setLinking] = useState(false);
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
  /** Asking "When was it paid?" — the figure being paid, once the press has asked. */
  const [whenPaid, setWhenPaid] = useState<number | null>(null);
  const [paidDay, setPaidDay] = useState<string>('');
  const [otherDay, setOtherDay] = useState('');
  const [partDay, setPartDay] = useState('');
  /** Opened from a *Paid* press: cancelling or saving the date goes back to the page. */
  const [straightToPay, setStraightToPay] = useState(false);
  /** Expected payments from this contract's supplier, offered to the contract once it is agreed. */
  const [folding, setFolding] = useState<ProjectExpectedCost[]>([]);

  useEffect(() => {
    if (!visible || !quote) return;
    setEditing(false);
    setLinking(false);
    setRooming(false);
    setChoosingKind(false);
    setWhenPaid(null);
    setOtherDay('');
    setPartDay('');
    setFolding([]);
    setRoomError(null);
    setPaying(false);
    setPartAmount('');
    setSupplier(quote.supplier ?? '');
    setDetail(quote.detail ?? '');
    setInvoiceNo(quote.invoiceNumber ?? '');
    setAmount(quote.amount === null ? '' : String(quote.amount));
    setIncl(quote.amountInclGst);
    setDue(quote.dueOn ? formatDayFirst(quote.dueOn) : '');
    const straight = askWhenPaid && quote.kind === 'invoice' && (quote.unpaid ?? 0) > 0;
    setStraightToPay(straight);
    if (straight) {
      setPaidDay(paidDayChoices(quote, dayKey(new Date()))[0].day);
      setWhenPaid(quote.unpaid ?? 0);
    }
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
  // Whether this bill is a stage of an agreed price — the link the rollups read,
  // offered when its own words name the quote or a stage of it.
  const candidates = isBill ? claimCandidates(quote, quotes) : [];
  const suggestion = isBill && !quote.againstQuoteId ? suggestedClaim(quote, quotes) : null;
  const canClaim = isBill && !inside && quote.supersedesLineId === null
    && (quote.againstQuoteId !== null || candidates.length > 0);
  const saysQuote = priceSaysQuote(quote);
  const dayChoices = paidDayChoices(quote, today);

  /** Pays what is owing — asking when first if the bill fell due before today. */
  function markPaid() {
    if (asksWhenPaid(quote!, today)) {
      setPaidDay(dayChoices[0].day);
      setOtherDay('');
      setWhenPaid(unpaid);
      return;
    }
    run(() => payBill(quote!.id, unpaid, today), 'Paid');
  }

  function savePaidDay() {
    if (whenPaid === null) return;
    const day = paidDay === 'other' ? parseLooseDate(otherDay) : paidDay;
    if (!day) {
      onChanged(otherDay.trim() ? 'That date isn’t one a calendar has' : 'Say when it was paid');
      return;
    }
    run(() => payBill(quote!.id, whenPaid, day), `Paid · ${formatExactDate(day)}`, straightToPay)
      .then((ok) => { if (ok) setWhenPaid(null); });
  }

  /** Agrees or un-agrees the price; agreeing asks about the business's expected payments. */
  async function setStatus(next: ProjectQuote['status']) {
    const covered = next === 'accepted' ? expectedCoveredBy(quote!, expected) : [];
    const ok = await run(() => setQuoteStatus(quote!.id, next), next === 'accepted' ? 'Agreed' : next === 'declined' ? 'Turned down' : 'Saved');
    if (ok && covered.length > 0) setFolding(covered);
  }

  function foldEarmarks() {
    const list = folding;
    setFolding([]);
    run(async () => {
      for (const x of list) await updateExpectedCost(x.id, { settledBy: quote!.id });
    }, list.length === 1 ? `${list[0].name} is part of this price` : `${list.length} expected payments are part of this price`);
  }

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

  /** Writes, re-reads and says so. True when the write went through. */
  async function run(work: () => Promise<unknown>, message: string, close = false): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      await work();
      await onChanged(message);
      if (close) onClose();
      return true;
    } catch (err: unknown) {
      await onChanged(err instanceof Error ? err.message : 'That didn’t save');
      return false;
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

  const status = inside ? 'Included in another bill' : !isBill
    ? quote.status === 'accepted' ? 'Agreed' : quote.status === 'declined' ? 'Turned down' : 'Not agreed yet'
    : unpaid <= 0 ? 'Paid'
      : overdue ? `Overdue since ${formatExactDate(quote.dueOn)}`
        : quote.dueOn ? `Due ${formatExactDate(quote.dueOn)}`
          : mine.length > 0 ? 'Part paid' : 'To pay';
  const tone = inside || !isBill ? 'neutral' : unpaid <= 0 ? 'neutral' : overdue ? 'overdue' : 'due';

  const footer = linking
    ? null
    : whenPaid !== null
    ? <PrimaryButton label="Save" onPress={savePaidDay} busy={busy} />
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
            onPress={markPaid}
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
              const day = partDay.trim() ? parseLooseDate(partDay) : today;
              if (!day) { onChanged('That date isn’t one a calendar has'); return; }
              run(() => addPayment(quote.id, { amount: money, amountInclGst: true, paidOn: day }), 'Payment recorded')
                .then(() => setPaying(false));
            }}
          />
        )
        : null;

  return (
    <>
      <Sheet
        visible={visible && !confirmDelete && !choosingKind}
        title={linking ? 'Part of' : whenPaid !== null ? 'When was it paid?'
          : rooming ? 'Rooms' : editing ? 'Edit' : quote.detail ?? (isBill ? 'An invoice' : 'A quote')}
        // The number beside who it is from: a row reading "Invoice" under a
        // pill reading "Invoice" said the word twice.
        subtitle={editing ? null : [quote.supplier, quote.invoiceNumber].filter(Boolean).join(' · ') || null}
        onClose={linking ? () => setLinking(false) : whenPaid !== null ? (straightToPay ? onClose : () => setWhenPaid(null))
          : rooming ? () => setRooming(false) : editing ? () => setEditing(false) : paying ? () => setPaying(false) : onClose}
        closeLabel={linking || whenPaid !== null || rooming || editing || paying ? 'Cancel' : 'Done'}
        footer={footer}
      >
        {linking ? (
          <>
            <Group>
              <RadioRow
                title="Uncategorised"
                selected={!inside && !quote.againstQuoteId}
                onPress={() => {
                  if (!inside && !quote.againstQuoteId) { setLinking(false); return; }
                  run(async () => {
                    if (quote.againstQuoteId) await setQuoteClaim(quote.id, null);
                    if (inside) await updateQuote(quote.id, { billedThroughId: null });
                  }, 'Uncategorised').then((ok) => { if (ok) setLinking(false); });
                }}
              />
            </Group>
            {canClaim ? (
              <>
                <Text style={styles.heading}>Stage of</Text>
                <Group>
                  {candidates.map((q) => (
                    <RadioRow
                      key={q.id}
                      title={hostName(q)}
                      accessibilityLabel={`Stage of ${hostName(q)}`}
                      subtitle={[
                        q.status === 'accepted' ? 'Agreed' : 'Not agreed yet',
                        formatMoney(q.amountIncl),
                        suggestion?.contract.id === q.id ? 'Suggested' : null,
                      ].filter(Boolean).join(' · ')}
                      selected={quote.againstQuoteId === q.id}
                      onPress={() => {
                        if (quote.againstQuoteId === q.id) { setLinking(false); return; }
                        run(() => setQuoteClaim(quote.id, q.id), `Stage of ${hostName(q)}`).then((ok) => { if (ok) setLinking(false); });
                      }}
                    />
                  ))}
                </Group>
              </>
            ) : null}
            {canPlace ? (
              <>
                <Text style={styles.heading}>Included in</Text>
                <Group>
                  {hosts.map((q) => (
                    <RadioRow
                      key={q.id}
                      title={hostName(q)}
                      accessibilityLabel={`Included in ${hostName(q)}`}
                      subtitle={[q.kind === 'invoice' ? 'Invoice' : 'Agreed price', formatMoney(q.amountIncl), q.dated ? formatExactDate(q.dated) : null]
                        .filter(Boolean).join(' · ')}
                      selected={quote.billedThroughId === q.id}
                      onPress={() => {
                        if (quote.billedThroughId === q.id) { setLinking(false); return; }
                        run(() => updateQuote(quote.id, { billedThroughId: q.id }), `Included in ${hostName(q)}`).then((ok) => { if (ok) setLinking(false); });
                      }}
                    />
                  ))}
                </Group>
              </>
            ) : null}
          </>
        ) : whenPaid !== null ? (
          <>
            <Text style={groupedStyles.question}>{`${formatMoney(whenPaid)} — when did it go out?`}</Text>
            <Group>
              {dayChoices.map((c) => (
                <RadioRow
                  key={c.key}
                  title={c.key === 'due' ? 'On its due date' : c.key === 'dated' ? 'On the bill’s date' : 'Today'}
                  subtitle={formatExactDate(c.day)}
                  selected={paidDay === c.day}
                  onPress={() => setPaidDay(c.day)}
                />
              ))}
              <RadioRow title="Another day" selected={paidDay === 'other'} onPress={() => setPaidDay('other')} />
            </Group>
            {paidDay === 'other' ? (
              <Group>
                <View style={styles.field}>
                  <DateField label="Paid on" value={otherDay} onChangeValue={setOtherDay} pickerTitle="When it was paid" />
                </View>
              </Group>
            ) : null}
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

            {isBill && saysQuote && mine.length === 0 && !quote.againstQuoteId ? (
              <Group>
                <Row
                  title="Its own words call it a quote"
                  subtitle="A quote counts once it’s agreed. Recorded as an invoice it counts as billed, and as owing."
                  accessory={(
                    <Pill
                      label="Make it a quote"
                      disabled={busy}
                      onPress={() => run(() => setQuoteKind(quote.id, 'quote'), 'Now a quote — not agreed yet')}
                    />
                  )}
                />
              </Group>
            ) : null}

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
                    setStatus(next);
                  }}
                />
              </View>
            ) : null}

            <Group>
              {isBill && unpaid > 0 && mine.length > 0 ? <Row title="Still to pay" value={formatMoney(unpaid)} bold /> : null}
              {isBill && quote.dueOn ? <Row title="Due" value={formatExactDate(quote.dueOn)} tone="muted" /> : null}
              {paidOff ? (
                <Row
                  title={`${isBill ? 'Pays off' : 'Covers'} ${paidOff.name}`}
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
              {/*
                One row for what it is part of, in plain terms: *Stage of* a
                quote, *Included in* another bill, or *Uncategorised*. They were
                two rows reading "No" on nearly every bill, then one row of
                sentences; the one picker behind it offers whichever apply.
              */}
              {canPlace || canClaim ? (
                <Row
                  title="Part of"
                  subtitle={contract
                    ? `Stage of ${hostName(contract)}${contract.status === 'accepted' ? '' : ' · not agreed'}`
                    : host
                      ? `Included in ${hostName(host)}`
                      : suggestion
                        ? `Uncategorised · suggested: ${suggestion.contract.invoiceNumber ?? hostName(suggestion.contract)}`
                        : 'Uncategorised'}
                  onPress={() => setLinking(true)}
                  accessory={suggestion ? (
                    <Pill
                      label="Link"
                      disabled={busy}
                      accessibilityLabel={`Link to ${hostName(suggestion.contract)}`}
                      onPress={() => run(() => setQuoteClaim(quote.id, suggestion.contract.id), `Stage of ${hostName(suggestion.contract)}`)}
                    />
                  ) : undefined}
                />
              ) : null}
              {contract ? (
                <Row title="Open the agreed price" value={contract.detail ?? hostName(contract)} tone="muted" onPress={() => onOpen(contract)} />
              ) : null}
              {!isBill && quote.status === 'accepted' ? (
                <Row
                  title="Billed so far"
                  value={[
                    formatMoney(quote.claimedTotal ?? 0),
                    quote.amountIncl ? `${Math.round(((quote.claimedTotal ?? 0) / quote.amountIncl) * 100)}%` : null,
                  ].filter(Boolean).join(' · ')}
                />
              ) : null}
              {!isBill && quote.status === 'accepted' ? (
                <Row
                  title="Left to bill"
                  value={formatMoney(Math.max((quote.amountIncl ?? 0) - (quote.claimedTotal ?? 0), 0))}
                />
              ) : null}
              {/* What it sets aside is said, never edited here. Breaking a
                  price into lines and a payment schedule went in October 2026
                  (the function review: no line or milestone had ever been
                  written); a set-aside is still made from the + sheet. */}
              {!isBill && quote.status === 'accepted' && setAsideCount ? (
                <Row title="Set aside for things you’ll choose" value={String(setAsideCount)} tone="muted" />
              ) : null}
              {onePart ? <Row title="Room" value={onePart.name} tone="muted" /> : null}
              {shareable ? (
                <Row
                  title="Rooms"
                  subtitle={describeRooms(roomIds, roomAmounts, quote.amount, elements)}
                  onPress={openRooms}
                />
              ) : null}
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
                <View style={styles.field}>
                  <DateField label="Paid on" value={partDay} onChangeValue={setPartDay} pickerTitle="When it was paid" placeholder="Today" />
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
        visible={folding.length > 0}
        title={folding.length === 1 ? `Is ${folding[0].name} part of this price?` : 'Are these part of this price?'}
        message={`${folding.map((x) => [x.name, formatMoney(expectedAmountIncl(x))].filter(Boolean).join(' · ')).join('\n')}\n\nIf the agreed price includes ${folding.length === 1 ? 'it' : 'them'}, ${folding.length === 1 ? 'it comes' : 'they come'} off Expected to pay, so the money isn’t counted twice.`}
        confirmLabel="Yes, it’s included"
        cancelLabel="No, it’s extra"
        onCancel={() => setFolding([])}
        onConfirm={foldEarmarks}
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
