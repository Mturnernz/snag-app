import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from './Text';
import SignedImage from './SignedImage';
import Icon from './Icon';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography } from '../constants/theme';
import { snagHeadline } from '@snag/supabase-queries';
import type { Snag } from '../types';

export const PHOTO_CARD_WIDTH = 176;
export const PHOTO_CARD_HEIGHT = 220;

interface Props {
  snag: Snag;
  photoUrl?: string | null;
  /** Who it is news from — "Sam" — or null. */
  from: string | null;
  /** Notes somebody else has written since the last visit. */
  newNotes: number;
  /** Whether the job itself is new, rather than only a note on it. */
  isNewJob: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}

/**
 * **News gets the glass.** What the other person added since you last looked
 * arrives as a large photograph, 176 × 220 at the top of the list — the
 * photograph is the job — with its words on a shade at the foot. Everything
 * else is a quiet row (`SnagCard`).
 *
 * A job with no photograph is a card of words on the well, never an empty
 * frame. A job that is only news because of a note says so: *2 new notes*,
 * rather than claiming the job itself is new.
 */
export default function PhotoCard({
  snag, photoUrl, from, newNotes, isNewJob, onPress, onLongPress,
}: Props) {
  const headline = snagHeadline(snag);
  const why = isNewJob
    ? (from ? `Added by ${from}` : 'Added')
    : newNotes === 1 ? 'New note' : `${newNotes} new notes`;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${headline}${snag.room ? `, ${snag.room}` : ''}, ${why}`}
    >
      {photoUrl ? (
        <>
          <SignedImage uri={photoUrl} style={StyleSheet.absoluteFill} resizeMode="cover" />
          {/* The shade under the words, eased in over three steps rather
              than a gradient, which would be a dependency for one card. */}
          <View style={styles.shade} pointerEvents="none">
            <View style={[styles.shadeStep, { opacity: 0.25 }]} />
            <View style={[styles.shadeStep, { opacity: 0.6 }]} />
            <View style={[styles.shadeFoot]} />
          </View>
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.wordsGround]}>
          <Icon name="chatbubble-outline" size="lg" color={Colors.textMuted} />
        </View>
      )}
      <View style={styles.foot}>
        <Text style={[styles.why, !photoUrl && styles.whyInk]} numberOfLines={1}>{why}</Text>
        <Text style={[styles.headline, !photoUrl && styles.headlineInk]} numberOfLines={3}>
          {headline}
        </Text>
        {snag.room ? (
          <Text style={[styles.room, !photoUrl && styles.roomInk]} numberOfLines={1}>{snag.room}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: PHOTO_CARD_WIDTH,
    height: PHOTO_CARD_HEIGHT,
    borderRadius: Radius.photo,
    overflow: 'hidden',
    backgroundColor: Colors.well,
    justifyContent: 'flex-end',
    ...Shadow.photo,
  },
  pressed: { opacity: 0.85 },
  wordsGround: { padding: Spacing.lg, alignItems: 'flex-start' },
  shade: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  shadeStep: { height: 28, backgroundColor: Colors.photoShade },
  shadeFoot: { height: '45%', backgroundColor: Colors.photoShade },
  foot: { padding: Spacing.md, gap: 2 },
  why: {
    fontFamily: Fonts.mono,
    fontSize: Typography.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.white,
  },
  whyInk: { color: Colors.primary },
  headline: {
    fontSize: Typography.subhead,
    lineHeight: 20,
    fontWeight: Typography.bold,
    color: Colors.white,
  },
  headlineInk: { color: Colors.textPrimary },
  room: {
    fontFamily: Fonts.mono,
    fontSize: Typography.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.85)',
  },
  roomInk: { color: Colors.textMuted },
});
