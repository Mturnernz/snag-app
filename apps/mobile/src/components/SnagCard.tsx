import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import Icon from './Icon';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';
import DueBadge from './DueBadge';
import { Colors, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { Snag } from '../types';
import { snagHeadline, unboughtParts } from '@snag/supabase-queries';

interface Props {
  snag: Snag;
  photoUrl?: string | null;
  onPress: () => void;
}

/**
 * The photo is the point, not decoration.
 *
 * Twelve jobs with thumbnails is a Saturday morning you can act on; twelve
 * lines of text is a chore list you skim and close. So the image gets real
 * space and the metadata is a single wrapping row underneath rather than a
 * stack of labelled fields.
 */
export default function SnagCard({ snag, photoUrl, onPress }: Props) {
  const done = snag.status === 'done';
  // No title field exists: a photo-only snag is named by where it is.
  const headline = snagHeadline(snag);
  const toGet = unboughtParts(snag);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, done && styles.doneCard]}
      accessibilityRole="button"
      accessibilityLabel={`${headline}${snag.room ? `, ${snag.room}` : ''}`}
    >
      <View style={styles.thumb}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.noPhoto}>
            <Icon name="image-outline" size="lg" color={Colors.textMuted} />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text
          style={[
            styles.title,
            done && styles.doneTitle,
            !snag.description && styles.titleImplied,
          ]}
          numberOfLines={2}
        >
          {headline}
        </Text>

        {snag.room ? (
          <View style={styles.roomRow}>
            <Icon name="location-outline" size="sm" color={Colors.textMuted} />
            <Text style={styles.room}>{snag.room}</Text>
          </View>
        ) : null}

        <View style={styles.badges}>
          <StatusBadge status={snag.status} />
          <PriorityBadge priority={snag.priority} />
          <DueBadge snag={snag} />
          {/* What is still to get, never what was listed: a card claiming it
              needs the seal you bought on Saturday is a card you stop
              believing. The pill goes when the trip is done. */}
          {toGet.length > 0 ? (
            <View style={styles.parts}>
              <Icon name="cart-outline" size="sm" color={Colors.effort.fg} />
              <Text style={styles.partsLabel}>
                {toGet.length === 1 ? toGet[0] : `${toGet.length} things to get`}
              </Text>
            </View>
          ) : null}
        </View>

        {snag.assigneeName || snag.commentCount > 0 ? (
          <View style={styles.footer}>
            {snag.assigneeName ? (
              <View style={styles.footerItem}>
                <Icon name="person-outline" size="sm" color={Colors.textMuted} />
                <Text style={styles.footerText}>{snag.assigneeName}</Text>
              </View>
            ) : null}
            {snag.commentCount > 0 ? (
              <View style={styles.footerItem}>
                <Icon name="chatbubble-outline" size="sm" color={Colors.textMuted} />
                <Text style={styles.footerText}>{snag.commentCount}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    ...Shadow.sm,
  },
  pressed: { opacity: 0.7 },
  doneCard: { opacity: 0.62 },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: Radius.button,
    overflow: 'hidden',
    backgroundColor: Colors.background,
  },
  image: { width: '100%', height: '100%' },
  noPhoto: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: Spacing.xs },
  title: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  doneTitle: { textDecorationLine: 'line-through', color: Colors.textSecondary },
  // A headline the app supplied rather than one somebody wrote. Lighter, so
  // the eye goes to the photograph — which is the actual report.
  titleImplied: { fontWeight: Typography.medium, color: Colors.textSecondary },
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  room: { fontSize: Typography.sm, color: Colors.textMuted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs / 2 },
  // Named rather than counted when there is only one: "Hinge" tells you what
  // the trip is for, which "Parts" never did.
  parts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs / 2,
    borderRadius: Radius.chip,
    backgroundColor: Colors.effort.bg,
    alignSelf: 'flex-start',
  },
  partsLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
    color: Colors.effort.fg,
  },
  footer: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xs / 2 },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  footerText: { fontSize: Typography.sm, color: Colors.textMuted },
});
