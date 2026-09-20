import React, { useMemo } from 'react';
import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import { linkify, openUrl } from '../lib/openUrl';

interface Props {
  children: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

/**
 * Prose somebody typed, with the addresses in it tappable.
 *
 * **This product has no notifications and never will**, so a note is the only
 * way one person tells the other anything — and what they are most often
 * telling them is *where*: the listing for the replacement seat, the
 * installer's page, the invoice. A URL rendered as grey prose is a string
 * somebody has to select, copy and paste by hand, on a phone, having first
 * worked out where it stops. Every one of those steps is a place people give up
 * and just say it out loud, which is the thing this app exists to stop being
 * necessary.
 *
 * It renders nested `<Text>` rather than a row of views, so a long link still
 * wraps and reflows with the sentence around it — a `<View>` per piece would
 * break the line wherever an address happened to fall.
 *
 * Where a link stops is `linkify`'s problem, not this component's, and it is
 * pure so the boundaries can be pinned as properties. Where a link *opens* is
 * `openUrl`'s: a new tab on web, because navigating this single-page app away
 * to a supplier's website drops the half-typed note underneath it.
 */
export default function LinkedText({ children, style, numberOfLines }: Props) {
  const pieces = useMemo(() => linkify(children), [children]);

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {pieces.map((piece, index) => (
        piece.url ? (
          <Text
            key={index}
            style={styles.link}
            onPress={() => openUrl(piece.url!)}
            accessibilityRole="link"
            accessibilityLabel={`Open ${piece.url}`}
          >
            {piece.text}
          </Text>
        ) : (
          <Text key={index}>{piece.text}</Text>
        )
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  // Fern, because opening a link is an interaction and that is what the hue is
  // for. Underlined as well as coloured: colour alone is not an affordance for
  // anybody who cannot see this one.
  link: {
    color: Colors.primary,
    fontWeight: Typography.medium,
    textDecorationLine: 'underline',
  },
});
