import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, ScrollView, Platform, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signUpWithEmail } from '../lib/supabase';
import { setPendingCreate } from '../lib/pendingIntent';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Button from '../components/Button';
import Icon from '../components/Icon';

interface Props {
  /** Called after the account is created; returns to the sign-in screen with a
   *  confirmation message. */
  onDone: (message: string) => void;
  onBack: () => void;
}

// One screen that creates the account AND records the organisation to create.
// The org (and its default site) is created automatically on first sign-in
// via the pending-create intent, so there are no further setup screens.
export default function CreateOrgAccountScreen({ onDone, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [orgName, setOrgName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!orgName.trim()) return setError('Please enter your organisation name.');
    if (!name.trim()) return setError('Please enter your name.');
    if (!email.trim() || !password) return setError('Please enter your email and a password.');

    setLoading(true);
    setError(null);
    // Persist the intent BEFORE creating the account so that if email
    // confirmation is off (immediate session), App.tsx already sees it.
    await setPendingCreate({ orgName: orgName.trim(), name: name.trim() });
    const { error: signUpError } = await signUpWithEmail(email.trim(), password);
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message ?? 'Could not create your account.');
      return;
    }
    onDone(`Account created for ${orgName.trim()}. Confirm your email, then sign in — we'll finish setting up your organisation.`);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Create an organisation</Text>
        <Text style={styles.subheading}>
          Set up Snag for your workplace. You'll be the admin.
        </Text>

        <View style={styles.form}>
          <Text style={styles.label}>Organisation name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Acme Warehouse"
            placeholderTextColor={Colors.textMuted}
            value={orgName}
            onChangeText={setOrgName}
            autoFocus
          />
          <Text style={styles.label}>Your name</Text>
          <TextInput
            style={styles.input}
            placeholder="Your full name"
            placeholderTextColor={Colors.textMuted}
            value={name}
            onChangeText={setName}
          />
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@work.com"
            placeholderTextColor={Colors.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Choose a password"
            placeholderTextColor={Colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          {error && <Text style={styles.errorText}>{error}</Text>}

          <Button label="Create Organisation & Account" onPress={handleSubmit} loading={loading} fullWidth />
        </View>

        <TouchableOpacity onPress={onBack} style={styles.backRow}>
          <Icon name="arrow-back" size="sm" color={Colors.primary} />
          <Text style={styles.backText}>Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xl, gap: Spacing.lg },
  heading: { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.textPrimary, textAlign: 'center' },
  subheading: { fontSize: Typography.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: -Spacing.sm },
  form: { gap: Spacing.sm },
  label: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary, marginTop: Spacing.xs },
  input: {
    height: MIN_TOUCH_TARGET,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  errorText: {
    fontSize: Typography.sm,
    color: Colors.danger,
    backgroundColor: Colors.priority.highBg,
    borderRadius: Radius.button,
    padding: Spacing.sm,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  backText: { fontSize: Typography.sm, color: Colors.primary },
});
