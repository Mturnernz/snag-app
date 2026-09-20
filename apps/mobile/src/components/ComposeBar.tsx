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
  /**
   * What the bar is for, in the words of the tab it is on.
   *
   * The same three controls file a snag on the list and a thing in the house
   * record — the gesture is identical and deliberately so — but "Add
   * something…" is the wrong prompt when the camera is pointed at a rating
   * plate. Only the words change; nothing else about the bar does.
   */
  words?: {
    placeholder?: string;
    cameraLabel?: string;
    /**
     * The send button's accessible name. Kept separate from the placeholder
     * rather than derived from it: a placeholder describes what to type and a
     * button has to say what pressing it does, and "Add something" is a worse
     * answer to the second question than "Add to the list" is. `ComposeBar.test`
     * pins both.
     */
    sendLabel?: string;
  };
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
export default function ComposeBar({ pathPrefix, onAdd, stacked, words }: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const canSend = draft.trim().length > 0 && !busy;
  const off = busy || !pathPrefix;

  const cameraLabel = words?.cameraLabel ?? 'Take a photo';
  const prompt = words?.placeholder ?? 'or type it…';
  // The accessible name is the prompt without its trailing ellipsis: a screen
  // reader saying "Say what it is dot dot dot" is reading punctuation aloud.
  const promptLabel = prompt.replace(/[….]+$/, '');
  const sendLabel = words?.sendLabel ?? 'Add to the list';

  async function handleText() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      // Cleared first. The row appears at the top of the list within the same
      // tick, and a bar still holding the words that are now on screen reads
      // as "that didn't send".
      setDraft('');
      await onAdd({ photoPath: null, description: text });
    } catch (err: any) {
      setDraft(text);
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
      {/* **The camera is the default way to log something, and it says so.**
          It was an icon-only circle the same size as the send button beside a
          field inviting words, which made photographing and typing read as two
          equal offers — and typing is the one with a keyboard in front of it.
          Nearly everything worth filing here is in front of somebody when they
          file it, and a photograph *is* the snag: there is no title column
          because a picture of the broken seat says what a title would. So the
          shutter carries a word and the field is the alternative to it.

          Still bottom-left, which is the easiest place on a phone to reach
          one-handed — the old Add screen had it at the top, which is the
          hardest — and still one tap to the camera, not to a chooser. */}
      <Pressable
        onPress={handlePhoto}
        disabled={off}
        style={[styles.camera, off && styles.cameraOff]}
        accessibilityRole="button"
        accessibilityLabel={cameraLabel}
      >
        {busy ? (
          <ActivityIndicator color={Colors.white} />
        ) : (
          <>
            <Icon name="camera" size="md" color={off ? Colors.textMuted : Colors.white} />
            <Text style={[styles.cameraLabel, off && styles.cameraLabelOff]}>Photo</Text>
          </>
        )}
      </Pressable>

      <TextInput
        style={styles.field}
        value={draft}
        onChangeText={setDraft}
        placeholder={prompt}
        placeholderTextColor={Colors.textMuted}
        maxLength={200}
        returnKeyType="send"
        onSubmitEditing={handleText}
        blurOnSubmit={false}
        accessibilityLabel={promptLabel}
      />

      {draft.trim().length > 0 ? (
        <Pressable
          onPress={handleText}
          disabled={!canSend}
          style={[styles.send, !canSend && styles.sendOff]}
          accessibilityRole="button"
          accessibilityLabel={sendLabel}
        >
          <Icon name="arrow-up" size="md" color={canSend ? Colors.white : Colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minWidth: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.md,
    borderRadius: MIN_TOUCH_TARGET / 2,
    backgroundColor: Colors.primary,
  },
  // Disabled goes neutral rather than faded: fern at half strength is a pale
  // sage that reads as broken rather than as not-ready, and white on pale sage
  // fails contrast on the way past.
  cameraOff: { backgroundColor: Colors.sunken },
  cameraLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
  cameraLabelOff: { color: Colors.textMuted },
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
  sendOff: { backgroundColor: Colors.sunken },
});
