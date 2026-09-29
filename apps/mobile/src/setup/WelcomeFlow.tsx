import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, AccessibilityInfo, Pressable,
} from 'react-native';

import SetupShell from './SetupShell';
import Button from '../components/Button';
import Icon from '../components/Icon';
import AuthScreen from '../screens/AuthScreen';
import { Colors, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useEdgeInsets } from '../hooks/useEdgeInsets';
import { signInWithGoogle } from '../lib/googleSignIn';
import { showAlert } from '../lib/alert';
import { openUrl } from '../lib/openUrl';
import { PORTAL_URL } from '../lib/appUrl';

/**
 * The greetings the hello screen turns through: *Welcome*, then the languages
 * a house in Aotearoa is most likely to be spoken in. Exported for the test.
 */
export const GREETINGS = ['Welcome', 'Hello', 'Talofa', 'Mālō e lelei', 'Kia orana'];

/** How long each greeting stays before the next fades in. */
const GREETING_MS = 2200;

type Page = 'hello' | 'signin' | 'email';

interface Props {
  /**
   * A `/join/<token>` code in the address bar. Somebody holding one has just
   * scanned a household's QR: the greeting is skipped, the sign-in screen says
   * why they are here, and email opens on *Create account* with the code
   * carried through the confirmation link.
   */
  joinToken?: string | null;
}

/**
 * Everything before there is an account: hello, then sign in.
 *
 * It opens the way a new phone does — a greeting, turning through the
 * languages people in this country say it in, on the plaster ground, and one
 * button. A household list is not software somebody is logged into, and the
 * first screen of it should not read like a login form.
 *
 * Then the choice. **Google first**, because signing into the account you
 * already have is the phone's own move and there is no password to invent;
 * email second, for anybody who would rather.
 *
 * **Email is `AuthScreen`, not a second form.** That screen carries every rule
 * sign-up has paid for — the *Check your email* stage with the code, errors in
 * words rather than an alert, eight-character new passwords, the join code
 * riding the confirmation link, the privacy statement where the details are
 * collected — and a second email form here would be two places for those rules
 * to drift apart.
 *
 * Signing in ends here. App.tsx's auth listener takes over from the session,
 * exactly as before; nothing here routes anywhere.
 */
export default function WelcomeFlow({ joinToken = null }: Props) {
  const [page, setPage] = useState<Page>(joinToken ? 'signin' : 'hello');
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

  if (page === 'hello') return <Hello onStart={() => setPage('signin')} />;

  if (page === 'email') {
    return <AuthScreen joinToken={joinToken} onBack={() => setPage('signin')} />;
  }

  return (
    <SetupShell
      onBack={joinToken ? undefined : () => setPage('hello')}
      icon="person-circle-outline"
      title="Let's get you signed in"
      body={joinToken ? 'Then you can join the household that shared this link.' : undefined}
      centered
      primary={{ label: 'Continue with Google', onPress: handleGoogle, loading: busy }}
      secondary={{ label: 'Use my email', onPress: () => setPage('email'), disabled: busy }}
    >
      {/* Google hands over a name and an address as well, so the statement is
          linked here too — where the details are collected, as the Privacy
          Act asks, not only on the email half. */}
      <View style={styles.privacy}>
        <Text style={styles.privacyText}>
          Snag keeps your email address, your name and what your household adds, to run the app
          for you.
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
  privacy: { alignItems: 'center', gap: Spacing.xs },
  privacyText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg },
  link: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  linkText: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.semibold },
});
