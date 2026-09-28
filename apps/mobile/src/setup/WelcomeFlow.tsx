import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Animated, AccessibilityInfo,
} from 'react-native';

import SetupShell, { setupStyles } from './SetupShell';
import Button from '../components/Button';
import Icon from '../components/Icon';
import { Colors, Spacing, Typography } from '../constants/theme';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import { sendPasswordReset, signInWithEmail, signUpWithEmail } from '../lib/supabase';
import { signInWithGoogle } from '../lib/googleSignIn';
import { showAlert } from '../lib/alert';

/**
 * The greetings the hello screen turns through — the languages a house in
 * Aotearoa is most likely to be spoken in, te reo first. Exported for the test.
 */
export const GREETINGS = ['Kia ora', 'Hello', 'Talofa', 'Mālō e lelei', 'Kia orana'];

/** How long each greeting stays before the next fades in. */
const GREETING_MS = 2200;

type Page = 'hello' | 'signin' | 'email' | 'password';
type Mode = 'signIn' | 'signUp';

/**
 * Everything before there is an account: hello, then sign in.
 *
 * It opens the way a new phone does — a greeting, turning through the
 * languages people in this country say it in, on the plaster ground, and one
 * button. A household list is not software somebody is logged into, and the
 * first screen of it should not read like a login form.
 *
 * Then one question to a screen. **Google first**, because signing into the
 * account you already have is the phone's own move and there is no password
 * to invent; email and a password second, for anybody who would rather.
 * Whether it is a new account or an old one is asked on the password screen,
 * where it matters (a new one needs a new password), with the switch between
 * them in words rather than a toggle.
 *
 * Signing in ends here. App.tsx's auth listener takes over from the session,
 * exactly as before; nothing here routes anywhere.
 */
export default function WelcomeFlow() {
  const [page, setPage] = useState<Page>('hello');
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleGoogle() {
    setBusy(true);
    try {
      await signInWithGoogle();
      // On the web the page is leaving for Google; on native the listener has
      // the session. A cancelled sign-in simply stays here.
    } catch (err: any) {
      showAlert("Couldn't sign in with Google", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePassword() {
    setBusy(true);
    try {
      if (mode === 'signIn') {
        const { error } = await signInWithEmail(email.trim(), password);
        if (error) showAlert("Couldn't sign in", error.message);
      } else {
        const { data, error } = await signUpWithEmail(email.trim(), password);
        if (error) showAlert("Couldn't create your account", error.message);
        // A project that confirms addresses answers with no session: say so,
        // rather than leaving somebody on a screen that looks like it ignored them.
        else if (!data?.session) {
          showAlert('Check your email', `We've sent a link to ${email.trim()} to finish signing up.`);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    const address = email.trim();
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

  if (page === 'hello') return <Hello onStart={() => setPage('signin')} />;

  if (page === 'signin') {
    return (
      <SetupShell
        onBack={() => setPage('hello')}
        icon="person-circle-outline"
        title="Let's get you signed in"
        body="Use your Google account, or your email — either works, new or old."
        primary={{ label: 'Continue with Google', onPress: handleGoogle, loading: busy }}
        secondary={{ label: 'Use my email', onPress: () => setPage('email'), disabled: busy }}
      />
    );
  }

  const emailOk = /\S+@\S+\.\S+/.test(email.trim());

  if (page === 'email') {
    return (
      <SetupShell
        onBack={() => setPage('signin')}
        icon="mail-outline"
        title="What's your email?"
        primary={{ label: 'Continue', onPress: () => setPage('password'), disabled: !emailOk }}
      >
        <TextInput
          style={setupStyles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          inputMode="email"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => emailOk && setPage('password')}
          accessibilityLabel="Email"
          autoFocus
        />
      </SetupShell>
    );
  }

  const signingUp = mode === 'signUp';
  return (
    <SetupShell
      onBack={() => setPage('email')}
      icon="key-outline"
      title={signingUp ? 'Nice to meet you' : 'Welcome back'}
      body={signingUp ? `Choose a password for ${email.trim()}.` : `Your password for ${email.trim()}.`}
      primary={{
        label: signingUp ? 'Create account' : 'Sign in',
        onPress: handlePassword,
        disabled: password.length < 6,
        loading: busy,
      }}
      secondary={{
        label: signingUp ? 'I already have an account' : "I'm new here",
        onPress: () => setMode(signingUp ? 'signIn' : 'signUp'),
        disabled: busy,
      }}
    >
      <TextInput
        style={setupStyles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete={signingUp ? 'new-password' : 'current-password'}
        textContentType={signingUp ? 'newPassword' : 'password'}
        returnKeyType="go"
        onSubmitEditing={() => password.length >= 6 && handlePassword()}
        accessibilityLabel="Password"
        autoFocus
      />
      {signingUp ? (
        <Text style={setupStyles.hint}>At least six characters.</Text>
      ) : (
        <Button
          label="Forgot your password?"
          variant="ghost"
          onPress={handleForgotPassword}
          disabled={busy}
          fullWidth
        />
      )}
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
