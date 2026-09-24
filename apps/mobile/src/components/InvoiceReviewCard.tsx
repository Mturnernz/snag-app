import React, { useMemo, useRef, useState } from 'react';
import {
  Animated, PanResponder, Pressable, StyleSheet, Text, View,
} from 'react-native';

import Icon from './Icon';
import Button from './Button';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  describePaidInference, documentName, formatLooseDate, formatMoney, invoiceReviewHeadline, wasInferred,
} from '@snag/supabase-queries';
import {
  isHorizontalDrag, swipeDecision, swipeLean, swipeProgress, type SwipeDecision,
} from '../lib/swipeDecision';
import type { InvoiceReview } from '../types';

interface Props {
  review: InvoiceReview;
  onApprove: () => void;
  onDecline: () => void;
  /** Opens the card to correct what was read off the email before ruling on it. */
  onEdit?: () => void;
  /** While a decision is on the wire. The card stops taking gestures. */
  busy?: boolean;
  /**
   * Opens an attachment that came with the email. The card lists them because
   * the invoice itself is what every field on it has to be checked against.
   */
  onOpenFile?: (path: string) => void;
  /** Where allocating puts it — "Whole job", a room, or rooms and how they split. */
  landsOn?: string | null;
  /**
   * The sentence naming a bill this one looks like — already on the job, or a
   * card still waiting. The card still allocates: it is a warning, not a lock.
   */
  duplicate?: string | null;
  /** Opens the bill it looks like, when that bill is on the job. */
  onOpenDuplicate?: () => void;
}

/**
 * One bill that has arrived and not been ruled on.
 *
 * **It is a card you answer, not a form you fill in.** Everything on it was
 * read off an email and none of it counts yet — so the card's whole job is to
 * put the answer in front of somebody in one glance and take a yes or a no.
 *
 * Three rules, and the first two are the ones that make it honest:
 *
 * **A guessed field says so.** `inferred` names the columns the app filled in
 * rather than read, and each one renders with a dotted underline and the word
 * *guessed* beside it. A card that presents its guesses in the same voice as
 * its readings is a card somebody approves eleven of and regrets one — which is
 * the same argument `describeOverride` makes about never merely saying a figure
 * was edited, and `parseTradies` makes about dropping a tradesman with no
 * source. **An inference shown as a fact is the one thing this card must not
 * do.**
 *
 * **The paid answer carries the sentence it was drawn from.** Not "Paid" but
 * *"Paid — you replied 'this is now paid' on 7 Jul"*. The reader can disagree
 * with the evidence, which they cannot do with a tick.
 *
 * **There are buttons as well as a swipe**, and this is `PhotoViewer`'s rule
 * exactly: half the people who open this are in a desktop browser with a mouse
 * and no second finger, and a card whose only way to answer is a gesture that
 * device cannot make is a card that does nothing. The swipe is the fast path on
 * a phone, never the only one.
 *
 * Built on `PanResponder` rather than `react-native-gesture-handler`, for the
 * reason `PhotoViewer` gives: the latter is not a dependency, wants a root-view
 * wrapper on native, and would be a second animation runtime in a web export
 * that has already paid 490 KB for the PDF renderer. `PanResponder` is core
 * React Native, is implemented on react-native-web, and reports everything a
 * horizontal drag needs. **No new dependency; the bundle does not move.**
 *
 * **A card that looks like a bill already on the job says so above its
 * buttons** — the number, who from, the figure and the date of the one it
 * matches, and a way to open it. The same email forwarded twice, or a bill typed
 * in and then emailed in as well, is how one invoice got onto the live job three
 * times. Allocating still works: two progress claims for one figure are two
 * bills, and `findDuplicateBill` cannot tell that from the paper; the person
 * reading the card can.
 */
export default function InvoiceReviewCard({
  review, onApprove, onDecline, onEdit, busy, onOpenFile, landsOn, duplicate, onOpenDuplicate,
}: Props) {
  const pan = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const [lean, setLean] = useState<SwipeDecision | null>(null);
  const [progress, setProgress] = useState(0);

  // Read through refs rather than closed over: a `PanResponder` is created once
  // and would otherwise go on calling the first render's handlers for ever,
  // which on this card means approving whichever invoice was first in the deck.
  const state = useRef({ width, busy, onApprove, onDecline });
  state.current = { width, busy, onApprove, onDecline };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Never on start: the buttons underneath and the page's own scrolling
        // both need the touch first. A card that claims every touch is a page
        // that cannot be scrolled, which reads as the screen having frozen.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) =>
          !state.current.busy && isHorizontalDrag(g.dx, g.dy),

        onPanResponderMove: (_e, g) => {
          pan.setValue(g.dx);
          setLean(swipeLean(g.dx));
          setProgress(swipeProgress(g.dx, state.current.width));
        },

        onPanResponderRelease: (_e, g) => {
          const decision = swipeDecision(g.dx, state.current.width);

          if (!decision) {
            // Snap back and say nothing. A drag that did not clearly mean yes
            // or no asks again rather than guessing which was meant.
            Animated.spring(pan, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
            setLean(null);
            setProgress(0);
            return;
          }

          // It leaves the way it was pushed, and the write goes at the same
          // moment rather than after the animation: a card that waits for its
          // own exit before asking the server is a card that looks finished
          // while nothing has happened yet.
          Animated.timing(pan, {
            toValue: decision === 'approve' ? state.current.width : -state.current.width,
            duration: 160,
            useNativeDriver: true,
          }).start();

          if (decision === 'approve') state.current.onApprove();
          else state.current.onDecline();
        },

        onPanResponderTerminate: () => {
          Animated.spring(pan, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
          setLean(null);
          setProgress(0);
        },
      }),
    [pan]
  );

  const amount = review.amount === null
    ? 'Not priced'
    : `${formatMoney(review.amount)}${review.amountInclGst ? '' : ' + GST'}`;
  // The figure is the field a guess costs most on, and GST is a guess the
  // reader makes whenever a bill does not say — so either marks it.
  const amountGuessed = review.amount !== null
    && (wasInferred(review, 'amount') || wasInferred(review, 'amount_incl_gst'));
  const files = [
    ...review.documentPaths.map((path) => ({ path, label: documentName(path), icon: 'document-text-outline' as const })),
    ...review.photoPaths.map((path, i) => ({
      path, label: review.photoPaths.length > 1 ? `Photo ${i + 1}` : 'Photo', icon: 'image-outline' as const,
    })),
  ];

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {/*
        What the swipe is about to do, behind the card rather than on it. It is
        legible exactly when letting go would act — `swipeProgress` reaches one
        at the same distance `swipeDecision` starts saying yes, so the hint and
        the outcome cannot disagree about where the line is.
      */}
      <View style={styles.rails} pointerEvents="none">
        <View style={[styles.rail, styles.railYes, { opacity: lean === 'approve' ? progress : 0 }]}>
          <Icon name="checkmark-circle-outline" size="lg" color={Colors.primary} />
          <Text style={[styles.railLabel, { color: Colors.primary }]}>Allocate it</Text>
        </View>
        <View style={[styles.rail, styles.railNo, { opacity: lean === 'decline' ? progress : 0 }]}>
          <Text style={[styles.railLabel, { color: Colors.due.overdueFg }]}>Remove it</Text>
          <Icon name="close-circle-outline" size="lg" color={Colors.due.overdueFg} />
        </View>
      </View>

      <Animated.View
        {...responder.panHandlers}
        style={[styles.card, { transform: [{ translateX: pan }] }]}
        accessibilityLabel={`${invoiceReviewHeadline(review)}, ${amount}`}
      >
        <View style={styles.headRow}>
          <View style={styles.headText}>
            <Text style={styles.headline} numberOfLines={2}>
              {invoiceReviewHeadline(review)}
            </Text>
            {review.category ? (
              <View style={styles.categoryChip}>
                <Text style={styles.categoryText}>{review.category}</Text>
                {wasInferred(review, 'category') ? <Guessed /> : null}
              </View>
            ) : null}
          </View>
          {/*
            The figure does not shrink; the name beside it does. It is what the
            card is read for, and half a number is worse than a clipped noun —
            the rule a project's own item rows already follow.
          */}
          <View style={styles.amountCol}>
            <Text style={styles.amount} numberOfLines={1}>{amount}</Text>
            {amountGuessed ? <Guessed /> : null}
          </View>
        </View>

        {review.supplier && wasInferred(review, 'supplier') ? (
          <Text style={styles.guessed}>supplier guessed</Text>
        ) : null}

        {review.detail ? <Text style={styles.detail}>{review.detail}</Text> : null}

        <View style={styles.facts}>
          {review.invoiceNumber ? (
            <Fact label="Invoice" value={review.invoiceNumber} mono guessed={wasInferred(review, 'invoice_number')} />
          ) : null}
          {review.dated ? (
            <Fact label="Dated" value={formatLooseDate(review.dated) ?? review.dated} guessed={wasInferred(review, 'dated')} />
          ) : null}
          {review.dueOn ? (
            <Fact label="Due" value={formatLooseDate(review.dueOn) ?? review.dueOn} guessed={wasInferred(review, 'due_on')} />
          ) : null}
          {landsOn ? <Fact label="For" value={landsOn} /> : null}
        </View>

        {/*
          Never the flag on its own. The sentence it was read from is what lets
          somebody disagree with it, and a tick gives them nothing to disagree
          with.
        */}
        <View style={[styles.paidRow, review.paid ? styles.paidYes : styles.paidNo]}>
          <Icon
            name={review.paid ? 'checkmark-circle-outline' : 'ellipse-outline'}
            size="sm"
            color={review.paid ? Colors.status.done : Colors.status.doingFg}
          />
          <Text style={styles.paidText}>{describePaidInference(review)}</Text>
        </View>

        {onOpenFile && files.length > 0 ? (
          <View style={styles.files}>
            {files.map((file) => (
              <Pressable
                key={file.path}
                onPress={() => onOpenFile(file.path)}
                style={styles.file}
                accessibilityRole="button"
                accessibilityLabel={`Open ${file.label}`}
              >
                <Icon name={file.icon} size="sm" color={Colors.primary} />
                <Text style={styles.fileLabel} numberOfLines={1}>{file.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {review.sourceFrom || review.sourceAt ? (
          <Text style={styles.source} numberOfLines={1}>
            {[
              review.sourceFrom ? `from ${review.sourceFrom}` : null,
              review.sourceAt ? formatLooseDate(review.sourceAt.slice(0, 10)) : null,
            ].filter(Boolean).join(' · ')}
          </Text>
        ) : null}

        {duplicate ? (
          <View style={styles.duplicate} accessibilityLiveRegion="polite">
            <Icon name="copy-outline" size="sm" color={Colors.status.doingFg} />
            <View style={styles.duplicateBody}>
              <Text style={styles.duplicateText}>{duplicate}</Text>
              {onOpenDuplicate ? (
                <Pressable
                  onPress={onOpenDuplicate}
                  style={styles.duplicateOpen}
                  accessibilityRole="button"
                  accessibilityLabel="Open the bill it looks like"
                >
                  <Text style={styles.duplicateOpenLabel}>Open that one</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.actions}>
          {onEdit ? (
            <Pressable style={styles.edit} onPress={onEdit} accessibilityLabel="Correct this invoice">
              <Icon name="pencil-outline" size="sm" color={Colors.textMuted} />
            </Pressable>
          ) : null}
          {/*
            Two buttons, and only one of them is solid fern. Approving puts a
            bill on the job and moves the money; declining puts a card in a bin
            it can be taken back out of. The consequential one gets the brand's
            colour — the same asymmetry *Mark done* and *Save* already draw on
            the snag page.
          */}
          <Button label="Remove" variant="outline" onPress={onDecline} disabled={busy} style={styles.action} />
          <Button label="Allocate" variant="primary" onPress={onApprove} loading={busy} style={styles.action} />
        </View>
      </Animated.View>
    </View>
  );
}

/** The mark that keeps a guess from reading as a reading. */
function Guessed() {
  return <Text style={styles.guessed}>guessed</Text>;
}

function Fact({
  label, value, mono, guessed,
}: { label: string; value: string; mono?: boolean; guessed?: boolean }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, mono ? styles.factMono : null, guessed ? styles.factGuessed : null]}>
        {value}
      </Text>
      {guessed ? <Guessed /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  duplicate: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    marginTop: Spacing.sm, padding: Spacing.md, borderRadius: Radius.input,
    backgroundColor: Colors.status.doingBg,
  },
  duplicateBody: { flex: 1, minWidth: 0 },
  duplicateText: { fontSize: Typography.subhead, lineHeight: 20, color: Colors.textPrimary },
  duplicateOpen: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
  duplicateOpenLabel: { fontSize: Typography.subhead, fontWeight: Typography.semibold, color: Colors.primary },
  wrap: { position: 'relative' },
  rails: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
  },
  rail: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  railYes: { justifyContent: 'flex-start' },
  railNo: { justifyContent: 'flex-end' },
  railLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  // `minWidth: 0` because anything flexed beside a fixed-width sibling needs it
  // on web, where the intrinsic width wins otherwise and pushes the figure off
  // the card — the trap the thing page's spec sheet already paid for.
  headText: { flex: 1, minWidth: 0, gap: Spacing.xs },
  headline: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  amount: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    textAlign: 'right',
  },
  detail: { fontSize: Typography.sm, color: Colors.textSecondary },

  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  categoryText: { fontSize: Typography.xs, color: Colors.textSecondary },

  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  fact: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  factLabel: { fontSize: Typography.xs, color: Colors.textMuted },
  factValue: { fontSize: Typography.sm, color: Colors.textPrimary },
  factMono: { fontFamily: Fonts.mono },
  factGuessed: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    color: Colors.textSecondary,
  },
  guessed: { fontSize: Typography.xs, color: Colors.textMuted, fontStyle: 'italic' },

  paidRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  paidYes: { backgroundColor: Colors.status.doneBg },
  paidNo: { backgroundColor: Colors.status.doingBg },
  paidText: { flex: 1, minWidth: 0, fontSize: Typography.xs, color: Colors.textSecondary },

  source: { fontSize: Typography.xs, color: Colors.textMuted },
  amountCol: { alignItems: 'flex-end' },
  files: { gap: 2 },
  file: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET, alignSelf: 'flex-start',
  },
  fileLabel: { fontSize: Typography.sm, color: Colors.primary, flexShrink: 1 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  action: { flex: 1 },
  edit: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
