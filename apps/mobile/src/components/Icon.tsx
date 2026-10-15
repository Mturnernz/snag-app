import React, { useId } from 'react';
import { SvgXml } from 'react-native-svg';
import { Colors, IconSize } from '../constants/theme';
import { iconPixels, iconSvg, type IconName } from './iconMarkup';

export type { IconName } from './iconMarkup';

interface Props {
  name: IconName;
  size?: keyof typeof IconSize | number;
  color?: string;
}

/**
 * A **Snag Line** glyph — the icon set drawn for Bone & Glass: 92 glyphs on a
 * 24 grid, 1.75 stroke, round caps and joins. It replaced Ionicons; screens
 * may still pass an Ionicons name, which draws the glyph that replaced it.
 *
 * Draw it at 20 or 24 in the colour of the words beside it, 16 only inline
 * with 13pt words. Filled glyphs are for the active tab and a choice already
 * made. An icon is decoration beside words, so it is hidden from screen
 * readers: the control around it carries the name.
 *
 * On a phone it is drawn by `react-native-svg`; the web build draws a plain
 * `<svg>` (`Icon.web.tsx`), which costs nothing to parse.
 */
export default function Icon({ name, size = 'md', color = Colors.textSecondary }: Props) {
  const px = iconPixels(size);
  const id = `g${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  return (
    <SvgXml
      xml={iconSvg(name, color, px, id)}
      width={px}
      height={px}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
