import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import Icon from './Icon';

interface Props {
  title: string;
  /** Where the thing is, under its name. One line, and it truncates. */
  subtitle?: string;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
}

export default function ScreenHeader({ title, subtitle, onBack, rightSlot }: Props) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + Spacing.sm },
        styles.defaultContainer,
      ]}
    >
      <TouchableOpacity
        style={styles.backButton}
        onPress={onBack ?? (() => navigation.goBack())}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Icon name="chevron-back" size={26} color={Colors.primary} />
      </TouchableOpacity>
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.rightSlot}>{rightSlot}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  // V2: the navigation bar is the screen's own plaster, divided by a hairline
  // rather than a white strip with a border.
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
  },
  defaultContainer: {
    backgroundColor: Colors.background,
    borderBottomColor: Colors.separator,
  },
  backButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: { flex: 1 },
  title: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  subtitle: { fontSize: Typography.footnote, color: Colors.textMuted },
  rightSlot: {
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
