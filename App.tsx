import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { Session } from '@supabase/supabase-js';

import { supabase, getProfile } from './src/lib/supabase';
import { Profile } from './src/types';
import RootNavigator from './src/navigation';
import AuthScreen from './src/screens/AuthScreen';
import OrgSetupScreen from './src/screens/OrgSetupScreen';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (Platform.OS === 'android') {
      import('expo-navigation-bar').then(NavigationBar => {
        NavigationBar.setVisibilityAsync('hidden');
        NavigationBar.setBehaviorAsync('overlay-swipe');
      });
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session) {
        const p = await getProfile(session.user.id);
        setProfile(p);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session) {
        const p = await getProfile(session.user.id);
        setProfile(p);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return null;

  // Not signed in
  if (!session) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <AuthScreen />
      </SafeAreaProvider>
    );
  }

  // Signed in but not yet in an organisation
  if (!profile?.organisation_id) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <OrgSetupScreen
          userId={session.user.id}
          onComplete={async () => {
            const p = await getProfile(session.user.id);
            setProfile(p);
          }}
        />
      </SafeAreaProvider>
    );
  }

  // Fully set up — show the app
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
