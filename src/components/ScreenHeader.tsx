import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import Icon from './Icon';

interface Props {
  title: string;
  tone?: 'default' | 'serious';
  onBack?: () => void;
  rightSlot?: React.ReactNode;
}

export default function ScreenHeader({ title, tone = 'default', onBack, rightSlot }: Props) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const serious = tone === 'serious';

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + Spacing.sm },
        serious ? styles.seriousContainer : styles.defaultContainer,
      ]}
    >
      <TouchableOpacity
        style={styles.backButton}
        onPress={onBack ?? (() => navigation.goBack())}
        hitSlop={8}
      >
        <Icon name="arrow-back" size="lg" color={serious ? Colors.white : Colors.textPrimary} />
      </TouchableOpacity>
      <Text style={[styles.title, serious && styles.seriousTitle]} numberOfLines={1}>
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
  seriousContainer: {
    backgroundColor: Colors.serious,
    borderBottomColor: Colors.serious,
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
  seriousTitle: {
    color: Colors.white,
  },
  rightSlot: {
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
