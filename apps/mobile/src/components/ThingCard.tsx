import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';

import Icon from './Icon';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { Thing, ThingKind } from '../types';
import { describeCycle, thingDetailLine, thingHeadline } from '@snag/supabase-queries';

/**
 * One thing in the house record.
 *
 * **The card shows the answer, not the name.** "Heat pump" is what somebody
 * already knew when they opened this tab; `MSZ-AP50VGK` is what they came for.
 * So the model number gets the mono face and a line of its own, and the name —
 * when there is one — is the smaller thing above it. A card that doesn't answer
 * the question you arrived with costs a tap for nothing, and this tab's whole
 * argument is that it pays out in the moment you are standing somewhere else.
 *
 * No new colour. Kind is an outline icon and nothing more: the palette's four
 * hues are spent on state, and a thing has no state. The one badge that can
 * appear is a service reminder, in brass, on the same reasoning as a due date.
 */

const KIND_ICONS: Record<ThingKind, React.ComponentProps<typeof Icon>['name']> = {
  appliance: 'hardware-chip-outline',
  finish: 'color-palette-outline',
  fitting: 'bulb-outline',
  fabric: 'home-outline',
  contact: 'call-outline',
};

interface Props {
  thing: Thing;
  photoUrl?: string | null;
  onPress: () => void;
}

export default function ThingCard({ thing, photoUrl, onPress }: Props) {
  const detail = thingDetailLine(thing);
  const consumable = thing.consumables[0];

  return (
    <Pressable
      onPress={onPress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={thingHeadline(thing)}
    >
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Icon name={KIND_ICONS[thing.kind]} size="md" color={Colors.textMuted} />
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {thingHeadline(thing)}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}

        <View style={styles.meta}>
          {thing.serviceDays ? (
            <Text style={styles.service}>Every {describeCycle(thing.serviceDays)}</Text>
          ) : null}
          {/* Named, never counted: what the trip is for is the name of the
              part. A count tells you nothing you can buy. */}
          {consumable ? (
            <Text style={styles.consumable} numberOfLines={1}>
              Takes {consumable}
              {thing.consumables.length > 1 ? ` +${thing.consumables.length - 1}` : ''}
            </Text>
          ) : null}
          {thing.openSnagCount > 0 ? (
            <Text style={styles.snags}>
              {thing.openSnagCount} on the list
            </Text>
          ) : null}
        </View>
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
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    ...Shadow.sm,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  title: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  detail: {
    fontFamily: Fonts.mono,
    fontSize: Typography.sm,
    color: Colors.textSecondary,
  },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: 2 },
  service: { fontSize: Typography.xs, color: Colors.status.doing },
  consumable: { fontSize: Typography.xs, color: Colors.textMuted, flexShrink: 1 },
  snags: { fontSize: Typography.xs, color: Colors.status.open },
});
