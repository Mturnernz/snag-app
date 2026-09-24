import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable,
} from 'react-native';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import Button from '../components/Button';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { signInWithEmail, signUpWithEmail, sendPasswordReset } from '../lib/supabase';
import { showAlert } from '../lib/alert';

type Mode = 'signIn' | 'signUp';

export default function AuthScreen() {
  const insets = useEdgeInsets();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length >= 6 && !busy;

  async function handleSubmit() {
    setBusy(true);
    try {
      const { error } =
        mode === 'signIn'
          ? await signInWithEmail(email.trim(), password)
          : await signUpWithEmail(email.trim(), password);

      if (error) {
        showAlert(mode === 'signIn' ? "Couldn't sign in" : "Couldn't sign up", error.message);
      }
      // On success App.tsx's auth listener takes over — nothing to do here.
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    const address = email.trim();
    if (!address) {
      showAlert('Your email first', 'Enter your email address and we’ll send you a reset link.');
      return;
    }
    setBusy(true);
    try {
      // The link lands on the portal's /reset-password, not in this app — see
      // sendPasswordReset in lib/supabase.ts for why it has to be a plain web
      // page rather than a screen here.
      const { error } = await sendPasswordReset(address);
      if (error) showAlert("Couldn't send that", error.message);
      else showAlert('Check your email', `We've sent a reset link to ${address}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.xxxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Icon name="home" size="xxl" color={Colors.primary} />
          <Text style={styles.title}>Snag</Text>
          <Text style={styles.tagline}>The list of things that need doing</Text>
        </View>

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          inputMode="email"
          textContentType="emailAddress"
        />

        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={Colors.textMuted}
          secureTextEntry
          autoCapitalize="none"
          textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
        />

        <Button
          label={mode === 'signIn' ? 'Sign in' : 'Create account'}
          onPress={handleSubmit}
          loading={busy}
          disabled={!canSubmit}
          fullWidth
          style={styles.submit}
        />

        {mode === 'signIn' ? (
          <Pressable onPress={handleForgotPassword} style={styles.link} disabled={busy}>
            <Text style={styles.linkText}>Forgot your password?</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
          style={styles.link}
          disabled={busy}
        >
          <Text style={styles.linkText}>
            {mode === 'signIn' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, gap: Spacing.md },
  brand: { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.xxl },
  title: {
    fontSize: Typography.xxxl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  tagline: { fontSize: Typography.base, color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET,
  },
  submit: { marginTop: Spacing.sm },
  link: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignItems: 'center' },
  linkText: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.medium },
});
