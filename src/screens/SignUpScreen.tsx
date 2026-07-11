import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, ScrollView, Platform, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signUpWithEmail } from '../lib/supabase';
import { setPendingJoin } from '../lib/pendingIntent';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Button from '../components/Button';
import Icon from '../components/Icon';
import ScanJoinCodeScreen from './ScanJoinCodeScreen';

interface Props {
  /** Called after the account is created; returns to the sign-in screen with a
   *  confirmation message. */
  onDone: (message: string) => void;
  onBack: () => void;
}

type Step = 'name' | 'code' | 'account';

// A 3-step stepper — name, then the company join code (scan or type), then
// email/password — that replaces the old "scan first, name later" flow. The
// resolved code+name are persisted as a pending-join intent BEFORE signing
// up (mirrors CreateOrgAccountScreen's ordering) so that if email
// confirmation is off, App.tsx already sees it on the immediate session.
export default function SignUpScreen({ onDone, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [code, setCode] = useState<{ code: string; orgName: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (step === 'code') {
    return (
      <ScanJoinCodeScreen
        onCodeScanned={(org) => { setCode({ code: org.code, orgName: org.orgName }); setStep('account'); }}
        onComplete={() => {}}
        onBack={() => setStep('name')}
      />
    );
  }

  if (step === 'account' && code) {
    async function handleCreateAccount() {
      if (!email.trim() || !password) return setError('Please enter your email and a password.');
      setLoading(true);
      setError(null);
      // Persist the intent BEFORE signing up so that if email confirmation
      // is off (immediate session), App.tsx already sees it.
      await setPendingJoin({ code: code!.code, orgName: code!.orgName, name: name.trim() });
      const { error: signUpError } = await signUpWithEmail(email.trim(), password);
      setLoading(false);
      if (signUpError) {
        setError(signUpError.message ?? 'Could not create your account.');
        return;
      }
      onDone(`Account created. Confirm your email, then sign in — we'll finish joining ${code!.orgName}.`);
    }

    return (
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>Create your account</Text>
          <View style={styles.intentBanner}>
            <Icon name="business-outline" size="sm" color={Colors.primary} />
            <Text style={styles.intentBannerText}>You're joining {code.orgName}.</Text>
          </View>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={Colors.textMuted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoFocus
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={Colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleCreateAccount}
            />

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Button label="Create Account" onPress={handleCreateAccount} loading={loading} fullWidth />
          </View>

          <TouchableOpacity onPress={() => setStep('code')} style={styles.backRow}>
            <Icon name="arrow-back" size="sm" color={Colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // step === 'name'
  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>What's your name?</Text>
        <Text style={styles.subheading}>This is how your team will see you on Snag.</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Your full name"
            placeholderTextColor={Colors.textMuted}
            value={name}
            onChangeText={setName}
            returnKeyType="next"
            onSubmitEditing={() => name.trim() && setStep('code')}
            autoFocus
          />
          <Button label="Continue" onPress={() => setStep('code')} disabled={!name.trim()} fullWidth />
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
  intentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  intentBannerText: { flex: 1, fontSize: Typography.sm, color: Colors.textPrimary },
  form: { gap: Spacing.md },
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
  },
  backRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  backText: { fontSize: Typography.sm, color: Colors.primary },
});
