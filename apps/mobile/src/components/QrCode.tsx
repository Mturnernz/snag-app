import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import QRCodeSvg from 'react-native-qrcode-svg';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';

interface Props {
  /** The URL to encode. */
  value: string;
  size?: number;
}

/**
 * A QR code on a white tile, which is not decoration: a scanner needs a quiet
 * zone and real contrast, and the app's ground is plaster rather than white.
 * Drawing this straight onto `Colors.background` measurably costs reads on a
 * dim kitchen bench.
 *
 * Fern and plaster are deliberately NOT used for the modules. The palette's
 * rule is that colour is spent on state, and a QR's colour is not a state — it
 * is the one thing on screen whose job is to be machine-readable, so it gets
 * the highest contrast there is.
 *
 * Wrapped rather than used directly so the single import of
 * `react-native-qrcode-svg` lives in one file: it renders through
 * `react-native-svg`, which behaves differently enough under jest that every
 * screen importing it would need its own mock.
 */
export default function QrCode({ value, size = 180 }: Props) {
  return (
    <View style={styles.tile}>
      <QRCodeSvg value={value} size={size} color="#000000" backgroundColor="#FFFFFF" />
    </View>
  );
}

/** The link under the code, for when a camera won't play along. */
export function QrCaption({ text }: { text: string }) {
  return (
    <Text style={styles.caption} numberOfLines={2} selectable>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    padding: Spacing.md,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  caption: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
