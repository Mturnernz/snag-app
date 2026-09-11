import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import Icon from './Icon';

interface Props {
  title: string;
  onBack?: () => void;
  rightSlot?: React.ReactNode;
}

export default function ScreenHeader({ title, onBack, rightSlot }: Props) {
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
      >
        <Icon name="arrow-back" size="lg" color={Colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.rightSlot}>{rightSlot}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
  },
  defaultContainer: {
    backgroundColor: Colors.surface,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  rightSlot: {
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
