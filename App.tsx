import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { Platform, View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { Session } from '@supabase/supabase-js';

import { supabase, getProfile } from './src/lib/supabase';
import { Profile } from './src/types';
import RootNavigator from './src/navigation';
import AuthScreen from './src/screens/AuthScreen';
import OrgSetupScreen from './src/screens/OrgSetupScreen';
import AdminSetupScreen from './src/screens/AdminSetupScreen';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isNewAdmin, setIsNewAdmin] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'android') {
      import('expo-navigation-bar').then(NavigationBar => {
        NavigationBar.setVisibilityAsync('hidden');
        NavigationBar.setBehaviorAsync('overlay-swipe');
      });
    }

    // onAuthStateChange fires on initial load (INITIAL_SESSION event) and
    // also after processing the URL hash from email confirmation links.
    // Using it exclusively avoids a race condition on web where getSession()
    // runs before the hash token has been exchanged.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      // Only re-fetch the profile on meaningful auth events.
      // TOKEN_REFRESHED must not overwrite a profile that was just set by
      // onComplete() after org creation — that would reset the user back to
      // OrgSetupScreen.
      if (event === 'SIGNED_OUT') {
        setProfile(null);
        setLoading(false);
      } else if (session && event !== 'TOKEN_REFRESHED') {
        const p = await getProfile(session.user.id);
        setProfile(p);
        setLoading(false);
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9FAFB' }}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

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
            if (p?.role === 'admin') {
              setIsNewAdmin(true);
            }
          }}
        />
      </SafeAreaProvider>
    );
  }

  // First-time admin setup after creating an organisation
  if (isNewAdmin) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <AdminSetupScreen
          profile={profile}
          onDone={(name) => {
            if (name) setProfile(p => p ? { ...p, name } : p);
            setIsNewAdmin(false);
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
        <RootNavigator userRole={profile.role} />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
