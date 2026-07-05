import React from 'react';
import { IssueCategory, CATEGORY_LABELS } from '../types';
import { Colors } from '../constants/theme';
import Badge from './Badge';

interface Props {
  category: IssueCategory;
}

const categoryConfig: Record<IssueCategory, { color: string; bg: string }> = {
  niggle: { color: Colors.category.niggle, bg: Colors.category.niggleBg },
  broken_equipment: { color: Colors.category.brokenEquipment, bg: Colors.category.brokenEquipmentBg },
  health_and_safety: { color: Colors.category.healthAndSafety, bg: Colors.category.healthAndSafetyBg },
  other: { color: Colors.category.other, bg: Colors.category.otherBg },
};

export default function CategoryBadge({ category }: Props) {
  const cfg = categoryConfig[category];
  return <Badge label={CATEGORY_LABELS[category]} color={cfg.color} bg={cfg.bg} variant="solid" />;
}
