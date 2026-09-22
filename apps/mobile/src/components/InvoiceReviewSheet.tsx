import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Icon from './Icon';
import Button from './Button';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  declinedReviews, formatLooseDate, formatMoney, invoiceReviewHeadline, pendingReviews, reviewAlert,
} from '@snag/supabase-queries';
import type { InvoiceReview } from '../types';

interface Props {
  visible: boolean;
  reviews: InvoiceReview[];
  onClose: () => void;
  onRestore: (review: InvoiceReview) => void;
  onDelete: (review: InvoiceReview) => void;
  /** The id of whichever row has a write on the wire. */
  busyId?: string | null;
}

/**
 * What the bell opens: how much is waiting, and everything that was thrown
 * away.
 *
 * **The bin is the whole reason this sheet exists.** Swiping a card left is a
 * judgement made in about a second, which makes it the judgement most likely to
 * be wrong — so declining is a state rather than a delete and this is where the
 * mistakes are found. Without somewhere to look, the cheapest gesture on the
 * screen would also be the only irreversible one.
 *
 * Two rules about what it says:
 *
 * **The count is pending only.** The bin is reached through the same bell, but
 * a removed card is not something to review — it has been ruled on. Counting it
 * would make the number climb as somebody cleared the deck, which is the screen
 * contradicting the work being done to it.
 *
 * **Deleting for good is a second, quieter control.** Restoring is the offer
 * this sheet is making and it gets the button; the × beside it is the one that
 * cannot be undone, and the two must not look alike — the same split Profile
 * draws between *Sign out* and *Delete account*.
 */
export default function InvoiceReviewSheet({
  visible, reviews, onClose, onRestore, onDelete, busyId,
}: Props) {
  const waiting = pendingReviews(reviews);
  const removed = declinedReviews(reviews);
  const alert = reviewAlert(reviews);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Invoices</Text>
            <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Close">
              <Icon name="close" size="lg" color={Colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {/*
              The same sentence the bell is counting, said in full. It is absent
              at nought rather than reading "0 objects", on the shopping pill's
              own rule — but the line under it still explains why, because an
              empty sheet with nothing on it reads as one that failed to load.
            */}
            <Text style={styles.alert}>{alert ?? 'Nothing waiting to be reviewed'}</Text>
            <Text style={styles.alertHint}>
              {waiting.length > 0
                ? 'Swipe right to allocate one to the job, left to remove it. Removed ones come back here.'
                : 'Anything you remove is kept here, in case that was a mistake.'}
            </Text>

            <View style={styles.rule} />

            <Text style={styles.sectionHeading}>
              Removed{removed.length > 0 ? ` · ${removed.length}` : ''}
            </Text>

            {removed.length === 0 ? (
              <Text style={styles.empty}>Nothing has been removed.</Text>
            ) : (
              removed.map((review) => (
                <View key={review.id} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {invoiceReviewHeadline(review)}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {[
                        review.amount === null ? 'Not priced' : formatMoney(review.amount),
                        review.category,
                        review.decidedAt
                          ? `removed ${formatLooseDate(review.decidedAt.slice(0, 10))}`
                          : null,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                    {review.invoiceNumber ? (
                      <Text style={styles.rowRef}>{review.invoiceNumber}</Text>
                    ) : null}
                  </View>

                  <Button
                    label="Put it back"
                    variant="outline"
                    onPress={() => onRestore(review)}
                    loading={busyId === review.id}
                    style={styles.restore}
                  />
                  {/*
                    Quieter than the offer beside it, and deliberately a glyph
                    rather than a word: this is the one thing in the sheet that
                    does not come back.
                  */}
                  <Pressable
                    style={styles.forGood}
                    onPress={() => onDelete(review)}
                    accessibilityLabel={`Delete ${invoiceReviewHeadline(review)} for good`}
                  >
                    <Icon name="trash-outline" size="sm" color={Colors.textMuted} />
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '85%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    ...Shadow.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing.xl,
    paddingRight: Spacing.sm,
    paddingTop: Spacing.lg,
  },
  title: { flex: 1, fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: Spacing.xl, paddingTop: Spacing.sm, gap: Spacing.sm },

  alert: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  alertHint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },

  rule: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },

  sectionHeading: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  empty: { fontSize: Typography.sm, color: Colors.textMuted },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: Typography.base, color: Colors.textPrimary },
  rowMeta: { fontSize: Typography.xs, color: Colors.textMuted },
  rowRef: { fontSize: Typography.xs, fontFamily: Fonts.mono, color: Colors.textSecondary },
  restore: { minWidth: 112 },
  forGood: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
