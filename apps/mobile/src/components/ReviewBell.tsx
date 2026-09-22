import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';

interface Props {
  /** Pending cards. At nought the bell is not drawn at all. */
  count: number;
  onPress: () => void;
}

/**
 * The one place in this app that tells you something without being asked.
 *
 * It is worth being careful about, because *no notifications, ever* is a rule
 * this product actually keeps — no email per snag, nothing that speaks unasked,
 * and a payment schedule that says out loud that it reminds nobody. This does
 * not break it: **it sends nothing anywhere**. It is a count of rows already on
 * the page somebody has just opened, in the corner of the page they are on, and
 * it is silent everywhere else. The distinction is between a screen saying what
 * it is holding and an app reaching for your attention when you are not looking
 * at it — and only the second one is the thing this product refuses to do.
 *
 * **Absent at nought**, which is the same rule as the shopping pill, *Fit* in
 * `PhotoViewer` and the supplier section: a bell with nothing behind it is a
 * control dressed as a choice, and one that is always there teaches people that
 * it never means anything.
 *
 * The count rides in a badge on the corner rather than inside the glyph,
 * because it is a number *about* the button rather than part of it — the
 * correction the list tab's cart already took. No new hue: fern, which is what
 * every other interaction in this app is drawn in, and the palette's four
 * colours stay spent on state.
 */
export default function ReviewBell({ count, onPress }: Props) {
  if (count <= 0) return null;

  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`You have ${count} object${count === 1 ? '' : 's'} to review`}
    >
      <Icon name="notifications-outline" size="lg" color={Colors.textPrimary} />
      <View style={styles.badge}>
        {/*
          Capped for width rather than for truth. The sheet behind it says the
          real number in words, so the badge only has to say "more than you are
          going to clear in one sitting" without pushing the header around.
        */}
        <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: Spacing.xs,
    borderRadius: Radius.avatar,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.surface,
  },
});
