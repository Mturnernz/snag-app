import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { Session } from '@supabase/supabase-js';
import * as SplashScreen from 'expo-splash-screen';

import { supabase, getProfile } from './src/lib/supabase';
import { Profile } from './src/types';
import UserProfileContext from './src/context/UserProfileContext';
import RootNavigator from './src/navigation';
import AuthScreen from './src/screens/AuthScreen';
import OrgSetupScreen from './src/screens/OrgSetupScreen';
import AdminSetupScreen from './src/screens/AdminSetupScreen';

// Hold the native splash screen until auth state is resolved.
// Users see the branded splash instead of a blank white spinner.
SplashScreen.preventAutoHideAsync();

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
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

  // Hide native splash once auth is resolved — replaces the blank ActivityIndicator.
  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

  // Keep native splash visible while resolving (no JS-side blank screen).
  if (loading) return null;

  const userId = session?.user.id ?? null;
  const orgId = profile?.organisation_id ?? null;
  const contextValue = { session, profile, userId, orgId, setProfile };

  if (!session) {
    return (
      <UserProfileContext.Provider value={contextValue}>
        <SafeAreaProvider>
          <StatusBar style="dark" backgroundColor="#FFFFFF" />
          <AuthScreen />
        </SafeAreaProvider>
      </UserProfileContext.Provider>
    );
  }

  if (!profile?.organisation_id) {
    return (
      <UserProfileContext.Provider value={contextValue}>
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
      </UserProfileContext.Provider>
    );
  }

  if (isNewAdmin) {
    return (
      <UserProfileContext.Provider value={contextValue}>
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
      </UserProfileContext.Provider>
    );
  }

  return (
    <UserProfileContext.Provider value={contextValue}>
      <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar style="dark" backgroundColor="#FFFFFF" />
          <RootNavigator userRole={profile.role} />
        </NavigationContainer>
      </SafeAreaProvider>
    </UserProfileContext.Provider>
  );
}
