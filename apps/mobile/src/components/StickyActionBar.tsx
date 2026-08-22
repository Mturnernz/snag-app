import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Keyboard, Platform, KeyboardEvent } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography, Shadow } from '../constants/theme';
import Icon from './Icon';

interface Props {
  /** The screen's primary action — normally a single <Button fullWidth />. */
  children: React.ReactNode;
  /** One line under the action, for why it's disabled or what's still owed. */
  hint?: string;
  /** 'warn' for an unmet condition, 'muted' for plain context. */
  hintTone?: 'muted' | 'warn';
  /** True on a tab screen: the tab bar already occupies the bottom inset, so
   *  adding it again pads the bar away from the tab bar by a whole home
   *  indicator. Stack screens sit against the device edge and do need it. */
  withinTabs?: boolean;
}

// A pinned footer for a screen's primary action. Render it as the last flex
// child of a { flex: 1 } container, after the ScrollView — it needs no absolute
// positioning that way, so it can never overlap the content it belongs to.
//
// Blur is the enhancement and the tint underneath is the design: expo-blur has
// a web implementation and a native one, but neither is guaranteed to render
// on an old Android, so the bar carries its own near-opaque ground and stays
// legible with the blur removed entirely.
export default function StickyActionBar({ children, hint, hintTone = 'muted', withinTabs }: Props) {
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Android resizes the window for the keyboard (Expo's default layout mode),
  // so the bar rides up on its own. iOS overlays it, which would leave the
  // primary action of a form sitting behind the keyboard the form is being
  // filled in with.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (e: KeyboardEvent) =>
      setKeyboardHeight(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // The keyboard covers the inset it would otherwise clear, so the two are
  // alternatives rather than additive.
  const bottomPad = keyboardHeight > 0 ? Spacing.md : (withinTabs ? 0 : insets.bottom) + Spacing.md;

  return (
    <View style={[styles.wrap, { marginBottom: keyboardHeight }]}>
      <BlurView intensity={24} tint="light" style={StyleSheet.absoluteFill} />
      <View style={[styles.inner, { paddingBottom: bottomPad }]}>
        {children}
        {hint ? (
          <View style={styles.hintRow}>
            <Icon
              name={hintTone === 'warn' ? 'alert-circle-outline' : 'information-circle-outline'}
              size="sm"
              color={hintTone === 'warn' ? Colors.status.inProgressFg : Colors.textMuted}
            />
            <Text style={[styles.hint, hintTone === 'warn' && styles.hintWarn]}>{hint}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    // The ground the blur sits on. Near-opaque rather than the 82% a browser
    // can afford, because without blur a translucent bar smears the text
    // scrolling under it.
    backgroundColor: 'rgba(249, 250, 251, 0.94)',
    ...Shadow.lg,
  },
  inner: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  hint: {
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
    color: Colors.textMuted,
    textAlign: 'center',
    flexShrink: 1,
  },
  hintWarn: {
    color: Colors.status.inProgressFg,
  },
});
