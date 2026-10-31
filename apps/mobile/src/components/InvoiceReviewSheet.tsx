import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import Icon from './Icon';
import Button from './Button';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  declinedReviews, formatLooseDate, formatMoney, invoiceReviewHeadline,
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
 * The removed cards, opened from the *N removed* line under the waiting ones.
 *
 * **The bin is the whole reason this sheet exists.** Swiping a card left is a
 * judgement made in about a second, which makes it the judgement most likely to
 * be wrong — so declining is a state rather than a delete and this is where the
 * mistakes are found. Without somewhere to look, the cheapest gesture on the
 * screen would also be the only irreversible one.
 *
 * **It holds only what was removed.** It used to open from a bell that also
 * counted what was waiting, and it said that count again — a third telling of
 * cards already on the page. The bell went (it hid itself when nothing was
 * waiting, which took the bin with it), and the line that opens this is there
 * whenever anything has been removed.
 *
 * **Deleting for good is a second, quieter control.** Restoring is the offer
 * this sheet is making and it gets the button; the × beside it is the one that
 * cannot be undone, and the two must not look alike — the same split Profile
 * draws between *Sign out* and *Delete account*.
 */
export default function InvoiceReviewSheet({
  visible, reviews, onClose, onRestore, onDelete, busyId,
}: Props) {
  const removed = declinedReviews(reviews);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Removed</Text>
            <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Close">
              <Icon name="close" size="lg" color={Colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
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
                        review.kind === 'paperwork' ? 'Paperwork'
                          : review.amount === null ? 'Not priced' : formatMoney(review.amount),
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
    backgroundColor: Colors.scrim,
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
