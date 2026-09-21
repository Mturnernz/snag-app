import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import MoneyField from './MoneyField';
import Attachments from './Attachments';
import ConfirmDialog from './ConfirmDialog';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { formatMoney, inclGst } from '@snag/supabase-queries';
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
  /** This item's prices. The first one is the one the header operates on. */
  quotes: ProjectQuote[];
  /** Payments against any invoice among `quotes`. */
  payments: ProjectPayment[];
  onClose: () => void;
  onUpdateItem: (update: { name?: string; status?: ProjectItem['status']; notes?: string | null; photoPaths?: string[]; documentPaths?: string[] }, toast: string) => Promise<void>;
  onDeleteItem: () => Promise<void>;
  onAddQuote: (input: QuoteFields) => Promise<void>;
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
  onAddPayment: (quoteId: string, amount: number) => Promise<void>;
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
 */
export default function ItemSheet({
  visible, householdId, item, quotes, payments, onClose,
  onUpdateItem, onDeleteItem, onAddQuote, onSetQuoteStatus, onUpdateQuote, onDeleteQuote,
  onUpdateQuoteFiles, onAddPayment, onDeletePayment, onRecordAsThing,
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
  }, [visible, item?.id]);

  if (!item) return null;

  const canSaveQuote = amount.trim().length > 0 || supplier.trim().length > 0;

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
      const parsed = amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) : NaN;
      await onAddQuote({
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
      await onAddPayment(primaryQuote.id, outstanding);
    } finally {
      setBusy(false);
    }
  }

  async function markNotPaid() {
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
        <View style={styles.head}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Pressable onPress={onClose} style={styles.headTap} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>

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
            onPress={() =>
              onUpdateItem(
                { status: item.status === 'installed' ? 'considering' : 'installed' },
                item.status === 'installed' ? 'Not installed' : 'Installed'
              )
            }
            style={styles.installedRow}
            accessibilityRole="button"
            accessibilityState={{ selected: item.status === 'installed' }}
            accessibilityLabel={item.status === 'installed' ? 'Installed' : 'Mark as installed'}
          >
            <Icon
              name={item.status === 'installed' ? 'checkmark-circle' : 'ellipse-outline'}
              size="sm"
              color={item.status === 'installed' ? Colors.primary : Colors.textMuted}
            />
            <Text style={[styles.installedLabel, item.status === 'installed' && styles.installedLabelOn]}>
              {item.status === 'installed' ? 'Installed' : 'Mark as installed'}
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
            onBlur={() => {
              if ((item.notes ?? '') !== notes) {
                onUpdateItem({ notes: notes.trim() || null }, 'Saved');
              }
            }}
            placeholder="Anything worth remembering about this one"
            placeholderTextColor={Colors.textMuted}
            multiline
            accessibilityLabel="Notes"
          />

          <Attachments
            householdId={householdId}
            photoPaths={item.photoPaths}
            documentPaths={item.documentPaths}
            onChange={(next, toast) => onUpdateItem(next, toast)}
            emptyLabel="Nothing attached to this item yet."
          />

          {/* The payoff, offered only once the thing is actually in: an item
              installed is something the house now has, and the House record is
              where somebody will go looking for its model number in four
              years. Pre-filled, and it carries the project with it. */}
          {onRecordAsThing && item.status === 'installed' ? (
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

          <Pressable
            onPress={() => setConfirmDelete(true)}
            style={styles.remove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name}`}
          >
            <Text style={styles.removeLabel}>Remove this item</Text>
          </Pressable>
        </ScrollView>
      </View>

      <ConfirmDialog
        visible={confirmDelete}
        title={`Remove ${item.name}?`}
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
  name: { flex: 1, minWidth: 0, fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
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
