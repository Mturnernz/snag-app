import React, { useEffect, useRef } from 'react';
import { Animated, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Typography, Shadow, MIN_TOUCH_TARGET } from '../constants/theme';

interface Props {
  message: string;
  visible: boolean;
  /** A single thing to press — "Undo" — and only while the toast is up. */
  actionLabel?: string;
  onAction?: () => void;
}

export default function Toast({ message, visible, actionLabel, onAction }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 20, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Animated.View
      style={[styles.toast, { opacity, transform: [{ translateY }] }]}
      // An invisible toast must not swallow taps meant for what is under it.
      pointerEvents={visible && onAction ? 'box-none' : 'none'}
    >
      <Text style={styles.text}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    backgroundColor: Colors.textPrimary,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    maxWidth: '92%',
    ...Shadow.lg,
  },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  // White and underlined rather than a hue: the toast is ink, and the palette
  // has no colour that reads on ink without being spent on a state.
  actionLabel: {
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
    textDecorationLine: 'underline',
  },
  text: {
    flexShrink: 1,
    color: Colors.white,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
});
