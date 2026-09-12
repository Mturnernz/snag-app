import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { compressAndUpload, photoFileName, takePhoto } from '../lib/photoUpload';
import { failureReason } from '../lib/deadline';
import { showAlert } from '../lib/alert';

interface Props {
  /** `<household_id>` — the storage folder the RLS policies read. */
  pathPrefix: string | null;
  /** Files a snag with a photo, a line of text, or both. */
  onAdd: (input: { photoPath: string | null; description: string | null }) => Promise<void>;
  /** Stacked above a tab bar, which already clears the home indicator. */
  stacked?: boolean;
}

/**
 * Adding something, from the bottom of the list you were already looking at.
 *
 * This replaced a whole tab. Capture was never a destination — it was a form
 * that needed somewhere to live — and the cost of the arrangement was that the
 * app opened on a form instead of on what the other person had added.
 *
 * Three things about it are load-bearing:
 *
 * - **The camera is on the left, at the bottom.** That is the easiest place on
 *   a phone to reach with a thumb, and the old Add screen had it at the top,
 *   which is the hardest. The extra "step" of being on the list first buys back
 *   more than it costs.
 * - **A line of text is a complete snag.** "Gutters" typed in four seconds is a
 *   perfectly good entry — the server only insists on a photo *or* words — and
 *   making that the same gesture as sending a message is the entire point of
 *   the bar.
 * - **It lifts for the keyboard.** `KeyboardAvoidingView` does nothing in a
 *   browser (see lib/keyboardInset.ts), and a compose bar pinned above a tab
 *   bar is the exact case that breaks. This is the one component in the app
 *   that could not exist without that fix.
 */
export default function ComposeBar({ pathPrefix, onAdd, stacked }: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const canSend = draft.trim().length > 0 && !busy;

  async function handleText() {
    const description = draft.trim();
    if (!description || busy) return;
    setBusy(true);
    try {
      // Cleared first. The row appears at the top of the list within the same
      // tick, and a bar still holding the words that are now on screen reads
      // as "that didn't send".
      setDraft('');
      await onAdd({ photoPath: null, description });
    } catch (err: any) {
      setDraft(description);
      showAlert("Couldn't add that", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePhoto() {
    if (busy || !pathPrefix) return;
    const uri = await takePhoto();
    if (!uri) return;

    setBusy(true);
    try {
      const { path, error } = await compressAndUpload(uri, photoFileName(pathPrefix));
      if (error || !path) throw error ?? new Error('The photo did not upload');
      // Any words already in the bar belong to the photo that was just taken —
      // someone typing and then reaching for the camera meant one snag.
      const description = draft.trim() || null;
      setDraft('');
      await onAdd({ photoPath: path, description });
    } catch (err: unknown) {
      showAlert("Couldn't add that photo", failureReason(err) ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={[
        styles.bar,
        {
          marginBottom: keyboard,
          // The keyboard covers the inset it would otherwise clear, and a tab
          // bar below already owns it. Never both.
          paddingBottom: (keyboard > 0 || stacked ? 0 : insets.bottom) + Spacing.sm,
        },
      ]}
    >
      <Pressable
        onPress={handlePhoto}
        disabled={busy || !pathPrefix}
        style={[styles.camera, (busy || !pathPrefix) && styles.cameraOff]}
        accessibilityRole="button"
        accessibilityLabel="Take a photo"
      >
        {busy ? (
          <ActivityIndicator color={Colors.white} />
        ) : (
          <Icon name="camera" size="md" color={Colors.white} />
        )}
      </Pressable>

      <TextInput
        style={styles.field}
        value={draft}
        onChangeText={setDraft}
        placeholder="Add something…"
        placeholderTextColor={Colors.textMuted}
        maxLength={200}
        returnKeyType="send"
        onSubmitEditing={handleText}
        blurOnSubmit={false}
        accessibilityLabel="Add something"
      />

      {draft.trim().length > 0 ? (
        <Pressable
          onPress={handleText}
          disabled={!canSend}
          style={[styles.send, !canSend && styles.sendOff]}
          accessibilityRole="button"
          accessibilityLabel="Add to the list"
        >
          <Icon name="arrow-up" size="md" color={Colors.white} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The chips that amend the snag just added, shown above the bar. */
export function AmendRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.amend}>{children}</View>;
}

export function AmendLabel({ text }: { text: string }) {
  return <Text style={styles.amendLabel}>{text}</Text>;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  camera: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraOff: { backgroundColor: Colors.textMuted },
  field: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.sunken,
    borderRadius: MIN_TOUCH_TARGET / 2,
    paddingHorizontal: Spacing.lg,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  send: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: Colors.textMuted },
  amend: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  amendLabel: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
});
