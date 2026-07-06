import React from 'react';
import { SnagKind, KIND_LABELS } from '../types';
import { Colors } from '../constants/theme';
import Badge from './Badge';

interface Props {
  kind: SnagKind;
}

const kindConfig: Record<SnagKind, { color: string; bg: string }> = {
  fixit: { color: Colors.category.niggle, bg: Colors.category.niggleBg },
  improvement: { color: Colors.category.other, bg: Colors.category.otherBg },
  hazard: { color: Colors.category.brokenEquipment, bg: Colors.category.brokenEquipmentBg },
  incident: { color: Colors.category.healthAndSafety, bg: Colors.category.healthAndSafetyBg },
};

export default function CategoryBadge({ kind }: Props) {
  const cfg = kindConfig[kind];
  return <Badge label={KIND_LABELS[kind]} color={cfg.color} bg={cfg.bg} variant="solid" />;
}
