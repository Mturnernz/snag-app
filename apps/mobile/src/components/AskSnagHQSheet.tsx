import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import Sheet from './Sheet';
import { PrimaryButton } from './Grouped';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { SUPPORT_ACCESS_DAYS } from '../types';

interface Props {
  visible: boolean;
  busy?: boolean;
  onSend: (question: string) => void;
  onCancel: () => void;
}

/**
 * Asking SnagHQ about this job.
 *
 * **It says exactly what gets shared, before anything is.** A person at SnagHQ
 * will look at this job, and that is a different thing from the other person
 * in the house looking at it — so the one sentence under the box names what
 * they see and for how long, and names what they do not. Nothing else in the
 * house: no other job, no house record, no renovation, no street address.
 *
 * It also says the one email out loud. Beyond the account emails somebody asks
 * for — the sign-up code, a reset link — Snag sends nothing else, and a reply
 * arriving by email with no warning would be the product speaking unasked.
 *
 * Sending does not touch the job. It is not a note, and it does not start it.
 */
export default function AskSnagHQSheet({ visible, busy = false, onSend, onCancel }: Props) {
  const [question, setQuestion] = useState('');

  // A fresh box each time: a question abandoned last week is not this one.
  useEffect(() => {
    if (visible) setQuestion('');
  }, [visible]);

  const trimmed = question.trim();

  return (
    <Sheet
      visible={visible}
      title="Ask SnagHQ"
      subtitle="A person at SnagHQ looks at this job and answers"
      onClose={onCancel}
      footer={
        <PrimaryButton
          label="Send to SnagHQ"
          onPress={() => onSend(trimmed)}
          disabled={!trimmed}
          busy={busy}
        />
      }
    >
      <View style={styles.block}>
        <Text style={styles.label}>What do you want to know?</Text>
        <TextInput
          style={styles.input}
          value={question}
          onChangeText={setQuestion}
          placeholder="Can I fix this myself, or do I need somebody?"
          placeholderTextColor={Colors.textMuted}
          multiline
          maxLength={2000}
          autoFocus
          accessibilityLabel="What do you want to know?"
        />
      </View>
      <Text style={styles.shared}>
        SnagHQ will see this job's photos, words and room, its notes, anything linked to it, and
        your suburb — nothing else in your house. It stays shared until you close the question, or{' '}
        {SUPPORT_ACCESS_DAYS} days after SnagHQ last replies.
      </Text>
      <Text style={styles.shared}>
        The answer appears on this job. SnagHQ emails you once when they reply.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.sm },
  label: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  // Stated outright, because `numberOfLines` on a multiline input is an
  // Android-only hint and does nothing on the build people install.
  input: {
    minHeight: 112,
    borderRadius: Radius.button,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    textAlignVertical: 'top',
  },
  shared: { fontSize: Typography.sm, lineHeight: 20, color: Colors.textMuted },
});
