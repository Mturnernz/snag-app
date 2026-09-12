import React, { useEffect } from 'react';
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

const DISABLED_OPACITY = 0.5;
const PRESSED_OPACITY = 0.85;

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'dangerOutline';

// Only the filled CTA gets the press-scale + haptic treatment —
// outline/ghost/secondary/danger read as secondary actions, not the primary
// "this responds to you" moment the warmth pass is after.
const CTA_VARIANTS = new Set<Variant>(['primary']);

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
};

// A disabled filled button goes neutral rather than faded.
//
// Dimming a filled button dims its hue too: fern at half strength on a plaster
// ground is a pale sage that reads as a broken button rather than as one that
// isn't ready yet, and white-on-pale-sage fails contrast on the way past. The
// palette's own rule settles it — colour is spent on state, and "not yet" is
// not a state worth colouring. Muted on sunken measures 5.31:1, so the label
// stays readable, which a 50% wash never was.
const DISABLED_FILL = { bg: Colors.sunken, text: Colors.textMuted };
const FILLED_VARIANTS = new Set<Variant>(['primary', 'secondary', 'danger']);

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
  const isDisabled = disabled || loading;
  const isCta = CTA_VARIANTS.has(variant);
  // Loading keeps its own colours: the spinner is the feedback, and swapping the
  // button to grey mid-press reads as the action having failed.
  const neutralised = disabled && !loading && FILLED_VARIANTS.has(variant);
  const cfg = neutralised ? { ...VARIANT_STYLES[variant], ...DISABLED_FILL } : VARIANT_STYLES[variant];

  // CTA variants (primary/serious) get a spring scale down; every variant
  // keeps the old opacity dip so non-CTA buttons don't lose press feedback.
  //
  // The disabled dimming lives in this shared value rather than in a static
  // style. Reanimated writes the animated style straight onto the view, so a
  // later `styles.disabled` entry in the style array was silently overwritten
  // by opacity: 1 — every disabled button in the app rendered at full strength
  // with pointer events off, looking completely actionable and doing nothing.
  const scale = useSharedValue(1);
  const restingOpacity = isDisabled && !neutralised ? DISABLED_OPACITY : 1;
  const opacity = useSharedValue(restingOpacity);

  useEffect(() => {
    opacity.value = withSpring(restingOpacity, { damping: 16, stiffness: 300 });
  }, [restingOpacity, opacity]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  function handlePressIn() {
    if (isDisabled) return;
    opacity.value = withSpring(PRESSED_OPACITY, { damping: 16, stiffness: 300 });
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
});
