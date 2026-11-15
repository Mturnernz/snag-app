import React, { createContext, forwardRef, useContext, useState } from 'react';
import {
  Platform,
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { Colors, FontFiles, Fonts, fontFamily } from '../constants/theme';

/**
 * `Text` and `TextInput`, set in Bone & Glass's two families.
 *
 * **Every screen imports these rather than React Native's.** A bundled font is
 * one file per weight, and neither platform picks the file from `fontWeight`:
 * a phone shows the regular file for every weight, and a browser fakes bold by
 * smearing the regular one. So this reads the style's weight, names the file
 * that weight lives in, and sets the weight back to normal so nothing is
 * synthesised on top of it. Screens keep writing `fontWeight`, and data keeps
 * writing `fontFamily: Fonts.mono`.
 *
 * **A nested `Text` with no weight of its own inherits**, as React Native's
 * does: `<Text style={bold}>Due <Text>Saturday</Text></Text>` stays bold all
 * the way. Naming a family on the inner one would override the parent's, so
 * an inner `Text` is left alone unless it says a weight or a family itself —
 * and when it says only a weight, it keeps its parent's family.
 *
 * A family this does not know (an icon font, a test's) is passed through.
 */
type Kind = 'sans' | 'mono';

const InText = createContext<Kind | null>(null);

const SANS: Record<string, string> = {
  '100': FontFiles.sans400, '200': FontFiles.sans400, '300': FontFiles.sans400,
  '400': FontFiles.sans400, normal: FontFiles.sans400,
  '500': FontFiles.sans500,
  '600': FontFiles.sans600,
  '700': FontFiles.sans700, bold: FontFiles.sans700,
  '800': FontFiles.sans800, '900': FontFiles.sans800,
};

const MONO: Record<string, string> = {
  '100': FontFiles.mono400, '200': FontFiles.mono400, '300': FontFiles.mono400,
  '400': FontFiles.mono400, normal: FontFiles.mono400,
  '500': FontFiles.mono500, '600': FontFiles.mono500, '700': FontFiles.mono500,
  bold: FontFiles.mono500, '800': FontFiles.mono500, '900': FontFiles.mono500,
};

const KNOWN = new Set<string>([Fonts.sans, Fonts.mono]);

/** The family to draw, or null to leave the style as it is. */
export function resolveFont(
  style: StyleProp<TextStyle>,
  parent: Kind | null,
): { kind: Kind; style: TextStyle } | null {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const family = flat.fontFamily;
  if (family && !KNOWN.has(family)) return null;
  const weight = flat.fontWeight;
  // Nested and silent about type: inherit, as React Native does.
  if (parent && !family && weight === undefined) return null;
  const kind: Kind = family === Fonts.mono ? 'mono' : family === Fonts.sans ? 'sans' : parent ?? 'sans';
  const file = (kind === 'mono' ? MONO : SANS)[String(weight ?? '400')] ?? (kind === 'mono' ? FontFiles.mono400 : FontFiles.sans400);
  return { kind, style: { fontFamily: fontFamily(file, kind === 'mono'), fontWeight: 'normal' } };
}

/** The instance type, so `useRef<Text>` keeps working beside the component. */
export type Text = RNText;
export type TextInput = RNTextInput;

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...rest }, ref) {
  const parent = useContext(InText);
  const font = resolveFont(style, parent);
  const kind = font?.kind ?? parent ?? 'sans';
  const text = <RNText ref={ref} {...rest} style={font ? [style, font.style] : style} />;
  return kind === parent ? text : <InText.Provider value={kind}>{text}</InText.Provider>;
});

/**
 * A box with the cursor in it wears one ring on the web: 2px of the action
 * colour, 2px outside, following the box's own corners. The browser's default
 * was a heavy black outline, rounded on one field and square on the next. A
 * phone draws its own caret and needs none, so this is web only and costs
 * native nothing.
 */
const WEB_REST = { outlineWidth: 0 } as object;
const WEB_FOCUS = {
  outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 2, outlineColor: Colors.primary,
} as object;

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput(
  { style, onFocus, onBlur, ...rest }, ref,
) {
  const font = resolveFont(style, null);
  const [focused, setFocused] = useState(false);
  if (Platform.OS !== 'web') {
    return <RNTextInput ref={ref} {...rest} onFocus={onFocus} onBlur={onBlur} style={font ? [style, font.style] : style} />;
  }
  return (
    <RNTextInput
      ref={ref}
      {...rest}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={[style, font?.style, focused ? WEB_FOCUS : WEB_REST]}
    />
  );
});

export default Text;
