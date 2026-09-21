import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import MoneyField from './MoneyField';
import DateField from './DateField';
import Attachments from './Attachments';
import ConfirmDialog from './ConfirmDialog';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import type { PaymentInput } from '@snag/supabase-queries';
import { formatDayFirst, formatMoney, inclGst, parseLooseDate } from '@snag/supabase-queries';
import {
  ProjectItem, ProjectPayment, ProjectQuote, ProjectQuoteKind, ProjectQuoteStatus,
  PROJECT_QUOTE_STATUS_LABELS,
} from '../types';

interface QuoteFields {
  supplier: string | null;
  detail: string | null;
  amount: number | null;
  amountInclGst: boolean;
}

interface Props {
  visible: boolean;
  householdId: string;
  item: ProjectItem | null;
  /**
   * Set while this is a **new** item nobody has named yet — the part it will
   * go on. `item` is null until the name is committed, and then this is null
   * and the same open sheet carries on against a real row.
   */
  creatingIn: { id: string; name: string } | null;
  /** Whether the part layer is drawn — an implicit part has no name to say. */
  showElement?: boolean;
  /**
   * Names the item and creates it, returning the row so the gesture that
   * triggered it can carry straight on against a real id.
   */
  onCreate: (elementId: string, name: string) => Promise<ProjectItem | null>;
  /** This item's prices. The first one is the one the header operates on. */
  quotes: ProjectQuote[];
  /** Payments against any invoice among `quotes`. */
  payments: ProjectPayment[];
  onClose: () => void;
  onUpdateItem: (itemId: string, update: { name?: string; status?: ProjectItem['status']; notes?: string | null; photoPaths?: string[]; documentPaths?: string[] }, toast: string) => Promise<void>;
  onDeleteItem: () => Promise<void>;
  onAddQuote: (itemId: string, input: QuoteFields) => Promise<void>;
  onSetQuoteStatus: (quoteId: string, status: ProjectQuoteStatus) => Promise<void>;
  /**
   * Corrects a price, or moves it between Quote and Invoiced.
   *
   * Deliberately does **not** carry `status`: accepting stays on
   * `onSetQuoteStatus`, which is its own call precisely so the sibling-clearing
   * can never be skipped by a caller passing it among other fields. A
   * correction is not a decision.
   */
  onUpdateQuote: (quoteId: string, update: Partial<QuoteFields> & { kind?: ProjectQuoteKind }) => Promise<void>;
  onDeleteQuote: (quoteId: string) => Promise<void>;
  onUpdateQuoteFiles: (quoteId: string, next: { photoPaths?: string[]; documentPaths?: string[] }, toast: string) => Promise<void>;
  onAddPayment: (quoteId: string, input: PaymentInput) => Promise<void>;
  onUpdatePayment: (paymentId: string, input: Partial<PaymentInput>) => Promise<void>;
  onDeletePayment: (paymentId: string) => Promise<void>;
  /** Offered once something is in: an item that exists is a thing the house now has. */
  onRecordAsThing?: () => void;
}

/**
 * One item, and the one price that answers "what does it cost".
 *
 * **An item carries a single active price**, not a shortlist to compare.
 * Recording it moves through two questions in order — is it a *Quote* or has
 * it been *Invoiced*, and then the one that follows from that: a quote is
 * *Accepted* or *Declined*, an invoice is *Paid* or *Not paid*. Accepting
 * doesn't finish the job — the next real event is the bill, so an accepted
 * quote reads **Pending invoice** until somebody flips it to Invoiced.
 *
 * **Editing a price shows three fields and nothing else** — who from, what
 * exactly, and the amount. What kind of paper it is and whether it has been
 * paid are decisions, made from the header above the form, never something a
 * half-finished edit can silently carry along.
 *
 * The amount is typed with the GST pill beside it and stored exactly as typed
 * — nothing in this app reads a figure out of an attachment.
 *
 * **Adding an item opens this same sheet, not a smaller one.** There was a
 * second modal in front of it that asked for a name and a note and then shut,
 * leaving somebody to open the item they had just made to do the thing they
 * opened it for — put a price on it. Two screens and four taps for one act, on
 * the page whose whole redesign was about how many presses a bill costs. So
 * the pill opens this, the title is a box, and everything an item can hold is
 * on screen from the first keystroke.
 *
 * **The row is created the moment the name is committed**, and that is the one
 * rule to keep. `create_item` will not take an empty name and says so in
 * words, so a sheet opened by mistake and walked away from writes nothing at
 * all — the same guarantee the old two-step gave. What changed is only *when*
 * it happens: on the blur of the title rather than on a button. Every control
 * below calls `ensureItem` first, because on native a press does not reliably
 * blur a `TextInput`, so typing a name and going straight for the amount is
 * one gesture that has to create the row on its way past.
 */
const emptyPayment = {
  amount: '',
  incl: true,
  reference: '',
  paidOn: '',
  notes: '',
  photoPaths: [] as string[],
  documentPaths: [] as string[],
};

export default function ItemSheet({
  visible, householdId, item, creatingIn, showElement = false, onCreate,
  quotes, payments, onClose,
  onUpdateItem, onDeleteItem, onAddQuote, onSetQuoteStatus, onUpdateQuote, onDeleteQuote,
  onUpdateQuoteFiles, onAddPayment, onUpdatePayment, onDeletePayment, onRecordAsThing,
}: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [adding, setAdding] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [detail, setDetail] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  /** The quote the form is correcting, or null when it is adding the first one. */
  const [editingQuote, setEditingQuote] = useState<string | null>(null);
  /** The payment being written: an id to correct one, 'new' to record one. */
  const [editingPayment, setEditingPayment] = useState<string | 'new' | null>(null);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [clearingPayments, setClearingPayments] = useState(false);
  /** What is in the title box. The item's name, or what is being typed for one. */
  const [title, setTitle] = useState('');
  /** Said under the box rather than as a toast — it is about the box. */
  const [titleMissing, setTitleMissing] = useState(false);

  // The price the header and the edit pencil operate on. Kept to the first
  // one recorded: an item carries a single active price now, so a second
  // never gets created through this sheet, and any extra rows left over from
  // before stay visible below, read-only, rather than disappearing.
  const primaryQuote = quotes[0] ?? null;
  const legacyQuotes = quotes.slice(1);
  const primaryPayments = primaryQuote
    ? payments.filter((payment) => payment.quoteId === primaryQuote.id)
    : [];

  useEffect(() => {
    if (!visible) return;
    setAdding(quotes.length === 0);
    setSupplier('');
    setDetail('');
    setAmount('');
    setIncl(true);
    setNotes(item?.notes ?? '');
    setFilesOpen(false);
    setEditingQuote(null);
    setEditingPayment(null);
    setPaymentForm(emptyPayment);
    setTitle(item?.name ?? '');
    setTitleMissing(false);
  }, [visible, item?.id]);

  // Nothing to show only when there is neither a row nor a part to put one on.
  if (!item && !creatingIn) return null;

  const canSaveQuote = amount.trim().length > 0 || supplier.trim().length > 0;
  const installed = item?.status === 'installed';

  /**
   * The row this sheet is about, creating it first if it does not exist yet.
   *
   * Everything that writes goes through here. On native a press does not
   * reliably blur a `TextInput`, so somebody typing "Toilet" and going
   * straight for the amount never fires the title's own blur — and without
   * this that gesture would write nothing and say nothing, which is the exact
   * failure the snag page's Save button already exists to prevent.
   */
  async function ensureItem(): Promise<ProjectItem | null> {
    if (item) return item;
    if (!creatingIn) return null;
    const named = title.trim();
    if (named.length === 0) {
      setTitleMissing(true);
      return null;
    }
    setTitleMissing(false);
    return onCreate(creatingIn.id, named);
  }

  /** Commits the title box: creates the row, or renames the one that exists. */
  async function commitTitle() {
    const named = title.trim();
    if (!item) {
      if (named.length > 0) await ensureItem();
      return;
    }
    if (named.length === 0) {
      // An item with no name is not something `update_item` should be asked
      // to store — the create path refuses it in words, and so does this, by
      // putting the name back rather than clearing it.
      setTitle(item.name);
      return;
    }
    if (named !== item.name) await onUpdateItem(item.id, { name: named }, 'Renamed');
  }

  /** Loads a saved price back into the form, exactly as it was typed. */
  function editQuote(quote: ProjectQuote) {
    setEditingQuote(quote.id);
    setAdding(false);
    setSupplier(quote.supplier ?? '');
    setDetail(quote.detail ?? '');
    // The figure as entered, not the GST-inclusive one the rollup uses — the
    // pill beside it says which it is, and converting on the way into an edit
    // box would change the number somebody is trying to correct.
    setAmount(quote.amount === null ? '' : String(quote.amount));
    setIncl(quote.amountInclGst);
  }

  function closeForm() {
    setEditingQuote(null);
    setAdding(quotes.length === 0);
    setSupplier('');
    setDetail('');
    setAmount('');
    setIncl(true);
  }

  async function saveQuote() {
    if (busy || !canSaveQuote || !editingQuote) return;
    setBusy(true);
    try {
      const parsed = amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) : NaN;
      await onUpdateQuote(editingQuote, {
        // Empty means clear, which `updateQuote` turns into `p_clear` — an
        // emptied supplier is somebody saying they no longer know, and leaving
        // the old one there would be the box lying about what it holds.
        supplier: supplier.trim() || null,
        detail: detail.trim() || null,
        amount: Number.isFinite(parsed) ? parsed : null,
        amountInclGst: incl,
      });
      closeForm();
    } finally {
      setBusy(false);
    }
  }

  async function addQuote() {
    if (busy || !canSaveQuote) return;
    setBusy(true);
    try {
      // The row first, if there isn't one: a price has to hang off something,
      // and somebody who typed a name and went straight for the amount has
      // plainly told us what this is.
      const target = await ensureItem();
      if (!target) return;
      const parsed = amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) : NaN;
      await onAddQuote(target.id, {
        supplier: supplier.trim() || null,
        detail: detail.trim() || null,
        amount: Number.isFinite(parsed) ? parsed : null,
        amountInclGst: incl,
      });
      setSupplier('');
      setDetail('');
      setAmount('');
      setAdding(false);
    } finally {
      setBusy(false);
    }
  }

  const grossAmount = primaryQuote ? inclGst(primaryQuote.amount, primaryQuote.amountInclGst) : null;
  const isPaid = primaryQuote !== null
    && primaryQuote.kind === 'invoice'
    && primaryQuote.unpaid !== null
    && primaryQuote.unpaid <= 0.005;

  async function markPaid() {
    if (!primaryQuote || busy || isPaid) return;
    const outstanding = primaryQuote.unpaid ?? grossAmount;
    if (outstanding === null || outstanding <= 0) return;
    setBusy(true);
    try {
      await onAddPayment(primaryQuote.id, { amount: outstanding, amountInclGst: true });
    } finally {
      setBusy(false);
    }
  }

  /**
   * *Not paid* still clears the payments, and now it can be asked first.
   *
   * It exists for the one-tap *Paid* it undoes, where the row it removes is a
   * figure and nothing else. A payment somebody typed carries an invoice
   * number, a date and often the bill itself, and none of that comes back —
   * so a row with any of that on it is named before it goes, and a bare one
   * is not, which is the same gate a part of the job already takes.
   */
  const paymentsHoldSomething = primaryPayments.some(
    (payment) =>
      payment.reference !== null
      || payment.notes !== null
      || payment.paidOn !== null
      || payment.photoPaths.length > 0
      || payment.documentPaths.length > 0
  );

  async function clearPayments() {
    if (!primaryQuote || busy || primaryPayments.length === 0) return;
    setBusy(true);
    try {
      for (const payment of primaryPayments) {
        // eslint-disable-next-line no-await-in-loop
        await onDeletePayment(payment.id);
      }
    } finally {
      setBusy(false);
    }
  }

  function markNotPaid() {
    if (!primaryQuote || busy || primaryPayments.length === 0) return;
    if (paymentsHoldSomething) {
      setClearingPayments(true);
      return;
    }
    void clearPayments();
  }

  function startPayment() {
    setEditingPayment('new');
    setPaymentForm(emptyPayment);
  }

  function editPayment(payment: ProjectPayment) {
    setEditingPayment(payment.id);
    setPaymentForm({
      // As typed, not the GST-inclusive figure the rollup works in: loading the
      // normalised one would raise an ex-GST payment by 15% every time somebody
      // opened it to fix the invoice number.
      amount: String(payment.amount),
      incl: payment.amountInclGst,
      reference: payment.reference ?? '',
      paidOn: payment.paidOn ? formatDayFirst(payment.paidOn) : '',
      notes: payment.notes ?? '',
      photoPaths: payment.photoPaths,
      documentPaths: payment.documentPaths,
    });
  }

  const paymentAmount = paymentForm.amount.trim()
    ? Number(paymentForm.amount.replace(/[^0-9.]/g, ''))
    : NaN;
  const canSavePayment = Number.isFinite(paymentAmount) && paymentAmount > 0;

  async function savePayment() {
    if (!primaryQuote || busy || !canSavePayment || editingPayment === null) return;
    setBusy(true);
    try {
      const input: PaymentInput = {
        amount: paymentAmount,
        amountInclGst: paymentForm.incl,
        // Empty means clear, which `updatePayment` turns into `p_clear`. A
        // date that will not parse is left null rather than guessed at —
        // `parseLooseDate` refuses 31/02 and a two-digit year outright.
        reference: paymentForm.reference.trim() || null,
        paidOn: parseLooseDate(paymentForm.paidOn) ?? null,
        notes: paymentForm.notes.trim() || null,
        photoPaths: paymentForm.photoPaths,
        documentPaths: paymentForm.documentPaths,
      };
      if (editingPayment === 'new') {
        await onAddPayment(primaryQuote.id, input);
      } else {
        await onUpdatePayment(editingPayment, input);
      }
      setEditingPayment(null);
      setPaymentForm(emptyPayment);
    } finally {
      setBusy(false);
    }
  }

  const paidSoFar = primaryPayments.reduce(
    (total, payment) => total + (inclGst(payment.amount, payment.amountInclGst) ?? 0),
    0
  );

  const showForm = adding || editingQuote !== null;

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
        {/* The title is the box. It names a new item and renames an existing
            one, which is the same act — and it is why adding no longer needs
            a sheet of its own in front of this one. The placeholder asks the
            question rather than showing an answer, which is the one case this
            app's no-example-values rule allows. */}
        <View style={styles.head}>
          <TextInput
            style={styles.name}
            value={title}
            onChangeText={(text) => { setTitle(text); if (text.trim()) setTitleMissing(false); }}
            onBlur={commitTitle}
            onSubmitEditing={commitTitle}
            placeholder="What is it?"
            placeholderTextColor={Colors.textMuted}
            accessibilityLabel="What the item is"
            autoFocus={!item}
            returnKeyType="done"
          />
          <Pressable onPress={onClose} style={styles.headTap} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>
        {titleMissing ? (
          <Text style={styles.titleMissing}>Give it a name — what is it you&rsquo;re getting?</Text>
        ) : null}
        {/* Where it is going, stated rather than asked: the pill that opened
            this was inside the part, which has already answered it. */}
        {!item && creatingIn && showElement ? (
          <Text style={styles.goingOn}>Going on {creatingIn.name}.</Text>
        ) : null}

        <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
          {primaryQuote && !showForm ? (
            <View style={styles.priceCard}>
              <View style={styles.quoteTop}>
                <View style={styles.quoteTitles}>
                  <Text style={styles.quoteSupplier}>{primaryQuote.supplier ?? 'No supplier named'}</Text>
                  {primaryQuote.detail ? (
                    <Text style={styles.quoteDetail} numberOfLines={1}>{primaryQuote.detail}</Text>
                  ) : null}
                </View>
                <View style={styles.quoteMoney}>
                  <Text style={styles.quoteAmount}>{formatMoney(primaryQuote.amount) ?? '—'}</Text>
                  <Text style={styles.quoteGst}>
                    {primaryQuote.amount === null
                      ? 'no amount'
                      : primaryQuote.amountInclGst
                        ? 'incl GST'
                        : `excl · ${formatMoney(grossAmount)} incl`}
                  </Text>
                </View>
                <Pressable
                  onPress={() => editQuote(primaryQuote)}
                  style={styles.quoteEdit}
                  accessibilityRole="button"
                  accessibilityLabel={`Correct the ${primaryQuote.supplier ?? 'unnamed'} price`}
                >
                  <Icon name="pencil-outline" size="sm" color={Colors.textMuted} />
                </Pressable>
              </View>

              {/* Quote, or Invoiced — the first question. */}
              <View style={styles.chips}>
                {(['quote', 'invoice'] as const).map((option) => {
                  const on = primaryQuote.kind === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => onUpdateQuote(primaryQuote.id, { kind: option })}
                      style={styles.chipTap}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={option === 'quote' ? 'Quote' : 'Invoiced'}
                    >
                      <View style={[styles.chip, on && styles.chipOn]}>
                        <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                          {option === 'quote' ? 'Quote' : 'Invoiced'}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* Quoted: accepted or declined. Tapping the one already chosen
                  clears it, the same toggle-off every chip row in this app
                  gives — there is no third pill for "not decided". */}
              {primaryQuote.kind === 'quote' ? (
                <>
                  <View style={styles.chips}>
                    {(['accepted', 'declined'] as const).map((option) => {
                      const on = primaryQuote.status === option;
                      return (
                        <Pressable
                          key={option}
                          onPress={() => onSetQuoteStatus(primaryQuote.id, on ? 'tbc' : option)}
                          style={styles.chipTap}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={PROJECT_QUOTE_STATUS_LABELS[option]}
                        >
                          <View style={[styles.chip, on && styles.chipOn]}>
                            <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                              {PROJECT_QUOTE_STATUS_LABELS[option]}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                  {primaryQuote.status === 'accepted' ? (
                    <Text style={styles.pending}>Pending invoice</Text>
                  ) : null}
                </>
              ) : (
                <View style={styles.chips}>
                  <Pressable
                    onPress={markPaid}
                    disabled={busy}
                    style={styles.chipTap}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isPaid }}
                    accessibilityLabel="Paid"
                  >
                    <View style={[styles.chip, isPaid && styles.chipOn]}>
                      <Text style={[styles.chipLabel, isPaid && styles.chipLabelOn]}>Paid</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={markNotPaid}
                    disabled={busy}
                    style={styles.chipTap}
                    accessibilityRole="button"
                    accessibilityState={{ selected: !isPaid }}
                    accessibilityLabel="Not paid"
                  >
                    <View style={[styles.chip, !isPaid && styles.chipOn]}>
                      <Text style={[styles.chipLabel, !isPaid && styles.chipLabelOn]}>Not paid</Text>
                    </View>
                  </Pressable>
                </View>
              )}

              {/* ── what has actually gone out ────────────────────────────
                  A $15,000 price gets invoiced in lots: a deposit, a progress
                  claim, the balance. *Paid* and *Not paid* are the whole
                  answer only when it went in one transfer — the rest of the
                  time the useful record is three lines with three invoice
                  numbers against them, which is also what makes the chips
                  above honest: `unpaid` is derived from exactly these rows, so
                  the last payment landing is what flips *Paid*, rather than
                  somebody asserting it.

                  Only under an invoice, because that is the rule the table
                  exists to keep: a payment settles a bill, not a price, and
                  `add_payment` refuses anything else in words. Offering the
                  control against a quote would be offering a write the server
                  is going to turn down. */}
              {primaryQuote.kind === 'invoice' || primaryPayments.length > 0 ? (
                <View style={styles.payments}>
                  <View style={styles.paymentsHead}>
                    <Text style={styles.paymentsTitle}>
                      {primaryPayments.length === 0
                        ? 'Nothing paid yet'
                        : `${formatMoney(paidSoFar)} paid`}
                    </Text>
                    {primaryQuote.unpaid !== null && primaryQuote.unpaid > 0.005 ? (
                      <Text style={styles.paymentsGap} numberOfLines={1}>
                        {formatMoney(primaryQuote.unpaid)} to go
                      </Text>
                    ) : null}
                  </View>

                  {primaryPayments.map((payment) =>
                    editingPayment === payment.id ? null : (
                      <Pressable
                        key={payment.id}
                        onPress={() => editPayment(payment)}
                        style={styles.payRow}
                        accessibilityRole="button"
                        accessibilityLabel={`${payment.reference ?? 'Payment'}, correct it`}
                      >
                        <View style={styles.payTitles}>
                          <Text style={styles.payRef} numberOfLines={1}>
                            {payment.reference ?? 'No invoice number'}
                          </Text>
                          <Text style={styles.payWhen} numberOfLines={1}>
                            {[
                              payment.paidOn ? formatDayFirst(payment.paidOn) : 'No date',
                              payment.photoPaths.length + payment.documentPaths.length > 0
                                ? `${payment.photoPaths.length + payment.documentPaths.length} attached`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </View>
                        <Text style={styles.payAmount} numberOfLines={1}>
                          {formatMoney(inclGst(payment.amount, payment.amountInclGst)) ?? '—'}
                        </Text>
                        {/* A sibling of the row, never inside it: one Pressable
                            in another is a coin toss about which gets the tap. */}
                        <Pressable
                          onPress={() => onDeletePayment(payment.id)}
                          style={styles.payRemove}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove the ${payment.reference ?? 'unnumbered'} payment`}
                        >
                          <Icon name="close" size="sm" color={Colors.textMuted} />
                        </Pressable>
                      </Pressable>
                    )
                  )}

                  {editingPayment !== null ? (
                    <View style={styles.payForm}>
                      <MoneyField
                        label="How much"
                        value={paymentForm.amount}
                        onChangeValue={(text) => setPaymentForm((f) => ({ ...f, amount: text }))}
                        inclusive={paymentForm.incl}
                        onChangeInclusive={(next) => setPaymentForm((f) => ({ ...f, incl: next }))}
                      />

                      <Text style={styles.fieldLabel}>Invoice number</Text>
                      <TextInput
                        style={styles.input}
                        value={paymentForm.reference}
                        onChangeText={(text) => setPaymentForm((f) => ({ ...f, reference: text }))}
                        accessibilityLabel="Invoice number"
                      />

                      <DateField
                        label="Date paid"
                        value={paymentForm.paidOn}
                        onChangeValue={(text) => setPaymentForm((f) => ({ ...f, paidOn: text }))}
                        pickerTitle="When did it go out?"
                      />

                      <View style={styles.spacer} />
                      <TextInput
                        style={[styles.input, styles.notes]}
                        value={paymentForm.notes}
                        onChangeText={(text) => setPaymentForm((f) => ({ ...f, notes: text }))}
                        multiline
                        accessibilityLabel="Anything worth remembering about this payment"
                      />

                      <Attachments
                        householdId={householdId}
                        photoPaths={paymentForm.photoPaths}
                        documentPaths={paymentForm.documentPaths}
                        onChange={async (next) => {
                          setPaymentForm((f) => ({
                            ...f,
                            photoPaths: next.photoPaths ?? f.photoPaths,
                            documentPaths: next.documentPaths ?? f.documentPaths,
                          }));
                        }}
                        emptyLabel="Nothing attached to this payment yet."
                      />

                      <View style={styles.payFormRow}>
                        <Pressable
                          onPress={() => { setEditingPayment(null); setPaymentForm(emptyPayment); }}
                          disabled={busy}
                          style={styles.payCancel}
                          accessibilityRole="button"
                          accessibilityLabel="Leave it as it was"
                        >
                          <Text style={styles.payCancelLabel}>Not now</Text>
                        </Pressable>
                        <Pressable
                          onPress={savePayment}
                          disabled={busy || !canSavePayment}
                          style={[styles.paySave, (busy || !canSavePayment) && styles.ctaOff]}
                          accessibilityRole="button"
                          accessibilityLabel="Save the payment"
                        >
                          <Text
                            style={[
                              styles.paySaveLabel,
                              (busy || !canSavePayment) && styles.ctaLabelOff,
                            ]}
                          >
                            {busy ? 'Saving…' : 'Save the payment'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : primaryQuote.kind === 'invoice' ? (
                    <Pressable
                      onPress={startPayment}
                      style={styles.payAddTap}
                      accessibilityRole="button"
                      accessibilityLabel="Add a payment"
                    >
                      <View style={styles.payAdd}>
                        <Text style={styles.payAddLabel}>Add a payment</Text>
                      </View>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.priceFoot}>
                <Pressable
                  onPress={() => setFilesOpen((open) => !open)}
                  style={styles.quoteFiles}
                  accessibilityRole="button"
                  accessibilityLabel="Paperwork for this price"
                >
                  <Icon name="document-attach-outline" size="sm" color={Colors.primary} />
                  <Text style={styles.link}>
                    {primaryQuote.photoPaths.length + primaryQuote.documentPaths.length > 0
                      ? `${primaryQuote.photoPaths.length + primaryQuote.documentPaths.length} attached`
                      : 'Attach'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onDeleteQuote(primaryQuote.id)}
                  style={styles.quoteRemove}
                  accessibilityRole="button"
                  accessibilityLabel="Remove this price"
                >
                  <Text style={styles.removeLabel}>Remove</Text>
                </Pressable>
              </View>

              {filesOpen ? (
                <View style={styles.quoteAttach}>
                  <Attachments
                    householdId={householdId}
                    photoPaths={primaryQuote.photoPaths}
                    documentPaths={primaryQuote.documentPaths}
                    onChange={(next, toast) => onUpdateQuoteFiles(primaryQuote.id, next, toast)}
                    emptyLabel="Nothing attached to this price yet."
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Whatever was on record before an item carried a single price.
              Read-only here on purpose — comparing prices is no longer this
              sheet's job — but never hidden, since each one still counts. */}
          {legacyQuotes.length > 0 && !showForm ? (
            <View style={styles.legacyBlock}>
              <Text style={styles.section}>Also on record</Text>
              {legacyQuotes.map((quote) => (
                <View key={quote.id} style={styles.legacyRow}>
                  <Text style={styles.legacyName} numberOfLines={1}>
                    {quote.supplier ?? 'No supplier named'} · {PROJECT_QUOTE_STATUS_LABELS[quote.status]}
                  </Text>
                  <Text style={styles.legacyAmount} numberOfLines={1}>
                    {formatMoney(quote.amount) ?? '—'}
                  </Text>
                  <Pressable
                    onPress={() => onDeleteQuote(quote.id)}
                    style={styles.legacyRemove}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove the ${quote.supplier ?? 'unnamed'} price`}
                  >
                    <Icon name="close" size="sm" color={Colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {!primaryQuote && !showForm ? (
            <Text style={styles.hint}>Nobody has priced this yet.</Text>
          ) : null}

          {showForm ? (
            <View style={styles.form}>
              <Text style={styles.fieldLabel}>Who from</Text>
              <TextInput
                style={styles.input}
                value={supplier}
                onChangeText={setSupplier}
                placeholder="Mico Bathrooms"
                placeholderTextColor={Colors.textMuted}
                accessibilityLabel="Who from"
              />
              <Text style={styles.fieldLabel}>What exactly</Text>
              <TextInput
                style={styles.input}
                value={detail}
                onChangeText={setDetail}
                placeholder="Methven Krome"
                placeholderTextColor={Colors.textMuted}
                accessibilityLabel="What exactly"
              />
              <View style={styles.spacer} />
              <MoneyField
                label="Amount"
                value={amount}
                onChangeValue={setAmount}
                inclusive={incl}
                onChangeInclusive={setIncl}
              />
              <Pressable
                onPress={editingQuote ? saveQuote : addQuote}
                disabled={busy || !canSaveQuote}
                style={[styles.cta, (busy || !canSaveQuote) && styles.ctaOff]}
                accessibilityRole="button"
                accessibilityLabel={editingQuote ? 'Save the correction' : 'Save this price'}
              >
                {busy ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={[styles.ctaLabel, !canSaveQuote && styles.ctaLabelOff]}>
                    {editingQuote ? 'Save the correction' : 'Save this price'}
                  </Text>
                )}
              </Pressable>
              {/* A way back out that does not save. Without it the only escape
                  from a form somebody opened by mistake is closing the whole
                  sheet, which loses the item they were looking at too. */}
              {editingQuote || quotes.length > 0 ? (
                <Pressable
                  onPress={closeForm}
                  style={styles.formCancel}
                  accessibilityRole="button"
                  accessibilityLabel="Leave it as it was"
                >
                  <Text style={styles.formCancelLabel}>
                    {editingQuote ? 'Leave it as it was' : 'Not now'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {/* The one state still changed by hand — everything above moves
              from the price. Installed is what lets the house record offer
              carry this item's model number over once it is actually in. */}
          <Pressable
            onPress={async () => {
              const target = await ensureItem();
              if (!target) return;
              await onUpdateItem(
                target.id,
                { status: installed ? 'considering' : 'installed' },
                installed ? 'Not installed' : 'Installed'
              );
            }}
            style={styles.installedRow}
            accessibilityRole="button"
            accessibilityState={{ selected: installed }}
            accessibilityLabel={installed ? 'Installed' : 'Mark as installed'}
          >
            <Icon
              name={installed ? 'checkmark-circle' : 'ellipse-outline'}
              size="sm"
              color={installed ? Colors.primary : Colors.textMuted}
            />
            <Text style={[styles.installedLabel, installed && styles.installedLabelOn]}>
              {installed ? 'Installed' : 'Mark as installed'}
            </Text>
          </Pressable>

          {/* ── the item's own paperwork ───────────────────────────────── */}
          <View style={styles.sectionRow}>
            <Text style={styles.section}>About this item</Text>
            <View style={styles.rule} />
          </View>

          <TextInput
            style={[styles.input, styles.notes]}
            value={notes}
            onChangeText={setNotes}
            onBlur={async () => {
              if ((item?.notes ?? '') === notes) return;
              const target = await ensureItem();
              if (!target) return;
              await onUpdateItem(target.id, { notes: notes.trim() || null }, 'Saved');
            }}
            placeholder="Anything worth remembering about this one"
            placeholderTextColor={Colors.textMuted}
            multiline
            accessibilityLabel="Notes"
          />

          <Attachments
            householdId={householdId}
            photoPaths={item?.photoPaths ?? []}
            documentPaths={item?.documentPaths ?? []}
            onChange={async (next, toast) => {
              const target = await ensureItem();
              if (!target) return;
              await onUpdateItem(target.id, next, toast);
            }}
            emptyLabel="Nothing attached to this item yet."
          />

          {/* The payoff, offered only once the thing is actually in: an item
              installed is something the house now has, and the House record is
              where somebody will go looking for its model number in four
              years. Pre-filled, and it carries the project with it. */}
          {onRecordAsThing && installed ? (
            <Pressable
              onPress={onRecordAsThing}
              style={styles.record}
              accessibilityRole="button"
              accessibilityLabel="Record it in the house record"
            >
              <Icon name="home-outline" size="sm" color={Colors.primary} />
              <Text style={styles.link}>Record it in the house record</Text>
            </Pressable>
          ) : null}

          {/* On a row that does not exist yet this is simply the way out —
              there is nothing to destroy, so there is nothing to confirm. */}
          <Pressable
            onPress={() => (item ? setConfirmDelete(true) : onClose())}
            style={styles.remove}
            accessibilityRole="button"
            accessibilityLabel={item ? `Remove ${item.name}` : 'Remove this item'}
          >
            <Text style={styles.removeLabel}>Remove this item</Text>
          </Pressable>
        </ScrollView>
      </View>

      <ConfirmDialog
        visible={confirmDelete}
        title={`Remove ${item?.name ?? 'this item'}?`}
        message={
          quotes.length > 0
            ? `Its ${quotes.length === 1 ? 'price goes' : `${quotes.length} prices go`} with it, and so does anything attached to them.`
            : 'Nothing else goes with it.'
        }
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          await onDeleteItem();
        }}
      />

      {/* *Not paid* undoes the one-tap *Paid*, where what it removes is a
          figure and nothing else. Once somebody has typed invoice numbers,
          dates and attached the bills, it is throwing that away — so it says
          how much goes first. Two buttons rather than a typed word: this is
          undoing a state, not deleting a place. */}
      <ConfirmDialog
        visible={clearingPayments}
        title="Clear what has been paid?"
        message={
          primaryPayments.length === 1
            ? 'The payment goes, and so does its invoice number, its date and anything attached to it.'
            : `All ${primaryPayments.length} payments go, and so do their invoice numbers, their dates and anything attached to them.`
        }
        confirmLabel="Clear them"
        destructive
        onCancel={() => setClearingPayments(false)}
        onConfirm={async () => {
          setClearingPayments(false);
          await clearPayments();
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '90%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  // A box that does not look like one until it is being used: the title of the
  // sheet reads as a title, and turns out to be editable when tapped.
  name: {
    flex: 1, minWidth: 0,
    fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary,
    paddingVertical: Spacing.xs,
  },
  titleMissing: { fontSize: Typography.sm, color: Colors.danger, marginTop: Spacing.xs },
  goingOn: { fontSize: Typography.sm, color: Colors.textSecondary, marginTop: Spacing.xs },
  headTap: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md },
  scroll: { marginTop: Spacing.sm },

  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: Spacing.sm },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingRight: Spacing.sm },
  chip: { backgroundColor: Colors.sunken, borderRadius: Radius.chip, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  pending: { fontSize: Typography.sm, color: Colors.status.doing, marginTop: Spacing.xs, fontWeight: Typography.medium },

  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md, marginBottom: Spacing.sm },
  section: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' },
  rule: { flex: 1, height: 1, backgroundColor: Colors.border },

  priceCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  quoteTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  quoteTitles: { flex: 1, minWidth: 0 },
  quoteSupplier: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  quoteDetail: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },
  quoteMoney: { alignItems: 'flex-end' },
  quoteAmount: { fontFamily: Fonts.mono, fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  quoteGst: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },
  quoteEdit: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    marginRight: -Spacing.sm,
    marginTop: -Spacing.xs,
  },
  priceFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  quoteFiles: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: MIN_TOUCH_TARGET, flex: 1 },
  quoteRemove: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: Spacing.xs },
  quoteAttach: { marginTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm },

  payments: { marginTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm },
  paymentsHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  paymentsTitle: { flex: 1, minWidth: 0, fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textSecondary },
  // Brass: money still to go out is a fact about what is owed, the same kind of
  // fact a due date is. Never clay — being part way through paying a bill is
  // the ordinary middle of a job, not an alarm.
  paymentsGap: { flexShrink: 0, fontFamily: Fonts.mono, fontSize: Typography.sm, color: Colors.status.doing },
  payRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  payTitles: { flex: 1, minWidth: 0 },
  payRef: { fontSize: Typography.sm, color: Colors.textPrimary, fontWeight: Typography.medium },
  payWhen: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },
  payAmount: { flexShrink: 0, fontFamily: Fonts.mono, fontSize: Typography.sm, color: Colors.textPrimary },
  payRemove: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.sm },
  // The app's one pill: a sunken well, no border, the label inside it.
  payAddTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignItems: 'flex-start' },
  payAdd: { backgroundColor: Colors.sunken, borderRadius: Radius.chip, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  payAddLabel: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.semibold },
  payForm: { marginTop: Spacing.sm },
  payFormRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  payCancel: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: Spacing.sm },
  payCancelLabel: { fontSize: Typography.sm, color: Colors.textMuted },
  paySave: {
    flex: 1, backgroundColor: Colors.primary, borderRadius: Radius.button,
    minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
  },
  paySaveLabel: { fontSize: Typography.sm, color: Colors.white, fontWeight: Typography.semibold },

  legacyBlock: { marginTop: Spacing.md },
  legacyRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    minHeight: MIN_TOUCH_TARGET,
  },
  legacyName: { flex: 1, minWidth: 0, fontSize: Typography.sm, color: Colors.textSecondary },
  legacyAmount: { flexShrink: 0, fontFamily: Fonts.mono, fontSize: Typography.sm, color: Colors.textMuted },
  legacyRemove: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.sm },

  installedRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET, marginTop: Spacing.md,
  },
  installedLabel: { fontSize: Typography.sm, color: Colors.textMuted, fontWeight: Typography.medium },
  installedLabelOn: { color: Colors.textPrimary, fontWeight: Typography.semibold },

  form: { marginTop: Spacing.sm },
  fieldLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  input: {
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  notes: { minHeight: 72, textAlignVertical: 'top' },
  spacer: { height: Spacing.xs },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.sm },
  cta: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { color: Colors.white, fontSize: Typography.base, fontWeight: Typography.semibold },
  ctaLabelOff: { color: Colors.textMuted },
  formCancel: { alignItems: 'center', minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  formCancelLabel: { fontSize: Typography.sm, color: Colors.textMuted },
  link: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.semibold },
  record: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: MIN_TOUCH_TARGET, marginTop: Spacing.sm },
  remove: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', marginTop: Spacing.sm },
  removeLabel: { fontSize: Typography.sm, color: Colors.danger },
});
