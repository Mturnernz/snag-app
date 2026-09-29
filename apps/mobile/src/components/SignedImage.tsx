import React from 'react';
import {
  Image, View, StyleSheet,
  type ImageResizeMode, type ImageStyle, type StyleProp, type ViewStyle,
} from 'react-native';
import Icon from './Icon';
import { Colors } from '../constants/theme';
import { useSignedUri } from '../hooks/useSignedUri';

interface Props {
  /** A signed link from `getFileUrls` / `getFileUrl`, or nothing while it is being signed. */
  uri: string | null | undefined;
  style: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  accessibilityLabel?: string;
}

/**
 * A photo from the bucket that asks for a new link if its link has gone stale.
 *
 * Use it wherever an `<Image>` is drawn from a signed URL. If the link fails,
 * it signs the path again and tries once more; if that fails too it draws the
 * same quiet placeholder a job with no photo gets, rather than an empty frame
 * that looks like the layout broke. See `useSignedUri`.
 */
export default function SignedImage({ uri, style, resizeMode, accessibilityLabel }: Props) {
  const signed = useSignedUri(uri);

  // Still being signed: the frame, quietly, so the strip does not jump when the
  // photo arrives and does not claim anything has gone wrong.
  if (!signed.uri && !signed.failed) {
    return <View style={[style as StyleProp<ViewStyle>, styles.waiting]} />;
  }

  if (signed.failed || !signed.uri) {
    return (
      <View
        style={[style as StyleProp<ViewStyle>, styles.missing]}
        accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}, couldn't load` : "Photo couldn't load"}
      >
        <Icon name="image-outline" size="md" color={Colors.textMuted} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: signed.uri }}
      style={style}
      resizeMode={resizeMode}
      onError={signed.onError}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

const styles = StyleSheet.create({
  waiting: { backgroundColor: Colors.sunken },
  missing: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.sunken,
  },
});
