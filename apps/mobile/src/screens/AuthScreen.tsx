import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable,
} from 'react-native';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import Button from '../components/Button';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  resendSignUpEmail, sendPasswordReset, signInWithEmail, signUpWithEmail, verifySignUpCode,
} from '../lib/supabase';
import {
  AuthErrorLike, AuthMode, MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT, describeAuthError, formProblem,
  isEmailNotConfirmed, looksLikeEmail, parseEmailCode,
} from '../lib/authForm';
import { confirmRedirectUrl } from '../lib/joinLink';
import { openUrl } from '../lib/openUrl';
import { PORTAL_URL } from '../lib/appUrl';

/**
 * Three stages, and the third is the one that used to be missing.
 *
 * Email confirmation is on, so creating an account answers with a user, no
 * session and no error — nothing has signed in, no auth event follows, and the
 * screen used to stop its spinner and say nothing at all. Somebody pressing
 * *Create account* again got a rate limit; somebody switching to *Sign in* got
 * "Email not confirmed" in a browser alert with no way to ask for the email
 * again. `checkEmail` is what the screen says instead, and a sign-in refused
 * for an unconfirmed address lands on it too.
 */
type Stage = AuthMode | 'checkEmail';

interface Notice {
  tone: 'error' | 'info';
  text: string;
}

interface Props {
  /**
   * A `/join/<token>` code in the address bar. Somebody holding one has just
   * scanned a household's QR and almost certainly has no account, so the screen
   * opens on *Create account* and says why they are here — and the code is
   * carried through the confirmation email's link, so tapping it lands back on
   * the join question rather than on *Set up your house*.
   */
  joinToken?: string | null;
}

export default function AuthScreen({ joinToken = null }: Props) {
  const insets = useEdgeInsets();
  const [stage, setStage] = useState<Stage>(joinToken ? 'signUp' : 'signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const address = email.trim();
  const redirectTo = confirmRedirectUrl(joinToken);

  function goTo(next: Stage) {
    setStage(next);
    setNotice(null);
    setCode('');
  }

  // Anything thrown rather than returned — a deadline firing mid-request — is
  // worded the same way as an answer, so a failure is never silent.
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setNotice({ tone: 'error', text: describeAuthError(err as AuthErrorLike) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (busy || stage === 'checkEmail') return;
    // The button is never dead: it says what the form still wants instead.
    const problem = formProblem(stage, email, password);
    if (problem) {
      setNotice({ tone: 'error', text: problem });
      return;
    }

    await run(async () => {
      if (stage === 'signIn') {
        const { error } = await signInWithEmail(address, password);
        if (error && isEmailNotConfirmed(error)) {
          goTo('checkEmail');
          setNotice({
            tone: 'info',
            text: "This address hasn't been confirmed yet. Use the link or the code in the email we sent, or send a new one.",
          });
        } else if (error) {
          setNotice({ tone: 'error', text: describeAuthError(error) });
        }
        // Signed in: App.tsx's auth listener takes over.
        return;
      }

      const { data, error } = await signUpWithEmail(address, password, redirectTo);
      if (error) {
        setNotice({ tone: 'error', text: describeAuthError(error) });
      } else if (!data.session) {
        // Also what Auth answers for an address that already has an account —
        // deliberately indistinguishable, so this screen never says which
        // addresses are signed up. The check-email stage offers *Sign in* for
        // exactly that case.
        goTo('checkEmail');
      }
      // A session means confirmation is off and the auth listener takes over.
    });
  }

  async function handleCode() {
    if (busy) return;
    const token = parseEmailCode(code);
    if (!token) {
      setNotice({ tone: 'error', text: 'Type the code from the email — it is 6 digits.' });
      return;
    }
    await run(async () => {
      const { error } = await verifySignUpCode(address, token);
      // Confirmed: a session arrives and App.tsx re-gates, join code intact.
      if (error) setNotice({ tone: 'error', text: describeAuthError(error) });
    });
  }

  async function handleResend() {
    if (busy) return;
    await run(async () => {
      const { error } = await resendSignUpEmail(address, redirectTo);
      setNotice(
        error
          ? { tone: 'error', text: describeAuthError(error) }
          : {
            tone: 'info',
            text: `Sent again to ${address}. It can take a minute to arrive — check spam if it doesn't.`,
          },
      );
    });
  }

  async function handleForgotPassword() {
    if (busy) return;
    if (!address) {
      setNotice({ tone: 'error', text: 'Enter your email address first, and we’ll send you a reset link.' });
      return;
    }
    if (!looksLikeEmail(address)) {
      setNotice({ tone: 'error', text: "That doesn't look like an email address." });
      return;
    }
    await run(async () => {
      // The link lands on the portal's /reset-password, not in this app — see
      // sendPasswordReset in lib/supabase.ts for why it has to be a plain web
      // page rather than a screen here.
      const { error } = await sendPasswordReset(address);
      setNotice(
        error
          ? { tone: 'error', text: describeAuthError(error) }
          // Worded so it says nothing about whether the address has an account,
          // which is also what Auth itself does.
          : { tone: 'info', text: `If ${address} has an account, a reset link is on its way to it.` },
      );
    });
  }

  const noticeView = notice ? (
    <Text
      style={[styles.notice, notice.tone === 'error' ? styles.noticeError : styles.noticeInfo]}
      accessibilityRole={notice.tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
    >
      {notice.text}
    </Text>
  ) : null;

  if (stage === 'checkEmail') {
    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + Spacing.xxxl, paddingBottom: insets.bottom + Spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brand}>
            <Icon name="mail-outline" size="xxl" color={Colors.primary} />
            <Text style={styles.heading}>Check your email</Text>
            <Text style={styles.body}>
              We've sent an email to {address}. Type the code from it here, or tap the link in it.
            </Text>
          </View>

          <Text style={styles.label}>Code from the email</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={setCode}
            accessibilityLabel="Code from the email"
            keyboardType="number-pad"
            inputMode="numeric"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={12}
            returnKeyType="go"
            enterKeyHint="go"
            onSubmitEditing={handleCode}
          />

          {noticeView}

          <Button label="Confirm" onPress={handleCode} loading={busy} disabled={busy} fullWidth />
          <Button
            label="Send it again"
            variant="outline"
            onPress={handleResend}
            disabled={busy}
            fullWidth
          />

          <Pressable
            onPress={() => goTo('signUp')}
            style={styles.link}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>Use a different address</Text>
          </Pressable>
          <Pressable
            onPress={() => goTo('signIn')}
            style={styles.link}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>Already have an account with this address? Sign in</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const signingUp = stage === 'signUp';

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.xxxl, paddingBottom: insets.bottom + Spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Icon name="home" size="xxl" color={Colors.primary} />
          <Text style={styles.title}>Snag</Text>
          <Text style={styles.tagline}>The list of things that need doing</Text>
        </View>

        {joinToken ? (
          <Text style={styles.intro}>
            {signingUp
              ? 'Create an account to join the household that shared this link.'
              : 'Sign in to join the household that shared this link.'}
          </Text>
        ) : null}

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          inputMode="email"
          // `textContentType` is iOS-native only; `autoComplete` is what the web
          // build — the one people install — hands to password managers.
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          enterKeyHint="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            ref={passwordRef}
            style={styles.passwordInput}
            value={password}
            onChangeText={setPassword}
            accessibilityLabel="Password"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            textContentType={signingUp ? 'newPassword' : 'password'}
            returnKeyType="go"
            enterKeyHint="go"
            onSubmitEditing={handleSubmit}
          />
          {/* A sibling of the box, never inside it, and a real 48pt target —
              hitSlop does nothing on the web build. */}
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            style={styles.eye}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          >
            <Icon
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size="md"
              color={Colors.textSecondary}
            />
          </Pressable>
        </View>
        {/* The rule, stated before anybody breaks it — and dropped while the
            notice below is saying the same thing in red. */}
        {signingUp && notice?.text !== PASSWORD_TOO_SHORT ? (
          <Text style={styles.hint}>At least {MIN_PASSWORD_LENGTH} characters.</Text>
        ) : null}

        {noticeView}

        <Button
          label={signingUp ? 'Create account' : 'Sign in'}
          onPress={handleSubmit}
          loading={busy}
          disabled={busy}
          fullWidth
          style={styles.submit}
        />

        {!signingUp ? (
          <Pressable
            onPress={handleForgotPassword}
            style={styles.link}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.linkText}>Forgot your password?</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => goTo(signingUp ? 'signIn' : 'signUp')}
          style={styles.link}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>
            {signingUp ? 'Already have an account? Sign in' : 'No account yet? Create one'}
          </Text>
        </Pressable>

        {/* Said where the details are collected, which is what the Privacy
            Act asks for — not after, on a screen nobody opens. */}
        {signingUp ? (
          <View style={styles.privacy}>
            <Text style={styles.privacyText}>
              Snag keeps your email address, your name and what your household adds, to run the
              app for you.
            </Text>
            <Pressable
              onPress={() => openUrl(`${PORTAL_URL}/privacy`)}
              style={styles.link}
              accessibilityRole="link"
            >
              <Text style={styles.linkText}>Privacy statement</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, gap: Spacing.sm },
  brand: { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.xl },
  title: {
    fontSize: Typography.xxxl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  heading: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  tagline: { fontSize: Typography.base, color: Colors.textSecondary },
  body: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  intro: {
    fontSize: Typography.base,
    color: Colors.textPrimary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.sm,
  },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
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
  codeInput: { fontSize: Typography.lg, letterSpacing: 4 },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    minHeight: MIN_TOUCH_TARGET,
  },
  passwordInput: {
    flex: 1,
    // On web a TextInput is an <input> with an intrinsic width that
    // `min-width: auto` will not shrink below; without this the eye is pushed
    // off the edge of the box.
    minWidth: 0,
    paddingLeft: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET,
  },
  eye: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontSize: Typography.sm, color: Colors.textMuted },
  notice: { fontSize: Typography.sm, lineHeight: 20, marginTop: Spacing.xs },
  noticeError: { color: Colors.danger },
  noticeInfo: { color: Colors.textPrimary },
  submit: { marginTop: Spacing.sm },
  link: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignItems: 'center' },
  linkText: {
    fontSize: Typography.sm,
    color: Colors.primary,
    fontWeight: Typography.medium,
    textAlign: 'center',
  },
  privacy: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  privacyText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
