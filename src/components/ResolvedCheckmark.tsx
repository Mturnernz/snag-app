import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { Colors, Spacing, Typography } from '../constants/theme';
import Icon from './Icon';

// Niggle-lane resolution moment — a small, restrained "nice, sorted" beat,
// not an achievement-unlocked celebration. Scales/fades in once on mount;
// the parent (ManageIssuePanel) is responsible for mounting/unmounting it.
export default function ResolvedCheckmark() {
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(1, { damping: 12, stiffness: 180 });
    opacity.value = withTiming(1, { duration: 200 });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.row, animatedStyle]}>
      <Icon name="checkmark-circle" size="md" color={Colors.success} />
      <Animated.Text style={styles.label}>Sorted</Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'center',
  },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.success,
  },
});
