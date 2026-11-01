import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, PanResponder, Platform, Pressable, StyleSheet, View,
} from 'react-native';
import { Text } from './Text';

import Sheet from './Sheet';
import Button from './Button';
import ConfirmDialog from './ConfirmDialog';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  dayKey, documentName, factsThatDiffer, formatExactDate, formatMoney, type LookAlikeGroup,
} from '@snag/supabase-queries';
import { getFileUrl } from '../lib/supabase';
import { openUrl } from '../lib/openUrl';
import { showAlert } from '../lib/alert';
import type {
  InvoiceReview, ProjectElement, ProjectItem, ProjectPayment, ProjectQuote,
} from '../types';

/** What the cards are read against: the rest of the job's page. */
export interface LookAlikeContext {
  quotes: ProjectQuote[];
  payments: ProjectPayment[];
  reviews: InvoiceReview[];
  elements: ProjectElement[];
  items: ProjectItem[];
  /** *you*, a member's name, or null for somebody no longer on the household. */
  nameOf: (profileId: string | null) => string | null;
}

interface Props {
  visible: boolean;
  /** The prices being compared, oldest first. Fewer than two and the sheet has nothing to ask. */
  group: LookAlikeGroup | null;
  context: LookAlikeContext;
  /** Deletes one price and its files. A throw keeps the sheet open and says why. */
  onDelete: (price: ProjectQuote) => Promise<void>;
  /** Keeps every price still in the group, so the question stops. */
  onKeepAll: (prices: ProjectQuote[]) => Promise<void>;
  onClose: () => void;
}

export interface Fact {
  name: string;
  label: string;
  value: string;
}

const SWIPE = 96;

/**
 * What a sideways drag on a card means, from how far it went. Left past the
 * line is delete, right is keep, anything shorter, or more down than across,
 * is nothing: a page that scrolls under the thumb must not delete a quote.
 */
export function swipeOutcome(dx: number, dy: number): 'delete' | 'keep' | null {
  if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'delete' : 'keep';
}

const day = (iso: string | null): string => (iso ? formatExactDate(dayKey(new Date(iso))) : '');
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One card's facts, in the order they are read down it. */
export function cardFacts(price: ProjectQuote, context: LookAlikeContext): Fact[] {
  const isBill = price.kind === 'invoice';
  const review = context.reviews.find((r) => r.quoteId === price.id) ?? null;
  const who = context.nameOf(price.createdBy);
  const part = price.projectId ? 'Whole job'
    : price.elementId ? (context.elements.find((e) => e.id === price.elementId)?.name ?? 'A part of the job')
      : (context.items.find((i) => i.id === price.itemId)?.name ?? 'A thing on the job');
  const stages = context.quotes.filter((q) => q.againstQuoteId === price.id).length;
  const inside = context.quotes.filter((q) => q.billedThroughId === price.id).length;
  const payments = context.payments.filter((p) => p.quoteId === price.id).length;
  const onIt = [
    stages ? plural(stages, 'stage', 'stages') : null,
    inside ? plural(inside, 'invoice inside', 'invoices inside') : null,
    payments ? plural(payments, 'payment', 'payments') : null,
    price.lineCount ? plural(price.lineCount, 'line', 'lines') : null,
  ].filter(Boolean).join(' · ');
  const state = isBill
    ? ((price.paidTotal ?? 0) > 0 && (price.unpaid ?? 0) <= 0 ? 'Paid'
      : (price.paidTotal ?? 0) > 0 ? `${formatMoney(price.unpaid) ?? ''} to pay` : 'Not paid')
    : price.status === 'accepted' ? 'Agreed' : 'Not agreed';
  const files = [...price.documentPaths.map(documentName), ...price.photoPaths.map(() => 'photo')];

  return [
    { name: 'number', label: 'Number', value: price.invoiceNumber ?? 'None' },
    { name: 'words', label: 'Says', value: price.detail ?? 'Nothing' },
    { name: 'dated', label: 'Dated', value: formatExactDate(price.dated) || 'No date' },
    ...(isBill ? [{ name: 'due', label: 'Due', value: formatExactDate(price.dueOn) || 'No date' }] : []),
    { name: 'state', label: isBill ? 'Paid' : 'Agreed', value: state },
    { name: 'part', label: 'Part', value: part },
    { name: 'added', label: 'Added', value: [day(price.createdAt), who ? `by ${who}` : null].filter(Boolean).join(' ') },
    {
      name: 'from',
      label: 'From',
      value: review
        ? ['Email', day(review.sourceAt ?? review.createdAt), review.sourceSubject].filter(Boolean).join(' · ')
        : 'Typed in',
    },
    { name: 'files', label: 'Files', value: files.length ? files.join(', ') : 'None' },
    { name: 'on', label: 'On it', value: onIt || 'Nothing' },
  ];
}

/**
 * Two or more prices that look like one, compared a card at a time.
 *
 * *Worth checking* names a quote on the job twice, or an invoice; until this it
 * opened one of them, and deciding which to keep meant opening each in turn
 * and remembering the other. Here each price is a card with everything that
 * tells copies apart: its number and words, its dates, whether it is agreed or
 * paid, the part of the job it is on, **when it was added and by whom**, the
 * email it came in on, its files (each opens), and what hangs off it. A fact
 * the cards disagree on is in bold on every card (`factsThatDiffer`), so the
 * eye goes to the difference.
 *
 * **Swipe left to delete, right to keep, or press the buttons that say the
 * same**, by the owner's decision: a desktop has no swipe, and a gesture alone
 * is a control half the people opening this cannot use. A drag that goes more
 * down than across is a scroll (`swipeOutcome`), and on the web the card says
 * `touch-action: pan-y` so the page still scrolls under it.
 *
 * - **Delete asks first**, by the owner's decision, in the words the price's
 *   own sheet uses, and names the payments that go with it. The sheet hides
 *   while it asks, because a dialog over a sheet is a modal over a modal.
 * - **Keep moves to the next card.** Keeping every card left writes every pair
 *   in one call (`keep_both_prices`), for the household, so neither phone
 *   asks again.
 * - **One left is an answer**: the sheet closes once a delete leaves a single
 *   price, so the last copy cannot be deleted from here.
 * - **The dots move between cards** without deciding anything, for comparing
 *   back and forth.
 */
export default function LookAlikeSheet({
  visible, group, context, onDelete, onKeepAll, onClose,
}: Props) {
  const prices = group?.prices ?? [];
  const [index, setIndex] = useState(0);
  const [kept, setKept] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState<ProjectQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dx = useRef(new Animated.Value(0)).current;

  // A comparison starts at its first card with nothing decided, each time the
  // sheet opens. A re-read of the page while it is open (after a delete) is
  // not a new comparison, so what was kept stays kept.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setIndex(0);
      setKept(new Set());
      setConfirming(null);
      setError(null);
      dx.setValue(0);
    }
    wasVisible.current = visible;
  }, [visible]);

  // A deleted price drops out of the group on the re-read; stay on a card that is there.
  useEffect(() => {
    if (index > prices.length - 1) setIndex(Math.max(0, prices.length - 1));
  }, [prices.length]);

  const facts = useMemo(() => prices.map((p) => cardFacts(p, context)), [prices, context]);
  const differ = useMemo(() => {
    const amounts = prices.map((p) => ({ amount: formatMoney(p.amountIncl) }));
    return factsThatDiffer([
      ...facts.map((list, i) => ({
        ...Object.fromEntries(list.map((f) => [f.name, f.value])),
        ...amounts[i],
      })),
    ]);
  }, [facts, prices]);

  const price = prices[index] ?? null;
  const isBill = price?.kind === 'invoice';
  const noun = group?.kind === 'invoice' ? 'invoice' : 'quote';

  function settle() {
    Animated.spring(dx, { toValue: 0, useNativeDriver: false }).start();
  }

  async function keep(target: ProjectQuote) {
    if (busy) return;
    const next = new Set(kept).add(target.id);
    setKept(next);
    setError(null);
    const undecided = prices.findIndex((p) => !next.has(p.id));
    if (undecided >= 0) {
      setIndex(undecided);
      dx.setValue(0);
      return;
    }
    setBusy(true);
    try {
      await onKeepAll(prices);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Those weren’t kept');
      settle();
    } finally {
      setBusy(false);
    }
  }

  function askDelete(target: ProjectQuote) {
    if (busy) return;
    setError(null);
    setConfirming(target);
  }

  async function confirmDelete() {
    const target = confirming;
    setConfirming(null);
    settle();
    if (!target) return;
    setBusy(true);
    try {
      await onDelete(target);
      if (prices.length - 1 < 2) onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That wasn’t deleted');
    } finally {
      setBusy(false);
    }
  }

  const priceRef = useRef(price);
  priceRef.current = price;
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: (_e, g) => dx.setValue(g.dx),
    onPanResponderRelease: (_e, g) => {
      const target = priceRef.current;
      const outcome = swipeOutcome(g.dx, g.dy);
      if (!target || !outcome) { settle(); return; }
      if (outcome === 'delete') askDelete(target);
      else keep(target);
    },
    onPanResponderTerminate: () => settle(),
  }), [kept, busy, prices]);

  async function openDocument(path: string) {
    const url = await getFileUrl(path);
    if (!url) {
      showAlert("Couldn't open that", 'The link to this document could not be made.');
      return;
    }
    openUrl(url);
  }

  const payments = confirming ? context.payments.filter((p) => p.quoteId === confirming.id).length : 0;
  const deleteLabel = Animated.multiply(dx, -1).interpolate({ inputRange: [0, SWIPE], outputRange: [0, 1], extrapolate: 'clamp' });
  const keepLabel = dx.interpolate({ inputRange: [0, SWIPE], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <>
      <Sheet
        visible={visible && confirming === null && prices.length > 0}
        title={`Same ${noun} ${prices.length > 2 ? `${prices.length} times` : 'twice'}`}
        subtitle={prices.length > 0 ? `${index + 1} of ${prices.length}` : null}
        onClose={onClose}
        closeLabel="Done"
      >
        {price ? (
          <Animated.View
            {...responder.panHandlers}
            style={[
              styles.card,
              Platform.OS === 'web' ? ({ touchAction: 'pan-y' } as object) : null,
              { transform: [{ translateX: dx }] },
            ]}
            testID="look-alike-card"
          >
            <View style={styles.swipeMarks} pointerEvents="none">
              <Animated.View style={{ opacity: keepLabel }}>
                <Text style={[styles.swipeMark, styles.keepMark]}>Keep</Text>
              </Animated.View>
              <Animated.View style={{ opacity: deleteLabel }}>
                <Text style={[styles.swipeMark, styles.deleteMark]}>Delete</Text>
              </Animated.View>
            </View>
            <Text style={styles.kind}>{isBill ? 'INVOICE' : 'QUOTE'}{kept.has(price.id) ? ' · KEPT' : ''}</Text>
            <Text style={styles.supplier}>{price.supplier ?? 'No supplier'}</Text>
            <Text style={[styles.amount, differ.has('amount') && styles.differs]}>
              {formatMoney(price.amountIncl) ?? 'No figure'}
            </Text>
            <View style={styles.facts}>
              {facts[index].map((fact) => (
                <View key={fact.name} style={styles.fact}>
                  <Text style={styles.factLabel}>{fact.label}</Text>
                  <Text
                    style={[styles.factValue, differ.has(fact.name) && styles.differs]}
                    accessibilityLabel={`${fact.label}: ${fact.value}${differ.has(fact.name) ? ', differs' : ''}`}
                  >
                    {fact.value}
                  </Text>
                </View>
              ))}
            </View>
            {price.documentPaths.map((path) => (
              <Pressable
                key={path}
                onPress={() => openDocument(path)}
                style={styles.file}
                accessibilityRole="link"
                accessibilityLabel={`Open ${documentName(path)}`}
              >
                <Text style={styles.fileName} numberOfLines={1}>{documentName(path)}</Text>
                <Text style={styles.fileOpen}>Open</Text>
              </Pressable>
            ))}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <View style={styles.action}>
                <Button
                  label="Delete"
                  variant="dangerOutline"
                  onPress={() => askDelete(price)}
                  disabled={busy}
                />
              </View>
              <View style={styles.action}>
                <Button
                  label="Keep"
                  onPress={() => keep(price)}
                  loading={busy && prices.every((p) => p.id === price.id || kept.has(p.id))}
                  disabled={busy}
                />
              </View>
            </View>
          </Animated.View>
        ) : null}

        {prices.length > 1 ? (
          <View style={styles.dots}>
            {prices.map((p, i) => (
              <Pressable
                key={p.id}
                onPress={() => { setIndex(i); dx.setValue(0); }}
                style={styles.dotTap}
                accessibilityRole="button"
                accessibilityLabel={`Show ${i + 1} of ${prices.length}`}
                accessibilityState={{ selected: i === index }}
              >
                <View style={[styles.dot, i === index && styles.dotOn]} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={visible && confirming !== null}
        title={confirming?.kind === 'invoice' ? 'Delete this invoice?' : 'Delete this quote?'}
        message={payments > 0 ? `${payments === 1 ? 'Its payment goes' : `Its ${payments} payments go`} with it.` : undefined}
        confirmLabel="Delete"
        destructive
        onCancel={() => { setConfirming(null); settle(); }}
        onConfirm={confirmDelete}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.xs,
    overflow: 'hidden',
  },
  swipeMarks: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing.lg,
  },
  swipeMark: { fontSize: Typography.base, fontWeight: Typography.semibold },
  keepMark: { color: Colors.primary },
  deleteMark: { color: Colors.danger },
  kind: { fontFamily: Fonts.mono, fontSize: Typography.xs, color: Colors.textMuted, letterSpacing: 1 },
  supplier: { fontSize: Typography.title3, fontWeight: Typography.semibold, color: Colors.textPrimary },
  amount: {
    fontSize: Typography.title1, fontWeight: Typography.bold, color: Colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  facts: { marginTop: Spacing.sm, gap: Spacing.sm },
  fact: { flexDirection: 'row', gap: Spacing.md },
  factLabel: {
    width: 64, flexShrink: 0, fontFamily: Fonts.mono, fontSize: Typography.xs,
    color: Colors.textMuted, paddingTop: 2,
  },
  factValue: { flex: 1, minWidth: 0, fontSize: Typography.base, color: Colors.textSecondary },
  differs: { color: Colors.textPrimary, fontWeight: Typography.bold },
  file: {
    minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.separator,
  },
  fileName: { flex: 1, minWidth: 0, fontSize: Typography.base, color: Colors.textPrimary },
  fileOpen: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.primary },
  error: { fontSize: Typography.sm, color: Colors.danger, marginTop: Spacing.sm },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md },
  action: { flex: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.sm },
  dotTap: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotOn: { backgroundColor: Colors.textPrimary },
});
