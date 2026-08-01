import React from 'react';
import { View, ViewStyle, StyleProp, StyleSheet, LayoutChangeEvent } from 'react-native';
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
  /** Where this card ended up. Needed by anything that has to scroll one into
   *  view — see IssueDetailScreen's openStep. */
  onLayout?: (event: LayoutChangeEvent) => void;
}

export default function Card({
  children,
  variant = 'outlined',
  elevation = 'sm',
  style,
  accentColor,
  accentBg,
  onLayout,
}: Props) {
  return (
    <View
      onLayout={onLayout}
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
