import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signInWithEmail, signUpWithEmail } from '../lib/supabase';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Button from '../components/Button';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function handleSubmit() {
    if (!email.trim() || !password) {
      setMessage({ text: 'Please enter your email and password.', error: true });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const { error } =
        mode === 'signin'
          ? await signInWithEmail(email.trim(), password)
          : await signUpWithEmail(email.trim(), password);

      if (error) throw error;

      if (mode === 'signup') {
        setMessage({ text: 'Check your email to confirm your account, then sign in.', error: false });
        setMode('signin');
      }
    } catch (err: any) {
      setMessage({ text: err.message ?? 'Something went wrong.', error: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.appName}>Snag</Text>
        <Text style={styles.tagline}>Workplace issue reporting</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={Colors.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={Colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          {message && (
            <Text style={[styles.message, message.error ? styles.messageError : styles.messageSuccess]}>
              {message.text}
            </Text>
          )}

          <Button
            label={mode === 'signin' ? 'Sign In' : 'Create Account'}
            onPress={handleSubmit}
            loading={loading}
            fullWidth
            style={styles.submitButton}
          />
        </View>

        <TouchableOpacity onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(null); }}>
          <Text style={styles.switchText}>
            {mode === 'signin'
              ? "Don't have an account? Sign up"
              : 'Already have an account? Sign in'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.xl,
  },
  appName: {
    fontSize: Typography.xxxl + 8,
    fontWeight: Typography.bold,
    color: Colors.primary,
    textAlign: 'center',
  },
  tagline: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: -Spacing.lg,
  },
  form: {
    gap: Spacing.md,
  },
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
  message: {
    fontSize: Typography.sm,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button,
  },
  messageError: {
    color: Colors.danger,
    backgroundColor: Colors.priority.highBg,
  },
  messageSuccess: {
    color: Colors.success,
    backgroundColor: Colors.successBg,
  },
  submitButton: {
    marginTop: Spacing.sm,
  },
  switchText: {
    fontSize: Typography.sm,
    color: Colors.primary,
    textAlign: 'center',
  },
});
