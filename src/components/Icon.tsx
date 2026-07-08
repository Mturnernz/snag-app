import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Colors, IconSize } from '../constants/theme';

type IconName = keyof typeof Ionicons.glyphMap;

interface Props {
  name: IconName;
  size?: keyof typeof IconSize | number;
  color?: string;
}

export default function Icon({ name, size = 'md', color = Colors.textSecondary }: Props) {
  const resolvedSize = typeof size === 'number' ? size : IconSize[size];
  return <Ionicons name={name} size={resolvedSize} color={color} />;
}
