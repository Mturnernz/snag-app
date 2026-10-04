import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

import Sheet from './Sheet';
import Icon from './Icon';
import { Group, PrimaryButton, Row } from './Grouped';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';

interface Props {
  visible: boolean;
  /** No place to file against, or no household folder yet: nothing can be pressed. */
  disabled?: boolean;
  /**
   * *Take photo*. Called from inside the press — a browser opens the camera
   * only from a tap — and the screen files the photo the way the shutter
   * always has, capture sheet and all.
   */
  onTakePhoto: () => void;
  /**
   * The words, on *Add job*. Resolves once the job exists; a rejection keeps
   * the sheet open with the words still in the box.
   */
  onAddWords: (text: string) => Promise<void>;
  onClose: () => void;
}

/**
 * What the List tab's + opens: **Take photo**, or **Continue without picture**.
 *
 * It replaced the compose bar at the foot of the list (October 2026). The bar
 * was one tap to the camera and a field always on screen; the + is one tap to
 * this sheet, and the camera is one more. What it buys is the list's foot back
 * and one obvious way in, where a field and two icons read as three.
 *
 * **Without a picture, nothing is created until the words are sent.** The
 * sheet turns into *What's the job?* with the box focused, and *Add job* files
 * it through the same `create_snag` text path the bar used — a job needs a
 * photo or words (`snags_has_something`), and this is the words. Walking away
 * from the box files nothing, which is the difference from a photo: the
 * shutter files first and asks afterwards, because a photograph is already a
 * complete entry and an empty box is not.
 */
export default function CaptureSheet({ visible, disabled, onTakePhoto, onAddWords, onClose }: Props) {
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // Every opening starts at the choice, with an empty box.
  useEffect(() => {
    if (visible) {
      setWriting(false);
      setDraft('');
      setBusy(false);
    }
  }, [visible]);

  const text = draft.trim();

  async function send() {
    if (!text || busy) return;
    setBusy(true);
    try {
      await onAddWords(text);
    } catch {
      // The screen has said why; the words stay so nothing is retyped.
    } finally {
      setBusy(false);
    }
  }

  if (writing) {
    return (
      <Sheet
        visible={visible}
        title="What's the job?"
        onClose={onClose}
        footer={(
          <PrimaryButton
            label="Add job"
            onPress={send}
            disabled={!text}
            busy={busy}
          />
        )}
      >
        <TextInput
          style={styles.box}
          value={draft}
          onChangeText={setDraft}
          autoFocus
          multiline
          maxLength={500}
          autoCapitalize="sentences"
          returnKeyType="done"
          blurOnSubmit
          onSubmitEditing={send}
          accessibilityLabel="What's the job?"
        />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} title="New job" onClose={onClose}>
      <Group>
        <Row
          title="Take photo"
          leading={<View style={styles.lead}><Icon name="camera-outline" size="md" color={Colors.primary} /></View>}
          onPress={disabled ? undefined : onTakePhoto}
          dim={disabled}
        />
        <Row
          title="Continue without picture"
          leading={<View style={styles.lead}><Icon name="create-outline" size="md" color={Colors.primary} /></View>}
          onPress={() => setWriting(true)}
        />
      </Group>
      {disabled ? <Text style={styles.hint}>Add a place before adding something to the list.</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  lead: { width: 28, alignItems: 'center' },
  box: {
    minHeight: MIN_TOUCH_TARGET * 2,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    textAlignVertical: 'top',
  },
  hint: { fontSize: Typography.footnote, color: Colors.textMuted, marginTop: Spacing.sm },
});
