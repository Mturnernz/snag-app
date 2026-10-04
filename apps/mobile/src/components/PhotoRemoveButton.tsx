import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import Icon from './Icon';
import { Colors, MIN_TOUCH_TARGET } from '../constants/theme';

interface Props {
  onPress: () => void;
  disabled?: boolean;
}

/**
 * The × in a photo tile's top-right corner, on a job's strip and a thing's.
 * One component, so the two pages cannot come to remove a photo two ways.
 *
 * It is a **sibling** of the photo's own door, laid over its corner, never a
 * child of it: a Pressable inside a Pressable is a coin toss about which one
 * gets the tap. Put it after the door inside a `position: relative` cell.
 *
 * The tap area is the full 48pt box and the visible dot is 28px inside it.
 * It was a 28px Pressable on the thing page, and `hitSlop` would not have
 * helped: react-native-web ignores it, so the corner of a photo was a small
 * target on the build people install. White on the photo scrim, because a
 * photo is not a ground a colour can be chosen against.
 *
 * It removes at once and the toast offers *Undo* — see `lib/photoEdits.ts`.
 */
export default function PhotoRemoveButton({ onPress, disabled = false }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={styles.tap}
      accessibilityRole="button"
      accessibilityLabel="Remove this photo"
    >
      <View style={styles.dot}>
        <Icon name="close" size="sm" color={Colors.white} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tap: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.photoOverlay,
  },
});
