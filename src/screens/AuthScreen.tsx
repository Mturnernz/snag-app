import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signInWithEmail, signUpWithEmail } from '../lib/supabase';
import {
  getPendingIntent, setPendingJoin, setPendingCreate, clearPendingIntent, PendingJoin,
} from '../lib/pendingIntent';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Button from '../components/Button';
import Card from '../components/Card';
import Icon from '../components/Icon';
import ScanJoinCodeScreen from './ScanJoinCodeScreen';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  // First-time intent, captured before the account exists and resumed after
  // sign-up (see src/lib/pendingIntent.ts).
  const [showScanner, setShowScanner] = useState(false);
  const [pendingJoin, setPendingJoinState] = useState<PendingJoin | null>(null);
  const [pendingCreate, setPendingCreateState] = useState(false);

  useEffect(() => {
    getPendingIntent().then(({ join, create }) => {
      setPendingJoinState(join);
      setPendingCreateState(create);
    });
  }, []);

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

  function handleScanned(org: { code: string; orgId: string; orgName: string }) {
    setPendingJoin({ code: org.code, orgName: org.orgName });
    setPendingJoinState({ code: org.code, orgName: org.orgName });
    setPendingCreateState(false);
    setShowScanner(false);
    setMode('signup');
  }

  function handleCreateIntent() {
    setPendingCreate();
    setPendingCreateState(true);
    setPendingJoinState(null);
    setMode('signup');
  }

  function handleClearIntent() {
    clearPendingIntent();
    setPendingJoinState(null);
    setPendingCreateState(false);
  }

  if (showScanner) {
    return (
      <ScanJoinCodeScreen
        onCodeScanned={handleScanned}
        onComplete={() => setShowScanner(false)}
        onBack={() => setShowScanner(false)}
      />
    );
  }

  const intentBanner = pendingJoin
    ? `You're joining ${pendingJoin.orgName} — ${mode === 'signup' ? 'create your account' : 'sign in'} to continue.`
    : pendingCreate
      ? `You'll set up your organisation right after ${mode === 'signup' ? 'creating your account' : 'signing in'}.`
      : null;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.appName}>Snag</Text>
        <Text style={styles.tagline}>Workplace issue reporting</Text>

        {intentBanner && (
          <View style={styles.intentBanner}>
            <Icon name={pendingJoin ? 'business-outline' : 'sparkles-outline'} size="sm" color={Colors.primary} />
            <Text style={styles.intentBannerText}>{intentBanner}</Text>
            <TouchableOpacity onPress={handleClearIntent} hitSlop={8}>
              <Icon name="close" size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

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

        {/* First-time entry points: capture the intent here, resume it right
            after the account exists. */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>New to Snag?</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity onPress={() => setShowScanner(true)} activeOpacity={0.85}>
          <Card variant="elevated" style={styles.optionCard}>
            <Icon name="qr-code-outline" size="xl" color={Colors.primary} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Scan your company's QR code</Text>
              <Text style={styles.optionDesc}>Join your workplace from the poster on-site</Text>
            </View>
          </Card>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleCreateIntent} activeOpacity={0.85}>
          <Card variant="elevated" style={styles.optionCard}>
            <Icon name="business-outline" size="xl" color={Colors.primary} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Create an organisation</Text>
              <Text style={styles.optionDesc}>Set up Snag for your workplace</Text>
            </View>
          </Card>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    gap: Spacing.lg,
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
    marginTop: -Spacing.md,
  },
  intentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  intentBannerText: {
    flex: 1,
    fontSize: Typography.sm,
    color: Colors.textPrimary,
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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  optionDesc: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
  },
});
