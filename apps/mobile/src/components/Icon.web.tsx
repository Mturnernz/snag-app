import React, { useId } from 'react';
import { Colors, IconSize } from '../constants/theme';
import { glyphMarkup, iconPixels, type IconName } from './iconMarkup';

export type { IconName } from './iconMarkup';

interface Props {
  name: IconName;
  size?: keyof typeof IconSize | number;
  color?: string;
}

/**
 * A Snag Line glyph on the web build: a plain `<svg>`, which the browser draws
 * with no parser and no font to wait for. See `Icon.tsx` for the rules.
 */
export default function Icon({ name, size = 'md', color = Colors.textSecondary }: Props) {
  const px = iconPixels(size);
  const id = `g${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  return React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width: px,
    height: px,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: 'false',
    style: { display: 'block', flexShrink: 0, color, pointerEvents: 'none' },
    dangerouslySetInnerHTML: { __html: glyphMarkup(name, color, id) },
  });
}
