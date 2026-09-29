import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Animated, AccessibilityInfo, Pressable,
} from 'react-native';

import SetupShell, { setupStyles } from './SetupShell';
import Button from '../components/Button';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import {
  resendSignUpEmail, sendPasswordReset, signInWithEmail, signUpWithEmail, verifySignUpCode,
} from '../lib/supabase';
import {
  AuthErrorLike, AuthMode, MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT, describeAuthError, formProblem,
  isEmailNotConfirmed, looksLikeEmail, parseEmailCode,
} from '../lib/authForm';
import { confirmRedirectUrl } from '../lib/joinLink';
import { googleSignInEnabled, signInWithGoogle } from '../lib/googleSignIn';
import { openUrl } from '../lib/openUrl';
import { PORTAL_URL } from '../lib/appUrl';

/**
 * The greetings the hello screen turns through: *Welcome*, then the languages
 * a house in Aotearoa is most likely to be spoken in. Exported for the test.
 */
export const GREETINGS = ['Welcome', 'Hello', 'Talofa', 'Mālō e lelei', 'Kia orana'];

/** How long each greeting stays before the next fades in. */
const GREETING_MS = 2200;

type Page = 'hello' | 'signin' | 'email' | 'password' | 'checkEmail';

interface Notice {
  tone: 'error' | 'info';
  text: string;
}

interface Props {
  /**
   * A `/join/<token>` code in the address bar. Somebody holding one has just
   * scanned a household's QR and almost certainly has no account, so the email
   * path opens on *Create account* and says why they are here — and the code
   * rides through the confirmation email's link (and Google's round trip), so
   * it lands back on the join question rather than on setting up a house.
   */
  joinToken?: string | null;
}

/**
 * Everything before there is an account: hello, then sign in, one question to
 * a screen.
 *
 * It opens the way a new phone does — a greeting, turning through the
 * languages people in this country say it in, on the plaster ground, and one
 * button. Then how to sign in (**Google**, when it is switched on — see
 * `googleSignInEnabled` — or straight to email when it is not), and then the
 * email path as three screens: *What's your email?*, the password, and — when
 * the account still needs confirming — **Check your email**.
 *
 * **Email confirmation is on, and that decides the shape.** Creating an account
 * answers with no session and no error; nothing has signed in and no auth event
 * follows, so the flow has to say what happens next. *Check your email* takes
 * the code from the email (the link signs in whichever browser the mail app
 * opens; the code is typed into the tab that asked, join code and all), sends
 * it again, and offers *Sign in* to everybody — Auth answers sign-up for an
 * address that already has an account exactly as it answers a new one, and the
 * screen never says which addresses are signed up. A sign-in refused for an
 * unconfirmed address lands there too.
 *
 * Three rules from the screen this replaced, kept whole:
 *
 * - **No dead buttons.** A press on an unfinished page says what it still
 *   wants (`formProblem`) instead of a disabled button that reads as broken.
 * - **Every refusal is words on the screen, never a `window.alert`**
 *   (`describeAuthError`), and none of them says whether an address exists.
 * - **Labels stay put and the browser is told what each box holds**
 *   (`autoComplete`), because the web build is the one people install and
 *   `textContentType` is iOS-only.
 *
 * Signing in ends here. App.tsx's auth listener takes over from the session;
 * nothing here routes anywhere.
 */
export default function WelcomeFlow({ joinToken = null }: Props) {
  const google = googleSignInEnabled();
  const [page, setPage] = useState<Page>('hello');
  const [mode, setMode] = useState<AuthMode>(joinToken ? 'signUp' : 'signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const address = email.trim();
  const redirectTo = confirmRedirectUrl(joinToken);
  const signingUp = mode === 'signUp';

  function goTo(next: Page, nextMode?: AuthMode) {
    setPage(next);
    if (nextMode) setMode(nextMode);
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

  async function handleGoogle() {
    await run(async () => {
      // On the web the page is leaving for Google; on native the listener has
      // the session. A cancelled sign-in simply stays here.
      await signInWithGoogle();
    });
  }

  function handleEmail() {
    if (!address) {
      setNotice({ tone: 'error', text: 'Enter your email address.' });
      return;
    }
    if (!looksLikeEmail(address)) {
      setNotice({ tone: 'error', text: "That doesn't look like an email address." });
      return;
    }
    goTo('password');
  }

  async function handlePassword() {
    if (busy) return;
    const problem = formProblem(mode, address, password);
    if (problem) {
      setNotice({ tone: 'error', text: problem });
      return;
    }

    await run(async () => {
      if (mode === 'signIn') {
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
      } else if (!data?.session) {
        // Also what Auth answers for an address that already has an account —
        // deliberately indistinguishable. *Check your email* offers *Sign in*
        // for exactly that case.
        goTo('checkEmail');
      }
      // A session means confirmation is off and the auth listener takes over.
    });
  }

  async function handleCode() {
    if (busy) return;
    const token = parseEmailCode(code);
    if (!token) {
      setNotice({ tone: 'error', text: 'Type the code from the email — just the digits.' });
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

  if (page === 'hello') {
    // With Google off there is only one way in, and a screen offering a choice
    // of one is a question with one answer.
    return <Hello onStart={() => goTo(google ? 'signin' : 'email')} />;
  }

  if (page === 'signin') {
    return (
      <SetupShell
        onBack={() => goTo('hello')}
        icon="person-circle-outline"
        title="Let's get you signed in"
        centered
        primary={{ label: 'Continue with Google', onPress: handleGoogle, loading: busy }}
        secondary={{ label: 'Use my email', onPress: () => goTo('email'), disabled: busy }}
      >
        {noticeView}
      </SetupShell>
    );
  }

  if (page === 'email') {
    return (
      <SetupShell
        onBack={() => goTo(google ? 'signin' : 'hello')}
        icon="mail-outline"
        title="What's your email?"
        body={joinToken ? 'You’ve been asked to join a household. Start with your email.' : undefined}
        primary={{ label: 'Continue', onPress: handleEmail }}
      >
        <Text style={setupStyles.label}>Email</Text>
        <TextInput
          style={setupStyles.input}
          value={email}
          onChangeText={(next) => {
            setEmail(next);
            if (notice) setNotice(null);
          }}
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
          onSubmitEditing={handleEmail}
          autoFocus
        />
        {noticeView}
      </SetupShell>
    );
  }

  if (page === 'checkEmail') {
    return (
      <SetupShell
        onBack={() => goTo('email')}
        icon="mail-unread-outline"
        title="Check your email"
        body={`We've sent an email to ${address}. Type the code from it here, or tap the link in it.`}
        primary={{ label: 'Confirm', onPress: handleCode, loading: busy }}
      >
        <Text style={setupStyles.label}>Code from the email</Text>
        <TextInput
          style={[setupStyles.input, styles.codeInput]}
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
        <Button
          label="Send it again"
          variant="outline"
          onPress={handleResend}
          disabled={busy}
          fullWidth
        />
        <Button
          label="Use a different address"
          variant="ghost"
          onPress={() => goTo('email', 'signUp')}
          disabled={busy}
          fullWidth
        />
        <Button
          label="Already have an account with this address? Sign in"
          variant="ghost"
          onPress={() => goTo('password', 'signIn')}
          disabled={busy}
          fullWidth
        />
      </SetupShell>
    );
  }

  let passwordBody = signingUp ? `Choose a password for ${address}.` : `Your password for ${address}.`;
  if (joinToken) {
    passwordBody = signingUp
      ? 'Create an account to join the household that shared this link.'
      : 'Sign in to join the household that shared this link.';
  }

  return (
    <SetupShell
      onBack={() => goTo('email')}
      icon="key-outline"
      title={signingUp ? 'Nice to meet you' : 'Welcome back'}
      body={passwordBody}
      primary={{
        label: signingUp ? 'Create account' : 'Sign in',
        onPress: handlePassword,
        loading: busy,
      }}
      secondary={{
        label: signingUp ? 'I already have an account' : "I'm new here",
        onPress: () => goTo('password', signingUp ? 'signIn' : 'signUp'),
        disabled: busy,
      }}
    >
      <Text style={setupStyles.label}>Password</Text>
      <View style={styles.passwordRow}>
        <TextInput
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
          onSubmitEditing={handlePassword}
          autoFocus
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
        <Text style={setupStyles.hint}>At least {MIN_PASSWORD_LENGTH} characters.</Text>
      ) : null}
      {noticeView}

      {!signingUp ? (
        <Button
          label="Forgot your password?"
          variant="ghost"
          onPress={handleForgotPassword}
          disabled={busy}
          fullWidth
        />
      ) : null}

      {/* Said where the details are collected, which is what the Privacy Act
          asks for — not after, on a screen nobody opens. */}
      {signingUp ? (
        <View style={styles.privacy}>
          <Text style={styles.privacyText}>
            Snag keeps your email address, your name and what your household adds, to run the
            app for you.
          </Text>
          <View style={styles.legalLinks}>
            <Pressable
              onPress={() => openUrl(`${PORTAL_URL}/privacy`)}
              style={styles.link}
              accessibilityRole="link"
            >
              <Text style={styles.linkText}>Privacy statement</Text>
            </Pressable>
            <Pressable
              onPress={() => openUrl(`${PORTAL_URL}/terms`)}
              style={styles.link}
              accessibilityRole="link"
            >
              <Text style={styles.linkText}>Terms</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SetupShell>
  );
}

/**
 * The first screen anybody sees: a greeting that turns through its languages,
 * the way a new phone says hello.
 *
 * **Still, for anybody who has asked for less motion** — one greeting, no
 * fade. The fade is a welcome, and a welcome that makes somebody feel unwell
 * is not one.
 */
function Hello({ onStart }: { onStart: () => void }) {
  const edge = useEdgeInsets();
  const [index, setIndex] = useState(0);
  const [still, setStill] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((reduce) => { if (live) setStill(!!reduce); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 350, useNativeDriver: false }).start(() => {
        setIndex((current) => (current + 1) % GREETINGS.length);
        Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: false }).start();
      });
    }, GREETING_MS);
    return () => clearInterval(timer);
  }, [still, fade]);

  return (
    <View style={[styles.hello, { paddingTop: edge.top, paddingBottom: edge.bottom + Spacing.lg }]}>
      <View style={styles.helloBody}>
        <Animated.Text
          style={[styles.greeting, { opacity: still ? 1 : fade }]}
          accessibilityRole="header"
        >
          {still ? GREETINGS[0] : GREETINGS[index]}
        </Animated.Text>
        <View style={styles.brand}>
          <Icon name="home" size="lg" color={Colors.primary} />
          <Text style={styles.brandName}>Snag</Text>
        </View>
        <Text style={styles.tagline}>The list of things that need doing around the house</Text>
      </View>
      <View style={styles.helloFoot}>
        <Button label="Get started" onPress={onStart} fullWidth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { fontSize: Typography.sm, lineHeight: 20 },
  noticeError: { color: Colors.danger },
  noticeInfo: { color: Colors.textPrimary },
  codeInput: { fontSize: Typography.lg, letterSpacing: 4 },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    minHeight: MIN_TOUCH_TARGET + 4,
  },
  passwordInput: {
    flex: 1,
    // On web a TextInput is an <input> with an intrinsic width that
    // `min-width: auto` will not shrink below; without this the eye is pushed
    // off the edge of the box.
    minWidth: 0,
    paddingLeft: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.body,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET,
  },
  eye: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
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
  legalLinks: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg },
  link: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignItems: 'center' },
  linkText: {
    fontSize: Typography.sm,
    color: Colors.primary,
    fontWeight: Typography.medium,
    textAlign: 'center',
  },
  hello: { flex: 1, backgroundColor: Colors.background },
  helloBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
  },
  greeting: {
    fontSize: 52,
    lineHeight: 62,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.xl },
  brandName: { fontSize: Typography.title3, fontWeight: Typography.bold, color: Colors.primary },
  tagline: { fontSize: Typography.subhead, color: Colors.textSecondary, textAlign: 'center' },
  helloFoot: { paddingHorizontal: Spacing.xl },
});
