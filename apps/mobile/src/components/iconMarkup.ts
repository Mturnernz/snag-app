import { IconSize } from '../constants/theme';
import { FROM_IONICONS, GLYPHS, type GlyphName } from './snagLine';

/**
 * A glyph's name: Snag Line's own (`house-fill`, `room-kitchen`), or one of the
 * Ionicons names the screens have always passed (`home-outline`), which draws
 * the Snag Line glyph that replaced it. New code names Snag Line glyphs.
 */
export type IconName = GlyphName | keyof typeof FROM_IONICONS;

export function glyphFor(name: IconName): GlyphName {
  return (name in GLYPHS ? name : FROM_IONICONS[name as keyof typeof FROM_IONICONS]) as GlyphName;
}

export function iconPixels(size: keyof typeof IconSize | number): number {
  return typeof size === 'number' ? size : IconSize[size];
}

/** The inner markup in `color`, with its mask ids made this drawing's own. */
export function glyphMarkup(name: IconName, color: string, id: string): string {
  return (GLYPHS[glyphFor(name)] ?? '').replace(/currentColor/g, color).replace(/__ID__/g, id);
}

/** The whole `<svg>`, for a renderer that takes a string. */
export function iconSvg(name: IconName, color: string, px: number, id: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">` +
    `${glyphMarkup(name, color, id)}</svg>`
  );
}
