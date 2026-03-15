import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IssueCategory, CATEGORY_LABELS } from '../types';
import { Colors, Radius, Typography } from '../constants/theme';

interface Props {
  category: IssueCategory;
}

const categoryConfig: Record<
  IssueCategory,
  { label: string; color: string; bg: string }
> = {
  niggle: {
    label: CATEGORY_LABELS.niggle,
    color: Colors.category.niggle,
    bg: Colors.category.niggleBg,
  },
  broken_equipment: {
    label: CATEGORY_LABELS.broken_equipment,
    color: Colors.category.brokenEquipment,
    bg: Colors.category.brokenEquipmentBg,
  },
  health_and_safety: {
    label: CATEGORY_LABELS.health_and_safety,
    color: Colors.category.healthAndSafety,
    bg: Colors.category.healthAndSafetyBg,
  },
  other: {
    label: CATEGORY_LABELS.other,
    color: Colors.category.other,
    bg: Colors.category.otherBg,
  },
};

export default function CategoryBadge({ category }: Props) {
  const cfg = categoryConfig[category];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.label, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.chip,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    letterSpacing: 0.2,
  },
});
