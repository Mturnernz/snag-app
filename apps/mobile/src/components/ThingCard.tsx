import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';

import Icon from './Icon';
import { Colors, Fonts, Radius, Shadow, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { Thing, ThingKind, ThingSuggestion } from '../types';
import { describeCycle, swatchColour, thingDetailLine, thingHeadline } from '@snag/supabase-queries';

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
  // A dishwasher is not a circuit board. Generic on purpose: the icon says
  // "a thing in the house", and the model number below it says which.
  appliance: 'cube-outline',
  finish: 'color-palette-outline',
  tile: 'grid-outline',
  fitting: 'bulb-outline',
  fabric: 'home-outline',
  contact: 'call-outline',
};

interface Props {
  thing: Thing;
  photoUrl?: string | null;
  onPress: () => void;
  /** A label reading waits on this thing's page. Said, not coloured: it is a prompt, not a state. */
  labelToCheck?: boolean;
}

export default function ThingCard({ thing, photoUrl, onPress, labelToCheck }: Props) {
  const detail = thingDetailLine(thing);
  const consumable = thing.consumables[0];
  // A paint's own colour, when it has one this can draw. Not a breach of the
  // palette rule: the palette is what the *app* spends colour on, and this is
  // the record's data — the same as a photograph of the tin would be.
  const swatch = thing.kind === 'finish' ? swatchColour(thing.spec) : null;

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
        <View style={styles.titleRow}>
          {swatch ? (
            <View
              style={[styles.swatch, { backgroundColor: swatch }]}
              accessibilityLabel={`Swatch ${swatch}`}
            />
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {thingHeadline(thing)}
          </Text>
        </View>
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}

        {/* A paint's note is what tells two of them apart — Half Spanish White
            on the main wall, Quarter Alabaster on the windows — so for a finish
            it earns a line rather than sitting behind a tap. No other kind gets
            one: an appliance's note is not what distinguishes it from the
            appliance beside it. */}
        {thing.kind === 'finish' && thing.notes ? (
          <Text style={styles.note} numberOfLines={1}>{thing.notes}</Text>
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
          {labelToCheck ? <Text style={styles.snags}>Label to check</Text> : null}
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
    // Centred, not stretched: a thing recorded from the walkthrough with no
    // model yet is a single line of text, and top-aligning it against a 44px
    // thumbnail leaves it floating above a gap.
    alignItems: 'center',
    gap: Spacing.md,
    // V2: a recorded thing is white on plaster with no outline, which is also
    // what keeps it apart from a ghost — the ghost is the only dashed edge.
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  // A hairline edge on purpose: most paint is a white, and a white circle on a
  // white card is not there at all.
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  title: {
    flexShrink: 1,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  detail: {
    fontFamily: Fonts.mono,
    fontSize: Typography.sm,
    color: Colors.textSecondary,
  },
  note: { fontSize: Typography.sm, color: Colors.textSecondary },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: 2 },
  ghost: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    // No surface and no shadow. On a plaster ground a white card is an object;
    // a ghost is the absence of one.
    backgroundColor: 'transparent',
    paddingLeft: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  ghostTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  // Deliberately lighter than a ThingCard, not merely different from one: a
  // room with six unrecorded things was six full-size dashed cards, and a
  // tab-length wall of grey is the "reads as homework" failure this design's
  // whole argument has to survive. A ghost has no thumbnail and no second line
  // of its own weight, so it is about two-thirds the height of a record — the
  // distinction is carried by size as well as by style and words.
  ghostTitle: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  ghostNote: { fontSize: Typography.xs, color: Colors.textMuted },
  ghostDismiss: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  service: { fontSize: Typography.xs, color: Colors.status.doing },
  consumable: { fontSize: Typography.xs, color: Colors.textMuted, flexShrink: 1 },
  snags: { fontSize: Typography.xs, color: Colors.status.open },
});


/**
 * What a room probably has, and hasn't got recorded yet.
 *
 * Deliberately built from the same measurements as `ThingCard` and deliberately
 * not mistakable for one. Dashed rather than solid, transparent rather than
 * white, and it says *Not recorded yet* in words — because the entire argument
 * for putting these on screen collapses the moment somebody reads one as a
 * record. The × is a second control, not a corner of the first: dismissing
 * "no dryer here" and opening the walkthrough are opposite intentions and must
 * not share a tap target.
 */
export function GhostCard({
  suggestion, onPress, onDismiss,
}: {
  suggestion: ThingSuggestion;
  onPress: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.ghost}>
      <Pressable
        onPress={onPress}
        style={styles.ghostTap}
        accessibilityRole="button"
        accessibilityLabel={`Add the ${suggestion.name.toLowerCase()}`}
      >
        <Icon name="add" size="sm" color={Colors.textMuted} />
        <View style={styles.body}>
          <Text style={styles.ghostTitle} numberOfLines={1}>{suggestion.name}</Text>
          <Text style={styles.ghostNote}>Not recorded yet</Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onDismiss}
        style={styles.ghostDismiss}
        accessibilityRole="button"
        accessibilityLabel={`No ${suggestion.name.toLowerCase()} here`}
      >
        <Icon name="close" size="sm" color={Colors.textMuted} />
      </Pressable>
    </View>
  );
}
