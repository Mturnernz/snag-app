import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import Icon from './Icon';

interface Props {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export default function CollapsibleSection({ label, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View>
      <TouchableOpacity style={styles.header} onPress={() => setOpen(!open)} activeOpacity={0.7}>
        <Text style={styles.label}>{label}</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size="md" color={Colors.textSecondary} />
      </TouchableOpacity>
      {open ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET - 8,
  },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  content: {
    gap: Spacing.lg,
    paddingTop: Spacing.md,
  },
});
