import React from 'react';
import { View, Text, Modal, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';

interface Props {
  visible: boolean;
  title: string;
  /** Small line under the title: the supplier and amount, the room. */
  subtitle?: string | null;
  onClose: () => void;
  /** The word on the close control. "Cancel" when leaving discards, "Done" when nothing is pending. */
  closeLabel?: string;
  children: React.ReactNode;
  /** Pinned under the scroll — the one filled button, when there is one. */
  footer?: React.ReactNode;
}

/**
 * A V2 bottom sheet: plaster ground, grouped content, a grab handle, the title
 * on the left and the way out on the right in words.
 *
 * **The footer is the last flex child, never absolutely positioned**, for the
 * reason the snag page's Save bar is: a button that can overlap what it belongs
 * to is one people assume is not there. The keyboard inset is applied here with
 * `useKeyboardInset`, because `KeyboardAvoidingView` does nothing on the web
 * build people install.
 */
export default function Sheet({
  visible, title, subtitle, onClose, closeLabel = 'Cancel', children, footer,
}: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[
          styles.sheet,
          { marginBottom: keyboard, paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + Spacing.lg },
        ]}
      >
        <View style={styles.grab} />
        <View style={styles.head}>
          <View style={styles.titles}>
            <Text style={styles.title} accessibilityRole="header">{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <Pressable
            onPress={onClose}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
          >
            <Text style={styles.closeLabel}>{closeLabel}</Text>
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={styles.scroll}
          contentContainerStyle={styles.content}
        >
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '92%',
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm,
  },
  grab: { width: 36, height: 5, borderRadius: 3, backgroundColor: Colors.border, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, marginTop: Spacing.md, paddingHorizontal: 4 },
  titles: { flex: 1, minWidth: 0, gap: 4 },
  title: {
    fontSize: Typography.title2, lineHeight: 28, fontWeight: Typography.bold,
    color: Colors.textPrimary, letterSpacing: -0.3,
  },
  subtitle: { fontSize: Typography.body, color: Colors.textMuted, fontVariant: ['tabular-nums'] },
  close: { minHeight: 44, justifyContent: 'center', paddingLeft: Spacing.sm },
  closeLabel: { fontSize: Typography.body, color: Colors.primary },
  scroll: { marginTop: Spacing.lg },
  content: { gap: Spacing.xl, paddingBottom: Spacing.lg },
  footer: { paddingTop: Spacing.sm, gap: Spacing.sm },
});
