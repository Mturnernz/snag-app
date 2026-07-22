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
  getPendingIntent, clearPendingIntent, PendingJoin, PendingCreate,
} from '../lib/pendingIntent';
import { Colors, Spacing, Typography, Radius, MIN_TOUCH_TARGET } from '../constants/theme';
import Button from '../components/Button';
import Card from '../components/Card';
import Icon from '../components/Icon';
import SignUpScreen from './SignUpScreen';
import CreateOrgAccountScreen from './CreateOrgAccountScreen';

type View_ = 'main' | 'signup' | 'signUpFlow' | 'createOrg';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<View_>('main');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [offerSignup, setOfferSignup] = useState(false);

  const [pendingJoin, setPendingJoinState] = useState<PendingJoin | null>(null);
  const [pendingCreate, setPendingCreateState] = useState<PendingCreate | null>(null);

  useEffect(() => {
    getPendingIntent().then(({ join, create }) => {
      setPendingJoinState(join);
      setPendingCreateState(create);
    });
  }, []);

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setMessage({ text: 'Please enter your email and password.', error: true });
      return;
    }
    setLoading(true);
    setMessage(null);
    setOfferSignup(false);
    const { error } = await signInWithEmail(email.trim(), password);
    setLoading(false);
    if (error) {
      // Supabase returns a generic "Invalid login credentials" whether the
      // password is wrong or no account exists — offer sign-up either way.
      setMessage({ text: "We couldn't sign you in. Check your details, or create an account.", error: true });
      setOfferSignup(true);
    }
    // On success the auth listener in App.tsx takes over.
  }

  async function handleSignUp() {
    if (!email.trim() || !password) {
      setMessage({ text: 'Please enter your email and a password.', error: true });
      return;
    }
    setLoading(true);
    setMessage(null);
    const { error } = await signUpWithEmail(email.trim(), password);
    setLoading(false);
    if (error) {
      setMessage({ text: error.message ?? 'Could not create your account.', error: true });
      return;
    }
    setMessage({ text: 'Account created. Confirm your email, then sign in.', error: false });
    setView('main');
  }

  function handleClearIntent() {
    clearPendingIntent();
    setPendingJoinState(null);
    setPendingCreateState(null);
  }

  // ── Sub-views ────────────────────────────────────────────────────────────

  if (view === 'signUpFlow') {
    return (
      <SignUpScreen
        onBack={() => setView('main')}
        onDone={(msg) => {
          getPendingIntent().then(({ join }) => setPendingJoinState(join));
          setMessage({ text: msg, error: false });
          setView('main');
        }}
      />
    );
  }

  if (view === 'createOrg') {
    return (
      <CreateOrgAccountScreen
        onBack={() => setView('main')}
        onDone={(msg) => {
          getPendingIntent().then(({ create }) => setPendingCreateState(create));
          setMessage({ text: msg, error: false });
          setView('main');
        }}
      />
    );
  }

  // Plain sign-up (no org context) — offered after a failed sign-in attempt.
  if (view === 'signup') {
    return (
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <Text style={styles.appName}>Snag</Text>
          <Text style={styles.heading}>Create your account</Text>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={Colors.textMuted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={Colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleSignUp}
            />
            {message && (
              <Text style={[styles.message, message.error ? styles.messageError : styles.messageSuccess]}>
                {message.text}
              </Text>
            )}
            <Button label="Create Account" onPress={handleSignUp} loading={loading} fullWidth style={styles.submitButton} />
          </View>

          <TouchableOpacity onPress={() => { setView('main'); setMessage(null); }}>
            <Text style={styles.switchText}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Main sign-in view ────────────────────────────────────────────────────

  const intentBanner = pendingJoin
    ? `You're joining ${pendingJoin.orgName} — sign in to continue.`
    : pendingCreate
      ? `Sign in to finish setting up ${pendingCreate.orgName}.`
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

        {/* Option 1: Sign in */}
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={Colors.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={Colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleSignIn}
          />
          {message && (
            <Text style={[styles.message, message.error ? styles.messageError : styles.messageSuccess]}>
              {message.text}
            </Text>
          )}
          <Button label="Sign In" onPress={handleSignIn} loading={loading} fullWidth style={styles.submitButton} />
          {offerSignup && (
            <Button label="Create an account" variant="outline" onPress={() => { setView('signup'); setMessage(null); }} fullWidth />
          )}
        </View>

        {/* Options 2 & 3: Scan QR / Create organisation */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>New to Snag?</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity onPress={() => setView('signUpFlow')} activeOpacity={0.85}>
          <Card variant="elevated" style={styles.optionCard}>
            <Icon name="person-add-outline" size="xl" color={Colors.primary} />
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Sign Up</Text>
              <Text style={styles.optionDesc}>Join your workplace with a company code or QR scan</Text>
            </View>
          </Card>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setView('createOrg')} activeOpacity={0.85}>
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
  container: { flex: 1, backgroundColor: Colors.background },
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
  heading: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
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
  message: {
    fontSize: Typography.sm,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button,
  },
  messageError: { color: Colors.danger, backgroundColor: Colors.priority.highBg },
  messageSuccess: { color: Colors.success, backgroundColor: Colors.successBg },
  submitButton: { marginTop: Spacing.sm },
  switchText: { fontSize: Typography.sm, color: Colors.primary, textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: Typography.sm, color: Colors.textMuted },
  optionCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  optionDesc: { fontSize: Typography.sm, color: Colors.textSecondary },
});
