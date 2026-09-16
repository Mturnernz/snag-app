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
import { formatLooseDate, formatMoney, inclGst, parseLooseDate } from '@snag/supabase-queries';
import {
  ProjectItem, ProjectItemStatus, ProjectQuote, ProjectQuoteKind,
  PROJECT_ITEM_STATUS_LABELS, PROJECT_ITEM_STATUS_ORDER,
  PROJECT_QUOTE_KIND_LABELS, PROJECT_QUOTE_KINDS,
} from '../types';

interface Props {
  visible: boolean;
  householdId: string;
  item: ProjectItem | null;
  quotes: ProjectQuote[];
  onClose: () => void;
  onUpdateItem: (update: { name?: string; status?: ProjectItemStatus; notes?: string | null; photoPaths?: string[]; documentPaths?: string[] }, toast: string) => Promise<void>;
  onDeleteItem: () => Promise<void>;
  onAddQuote: (input: {
    supplier: string | null;
    detail: string | null;
    amount: number | null;
    amountInclGst: boolean;
    kind: ProjectQuoteKind;
    dated: string | null;
  }) => Promise<void>;
  onChooseQuote: (quoteId: string, chosen: boolean) => Promise<void>;
  onDeleteQuote: (quoteId: string) => Promise<void>;
  onUpdateQuoteFiles: (quoteId: string, next: { photoPaths?: string[]; documentPaths?: string[] }, toast: string) => Promise<void>;
  /** Offered once something is in: an item that exists is a thing the house now has. */
  onRecordAsThing?: () => void;
}

/**
 * One item, and the quotes on it — the compare moment.
 *
 * This is the bottom of the hierarchy and the place the middle-layer rule
 * applies for the second time: **an item with one quote shows that number and
 * never says the word "quote".** The list of quotes only becomes a list when
 * there are two, because until then it is just the price.
 *
 * **Choosing is the only write here that moves the project's total**, which is
 * why it goes through `set_quote_chosen` rather than riding in an update with
 * eight other fields — the same argument that keeps `setPartBought` out of
 * `updateSnag`. The server clears the sibling first, because the one-chosen
 * index is a plain unique index and not a deferred constraint.
 *
 * **Every quote carries its own paperwork**, rather than the item pooling it.
 * That is what makes "why did we pick Mico" answerable in March: the quote and
 * the PDF behind it are one row. Files roll up to the project's folder; they
 * never roll down, so the project's council consent is not shown here.
 *
 * The amount is typed with the GST pill beside it and stored exactly as typed —
 * nothing in this app reads a figure out of an attachment.
 */
export default function ItemSheet({
  visible, householdId, item, quotes, onClose,
  onUpdateItem, onDeleteItem, onAddQuote, onChooseQuote, onDeleteQuote,
  onUpdateQuoteFiles, onRecordAsThing,
}: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [adding, setAdding] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [detail, setDetail] = useState('');
  const [amount, setAmount] = useState('');
  const [incl, setIncl] = useState(true);
  const [kind, setKind] = useState<ProjectQuoteKind>('quote');
  const [dated, setDated] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAdding(quotes.length === 0);
    setSupplier('');
    setDetail('');
    setAmount('');
    setIncl(true);
    setKind('quote');
    setDated('');
    setNotes(item?.notes ?? '');
    setExpandedQuote(null);
  }, [visible, item?.id]);

  if (!item) return null;

  const canSaveQuote = amount.trim().length > 0 || supplier.trim().length > 0;

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
        kind,
        dated: parseLooseDate(dated) ?? null,
      });
      setSupplier('');
      setDetail('');
      setAmount('');
      setDated('');
      setKind('quote');
      setAdding(false);
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
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Pressable onPress={onClose} style={styles.headTap} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
          {/* Where it has got to. Four states and never "done" — that word
              belongs to snags, and an item can be in and still wrong. */}
          <View style={styles.chips}>
            {PROJECT_ITEM_STATUS_ORDER.map((option) => {
              const on = item.status === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => onUpdateItem({ status: option }, PROJECT_ITEM_STATUS_LABELS[option])}
                  style={styles.chipTap}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={PROJECT_ITEM_STATUS_LABELS[option]}
                >
                  <View style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                      {PROJECT_ITEM_STATUS_LABELS[option]}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* ── quotes ─────────────────────────────────────────────────── */}
          <View style={styles.sectionRow}>
            <Text style={styles.section}>
              {quotes.length > 1 ? 'Quotes' : 'What it costs'}
            </Text>
            <View style={styles.rule} />
            {!adding ? (
              <Pressable
                onPress={() => setAdding(true)}
                style={styles.plusTap}
                accessibilityRole="button"
                accessibilityLabel="Add a quote"
              >
                <Icon name="add" size="md" color={Colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {quotes.map((quote) => {
            const shown = formatMoney(quote.amount);
            const gross = formatMoney(inclGst(quote.amount, quote.amountInclGst));
            const open = expandedQuote === quote.id;
            return (
              <View key={quote.id} style={[styles.quote, quote.chosen && styles.quoteOn]}>
                <View style={styles.quoteTop}>
                  <View style={styles.quoteTitles}>
                    <Text style={styles.quoteSupplier}>{quote.supplier ?? 'No supplier named'}</Text>
                    <Text style={styles.quoteDetail} numberOfLines={1}>
                      {[
                        quote.detail,
                        PROJECT_QUOTE_KIND_LABELS[quote.kind].toLowerCase(),
                        quote.dated ? formatLooseDate(quote.dated) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <View style={styles.quoteMoney}>
                    <Text style={styles.quoteAmount}>{shown ?? '—'}</Text>
                    {/* What was typed, and what it means. Never silently
                        converted: the rollup normalises, the row does not. */}
                    <Text style={styles.quoteGst}>
                      {quote.amount === null
                        ? 'no amount'
                        : quote.amountInclGst
                          ? 'incl GST'
                          : `excl · ${gross} incl`}
                    </Text>
                  </View>
                </View>

                <View style={styles.quoteFoot}>
                  <Pressable
                    onPress={() => onChooseQuote(quote.id, !quote.chosen)}
                    style={styles.chipTap}
                    accessibilityRole="button"
                    accessibilityState={{ selected: quote.chosen }}
                    accessibilityLabel={quote.chosen ? 'Chosen' : 'Choose this'}
                  >
                    <View style={[styles.chip, quote.chosen && styles.chipOn]}>
                      <Text style={[styles.chipLabel, quote.chosen && styles.chipLabelOn]}>
                        {quote.chosen ? 'Chosen' : 'Choose this'}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => setExpandedQuote(open ? null : quote.id)}
                    style={styles.quoteFiles}
                    accessibilityRole="button"
                    accessibilityLabel="Paperwork for this quote"
                  >
                    <Icon name="document-attach-outline" size="sm" color={Colors.primary} />
                    <Text style={styles.link}>
                      {quote.photoPaths.length + quote.documentPaths.length > 0
                        ? `${quote.photoPaths.length + quote.documentPaths.length} attached`
                        : 'Attach'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onDeleteQuote(quote.id)}
                    style={styles.quoteRemove}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove the ${quote.supplier ?? 'unnamed'} quote`}
                  >
                    <Icon name="close" size="sm" color={Colors.textMuted} />
                  </Pressable>
                </View>

                {open ? (
                  <View style={styles.quoteAttach}>
                    <Attachments
                      householdId={householdId}
                      photoPaths={quote.photoPaths}
                      documentPaths={quote.documentPaths}
                      onChange={(next, toast) => onUpdateQuoteFiles(quote.id, next, toast)}
                      emptyLabel="Nothing attached to this quote yet."
                    />
                  </View>
                ) : null}
              </View>
            );
          })}

          {adding ? (
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
              <Text style={styles.fieldLabel}>What is it</Text>
              <View style={styles.chips}>
                {PROJECT_QUOTE_KINDS.map((option) => {
                  const on = kind === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setKind(option)}
                      style={styles.chipTap}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={PROJECT_QUOTE_KIND_LABELS[option]}
                    >
                      <View style={[styles.chip, on && styles.chipOn]}>
                        <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                          {PROJECT_QUOTE_KIND_LABELS[option]}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>
                A quote is what it might cost. An invoice or a receipt is what it did — only those
                two count towards what’s been spent.
              </Text>
              <DateField
                label="Dated"
                value={dated}
                onChangeValue={setDated}
                pickerTitle="When was it quoted?"
              />
              <Pressable
                onPress={addQuote}
                disabled={busy || !canSaveQuote}
                style={[styles.cta, (busy || !canSaveQuote) && styles.ctaOff]}
                accessibilityRole="button"
                accessibilityLabel="Save this price"
              >
                {busy ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={[styles.ctaLabel, !canSaveQuote && styles.ctaLabelOff]}>
                    Save this price
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}

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
            ? `Its ${quotes.length === 1 ? 'quote goes' : `${quotes.length} quotes go`} with it, and so does anything attached to them.`
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

  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingRight: Spacing.sm },
  chip: { backgroundColor: Colors.sunken, borderRadius: Radius.chip, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },

  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md, marginBottom: Spacing.sm },
  section: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' },
  rule: { flex: 1, height: 1, backgroundColor: Colors.border },
  plusTap: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.md },

  quote: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.card,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  quoteOn: { borderColor: Colors.successBorder, backgroundColor: Colors.primaryLight },
  quoteTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  quoteTitles: { flex: 1, minWidth: 0 },
  quoteSupplier: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  quoteDetail: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },
  quoteMoney: { alignItems: 'flex-end' },
  quoteAmount: { fontFamily: Fonts.mono, fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  quoteGst: { fontSize: Typography.xs, color: Colors.textMuted, marginTop: 1 },
  quoteFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  quoteFiles: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: MIN_TOUCH_TARGET, flex: 1 },
  quoteRemove: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.sm },
  quoteAttach: { marginTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm },

  form: { marginTop: Spacing.xs },
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
  hint: { fontSize: Typography.xs, color: Colors.textMuted, lineHeight: 17, marginBottom: Spacing.md },
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
  link: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.semibold },
  record: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: MIN_TOUCH_TARGET, marginTop: Spacing.sm },
  remove: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', marginTop: Spacing.sm },
  removeLabel: { fontSize: Typography.sm, color: Colors.danger },
});
