import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { Session } from '@supabase/supabase-js';

import { supabase, getMyProfile, getMyHousehold } from './src/lib/supabase';
import { createAuthEventQueue } from './src/lib/authEvents';
import { resetWebPathIfStale } from './src/lib/webLocation';
import { Colors } from './src/constants/theme';
import { Household, Profile } from './src/types';
import RootNavigator from './src/navigation';
import { linking } from './src/navigation/linking';
import AuthScreen from './src/screens/AuthScreen';
import SetupScreen from './src/screens/SetupScreen';
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
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);

  // Anything touching Supabase from the auth callback goes through here.
  const queueAuthWork = useRef(createAuthEventQueue()).current;

  async function loadAccount() {
    try {
      const [nextProfile, nextHousehold] = await Promise.all([
        getMyProfile(),
        getMyHousehold(),
      ]);
      setProfile(nextProfile);
      setHousehold(nextHousehold);
    } catch (err) {
      console.error('Failed to load account:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
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
      setSession(nextSession);
      resetWebPathIfStale();

      if (event === 'SIGNED_OUT') {
        setProfile(null);
        setHousehold(null);
        setLoading(false);
        return;
      }
      if (nextSession) {
        setLoading(true);
        queueAuthWork(loadAccount);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!session) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AuthScreen />
      </SafeAreaProvider>
    );
  }

  // Signed in, but not yet in a household — either a brand new account, or the
  // second person waiting to be added by the first.
  if (!profile || !household) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <ToastProvider>
          <SetupScreen profile={profile} onReady={loadAccount} />
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
});
