import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET, Shadow } from '../constants/theme';
import Icon from './Icon';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'dangerOutline' | 'serious';

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

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: cfg.bg },
        cfg.border ? { borderWidth: 1, borderColor: cfg.border } : null,
        cfg.shadow && !isDisabled ? Shadow.sm : null,
        fullWidth ? styles.fullWidth : null,
        isDisabled ? styles.disabled : null,
        pressed && !isDisabled ? styles.pressed : null,
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
    </Pressable>
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
  pressed: {
    opacity: 0.85,
  },
});
