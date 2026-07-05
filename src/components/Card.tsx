import React from 'react';
import { View, ViewStyle, StyleProp, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Shadow } from '../constants/theme';

type Variant = 'elevated' | 'outlined' | 'flat';

interface Props {
  children: React.ReactNode;
  variant?: Variant;
  elevation?: keyof typeof Shadow;
  style?: StyleProp<ViewStyle>;
  /** Tints the card with a subtle accent border/background — used for the
   *  serious/incident lane's visual identity. */
  accentColor?: string;
  accentBg?: string;
}

export default function Card({
  children,
  variant = 'outlined',
  elevation = 'sm',
  style,
  accentColor,
  accentBg,
}: Props) {
  return (
    <View
      style={[
        styles.base,
        variant === 'elevated' && Shadow[elevation],
        variant === 'outlined' && styles.outlined,
        accentColor ? { borderWidth: 1, borderColor: accentColor } : null,
        accentBg ? { backgroundColor: accentBg } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
  },
  outlined: {
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
