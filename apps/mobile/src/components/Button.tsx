import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  StyleProp,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET, Shadow } from '../constants/theme';
import Icon from './Icon';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'dangerOutline' | 'serious' | 'seriousOutline';

// Only the two filled CTA variants get the press-scale + haptic treatment —
// outline/ghost/secondary/danger read as secondary actions, not the primary
// "this responds to you" moment the warmth pass is after.
const CTA_VARIANTS = new Set<Variant>(['primary', 'serious']);

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: React.ComponentProps<typeof Icon>['name'];
  style?: StyleProp<ViewStyle>;
}

const VARIANT_STYLES: Record<Variant, { bg: string; text: string; border?: string; shadow?: boolean }> = {
  primary: { bg: Colors.primary, text: Colors.white, shadow: true },
  secondary: { bg: Colors.primaryLight, text: Colors.primary },
  outline: { bg: 'transparent', text: Colors.textPrimary, border: Colors.border },
  ghost: { bg: 'transparent', text: Colors.primary },
  danger: { bg: Colors.danger, text: Colors.white, shadow: true },
  dangerOutline: { bg: 'transparent', text: Colors.danger, border: Colors.danger },
  serious: { bg: Colors.serious, text: Colors.white, shadow: true },
  seriousOutline: { bg: 'transparent', text: Colors.serious, border: Colors.serious },
};

export default function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
  style,
}: Props) {
  const cfg = VARIANT_STYLES[variant];
  const isDisabled = disabled || loading;
  const isCta = CTA_VARIANTS.has(variant);

  // CTA variants (primary/serious) get a spring scale down; every variant
  // keeps the old opacity dip so non-CTA buttons don't lose press feedback.
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  function handlePressIn() {
    if (isDisabled) return;
    opacity.value = withSpring(0.85, { damping: 16, stiffness: 300 });
    if (isCta) scale.value = withSpring(0.96, { damping: 16, stiffness: 300 });
  }

  function handlePressOut() {
    if (isDisabled) return;
    opacity.value = withSpring(1, { damping: 16, stiffness: 300 });
    if (isCta) scale.value = withSpring(1, { damping: 16, stiffness: 300 });
  }

  function handlePress() {
    if (isCta && !isDisabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  }

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isDisabled}
      style={[
        animatedStyle,
        styles.base,
        { backgroundColor: cfg.bg },
        cfg.border ? { borderWidth: 1, borderColor: cfg.border } : null,
        cfg.shadow && !isDisabled ? Shadow.sm : null,
        fullWidth ? styles.fullWidth : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={cfg.text} />
      ) : (
        <>
          {icon ? <Icon name={icon} size="md" color={cfg.text} /> : null}
          <Text style={[styles.label, { color: cfg.text }]}>{label}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  label: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  disabled: {
    opacity: 0.5,
  },
});
