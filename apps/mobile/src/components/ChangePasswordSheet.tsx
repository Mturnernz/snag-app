import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Sheet from './Sheet';
import Button from './Button';
import { Text, TextInput } from './Text';
import { Colors, MIN_TOUCH_TARGET, Radius, Spacing, Typography } from '../constants/theme';
import { MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT, describeAuthError } from '../lib/authForm';
import { updatePassword } from '../lib/supabase';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Said when it has changed — the screen's own toast. */
  onChanged: () => void;
}

/**
 * Changing the password from inside the app (October 2026).
 *
 * It could only be changed by the reset link on the website, which means
 * asking for an email to change something you already know. The rules are
 * the sign-up page's — eight characters, the same as `/reset-password` — and
 * every refusal is words on the sheet, never a browser alert: Auth's own
 * reasons (a breached password, a rate limit) through `describeAuthError`.
 *
 * Somebody who signs in with Google has no password, and this gives them one;
 * it does not change how they sign in.
 */
export default function ChangePasswordSheet({ visible, onClose, onChanged }: Props) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    setPassword('');
    setAgain('');
    setProblem(null);
    onClose();
  }

  async function save() {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setProblem(PASSWORD_TOO_SHORT);
      return;
    }
    if (password !== again) {
      setProblem("The two don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await updatePassword(password);
      if (error) {
        setProblem(describeAuthError(error));
        return;
      }
      close();
      onChanged();
    } catch (err: unknown) {
      setProblem(describeAuthError(err as never));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      title="Change password"
      onClose={close}
      footer={<Button label="Change password" onPress={save} loading={busy} fullWidth />}
    >
      <View style={styles.field}>
        <Text style={styles.label}>New password</Text>
        <TextInput
          value={password}
          onChangeText={(text) => { setPassword(text); setProblem(null); }}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          style={styles.box}
          accessibilityLabel="New password"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Again</Text>
        <TextInput
          value={again}
          onChangeText={(text) => { setAgain(text); setProblem(null); }}
          onSubmitEditing={save}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          style={styles.box}
          accessibilityLabel="The new password again"
        />
      </View>
      {problem ? (
        <Text style={styles.problem} accessibilityRole="alert">{problem}</Text>
      ) : (
        <Text style={styles.hint}>{`At least ${MIN_PASSWORD_LENGTH} characters.`}</Text>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.xs },
  label: { fontSize: Typography.footnote, fontWeight: Typography.medium, color: Colors.textSecondary },
  box: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.input,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.body,
    color: Colors.textPrimary,
  },
  hint: { fontSize: Typography.sm, color: Colors.textMuted },
  problem: { fontSize: Typography.sm, color: Colors.danger },
});
