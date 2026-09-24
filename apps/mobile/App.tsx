import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { Session } from '@supabase/supabase-js';

import { supabase, getMyProfile, getMyHousehold } from './src/lib/supabase';
import { SchemaNotExposedError } from '@snag/supabase-queries';
import { createAuthEventQueue, planAuthEvent } from './src/lib/authEvents';
import { resetWebPathIfStale } from './src/lib/webLocation';
import { clearJoinToken, readJoinToken } from './src/lib/joinLink';
import { chooseGate } from './src/lib/gates';
import { Colors } from './src/constants/theme';
import { Household, Profile } from './src/types';
import RootNavigator from './src/navigation';
import { linking } from './src/navigation/linking';
import AuthScreen from './src/screens/AuthScreen';
import SetupScreen from './src/screens/SetupScreen';
import JoinScreen from './src/screens/JoinScreen';
import { ToastProvider } from './src/hooks/useToast';
import { HouseholdProvider } from './src/hooks/useHousehold';

/**
 * Three gates, not six.
 *
 * The retired product had to work out which of several organisations you were
 * acting in, whether it was still active, whether you'd seen onboarding, and
 * whether you'd arrived by QR code as an anonymous reporter. A household has
 * none of those questions: you are signed in or you aren't, and you are in a
 * household or you aren't.
 *
 * A join code is **not** a fourth gate, though it reads like one. It is a
 * question asked of somebody who arrived holding one, and only while they are
 * holding it: no token in the URL, no branch. It sits here rather than on a
 * route because the normal case is somebody who has just scanned a QR, signed
 * up, and has no household yet — so there is no navigator to route them
 * through. `/join/<token>` is deliberately unmapped in linking.ts for the same
 * reason. See src/lib/joinLink.ts.
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);
  // A configuration failure, not a data one — see loadAccount.
  const [fatal, setFatal] = useState<string | null>(null);

  // Anything touching Supabase from the auth callback goes through here.
  const queueAuthWork = useRef(createAuthEventQueue()).current;

  // Who the last auth event was about. A ref, not state: the subscription below
  // is set up once with `[]` deps, so it closes over the first render's values
  // and can never read `session`.
  const userIdRef = useRef<string | null>(null);

  // A `/join/<token>` code in the address bar. Read once on mount, because
  // resetWebPathIfStale preserves it across the sign-in round trip and the
  // question has to survive that trip too — signing up IS the journey for
  // somebody who just scanned a QR.
  const [joinToken, setJoinToken] = useState<string | null>(() => readJoinToken());

  async function loadAccount() {
    try {
      const [nextProfile, nextHousehold] = await Promise.all([
        getMyProfile(),
        getMyHousehold(),
      ]);
      setProfile(nextProfile);
      setHousehold(nextHousehold);
      setFatal(null);
    } catch (err) {
      console.error('Failed to load account:', err);
      // Everything else can retry on the next pull-to-refresh. This one can't:
      // if the `home` schema isn't exposed, no call will ever succeed, and the
      // app would otherwise render as a working account with nothing in it.
      if (err instanceof SchemaNotExposedError) setFatal(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      // Claim the user here too, so the INITIAL_SESSION that follows is
      // recognised as the same person and doesn't load the account twice.
      userIdRef.current = data.session?.user.id ?? null;
      if (data.session) queueAuthWork(loadAccount);
      else setLoading(false);
    });

    // This callback MUST stay synchronous. auth-js runs it inside its own lock
    // and awaits it, so awaiting any Supabase call here deadlocks the client
    // for the life of the page: no request is ever issued again, nothing
    // rejects, nothing is logged, and the per-request deadlines never fire
    // because it never reaches fetch. A hidden tab becoming visible is enough
    // to trigger it. Set state here; put anything touching Supabase through
    // the queue. See src/lib/authEvents.ts.
    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      const plan = planAuthEvent(event, userIdRef.current, nextUserId);
      userIdRef.current = nextUserId;

      if (plan.resetPath) resetWebPathIfStale();

      if (plan.clearAccount) {
        setSession(null);
        setProfile(null);
        setHousehold(null);
        setLoading(false);
        return;
      }

      // The session we already hold, announced again — a tab coming back from
      // the camera, a token refresh. Reloading here would unmount the navigator
      // and every open sheet with it, which is how a photo taken on step three
      // of the walkthrough became a trip back to the list with nothing saved.
      // See planAuthEvent.
      if (!plan.reloadAccount) return;

      setSession(nextSession);
      setLoading(true);
      queueAuthWork(loadAccount);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // One decision, made in one place and asserted in gates.test.ts. The order
  // used to live in the ladder below, where nothing could see it — which is how
  // the join branch shipped behind the Setup branch and behind a profile that a
  // brand-new scanner does not have.
  const gate = chooseGate({
    loading,
    fatal: !!fatal,
    signedIn: !!session,
    hasJoinToken: !!joinToken,
    hasProfile: !!profile,
    hasHousehold: !!household,
  });

  if (gate === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (gate === 'fatal') {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={styles.fatal}>
          <Text style={styles.fatalTitle}>Can't reach your data</Text>
          <Text style={styles.fatalBody}>{fatal}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (gate === 'auth') {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthScreen />
      </SafeAreaProvider>
    );
  }

  // Holding a code. **Signed in is enough — a profile is NOT required**, and
  // that distinction is the whole bug this branch once had.
  //
  // It read `joinToken && profile`, on the assumption that somebody who scanned
  // before signing up would pass through Setup and come back. They don't. A
  // brand-new scanner has no profile, so this was skipped, and Setup's first
  // offer is *Create it* with nothing on the screen mentioning the code they
  // just scanned. Alyssa scanned 32 Le Roy's code, was shown Setup, and created
  // a second household also called 32 Le Roy — alone in it, while the real one
  // sat two taps away. That is the exact journey this feature exists for, and
  // it was the one path that didn't work.
  //
  // So the gate comes BEFORE the Setup gate and asks for the name itself. A
  // scanner should never see "Set up your house": they are not setting one up.
  if (gate === 'join' && joinToken) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <ToastProvider>
          <JoinScreen
            token={joinToken}
            profile={profile}
            onJoined={loadAccount}
            onDismiss={() => {
              clearJoinToken();
              setJoinToken(null);
            }}
          />
        </ToastProvider>
      </SafeAreaProvider>
    );
  }

  // Signed in, but not yet in a household — either a brand new account, or the
  // second person waiting to be invited by the first.
  // `gate === 'app'` already means both of these are present — this narrows it
  // for the compiler, which cannot read chooseGate, and it is the same condition
  // rather than a second opinion about it.
  if (gate === 'setup' || !profile || !household) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <ToastProvider>
          <SetupScreen profile={profile} onReady={loadAccount} onJoinToken={setJoinToken} />
        </ToastProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <HouseholdProvider household={household} profile={profile} onReload={loadAccount}>
        <ToastProvider>
          <NavigationContainer linking={linking}>
            <RootNavigator />
          </NavigationContainer>
        </ToastProvider>
      </HouseholdProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  fatal: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: Colors.background,
  },
  fatalTitle: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary },
  fatalBody: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
