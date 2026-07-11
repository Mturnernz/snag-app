import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { Platform, View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase, signOut, getProfile, createOrganisationAndOwner, resolveActiveOrg, getMemberships, Membership } from './src/lib/supabase';
import { getPendingIntent, clearPendingIntent, PendingJoin, PendingCreate } from './src/lib/pendingIntent';
import { Profile } from './src/types';
import RootNavigator from './src/navigation';
import AuthScreen from './src/screens/AuthScreen';
import OrgSetupScreen from './src/screens/OrgSetupScreen';
import AdminSetupScreen from './src/screens/AdminSetupScreen';
import OrgInactiveScreen from './src/screens/OrgInactiveScreen';
import { ToastProvider } from './src/hooks/useToast';

const PUBLIC_REPORTER_KEY = 'snag.publicReporterMode';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isNewAdmin, setIsNewAdmin] = useState(false);
  // Every org this user belongs to has been deactivated — non-null only in
  // that case. Checked ahead of the org-setup gate below since profile.org_id
  // is a mirror that can go stale if the org was deactivated after it was set.
  const [inactiveMemberships, setInactiveMemberships] = useState<Membership[] | null>(null);
  // "Just report an issue" — a signed-in user with no organisation who only
  // submits to public orgs. Persisted so app restarts skip the org-setup gate.
  const [publicReporter, setPublicReporter] = useState(false);
  // Intent captured on the login screen (QR scan / create-org) to resume
  // right after sign-up instead of showing the generic chooser.
  const [pendingJoin, setPendingJoin] = useState<PendingJoin | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(PUBLIC_REPORTER_KEY).then((v) => setPublicReporter(v === 'true'));
    getPendingIntent().then(({ join, create }) => {
      setPendingJoin(join);
      setPendingCreate(create);
    });
  }, []);

  function clearIntent() {
    clearPendingIntent();
    setPendingJoin(null);
    setPendingCreate(null);
  }

  // Resolves profile/org/pending-intent state for a signed-in user. Shared by
  // the auth-state listener and OrgInactiveScreen's "check again"/reactivate
  // flow, since both need the exact same resolution logic.
  async function loadUserState(userId: string) {
    // Checked first and independent of profile.org_id, which is just a mirror
    // that can go stale if the org was deactivated after it was last set.
    const memberships = await getMemberships();
    const allInactive = memberships.length > 0 && memberships.every((m) => !m.org_active);
    if (allInactive) {
      setInactiveMemberships(memberships);
      setProfile(await getProfile(userId));
      setLoading(false);
      return;
    }
    setInactiveMemberships(null);

    let p = await getProfile(userId);
    // Pick up any intent captured on the login screen after this component
    // mounted; drop it if the account already has an org.
    const { join, create } = await getPendingIntent();
    if (p?.org_id) {
      if (join || create) clearPendingIntent();
      setPendingJoin(null);
      setPendingCreate(null);
    } else if (create) {
      // Combined create-org flow: the account now exists, so create the
      // organisation (and its default site) automatically and drop the user
      // straight into the app — no OrgSetup/AdminSetup detour. On failure we
      // keep the stored intent (so a restart can retry) and fall through to
      // the manual org-setup chooser.
      const { error } = await createOrganisationAndOwner(create.orgName, create.name);
      if (!error) {
        await clearPendingIntent();
        p = await getProfile(userId);
      }
      setPendingJoin(null);
      setPendingCreate(null);
    } else {
      // No mirrored org yet, but the account may belong to one (e.g. a
      // worker whose active org was never set, or a single-org member).
      // Default it from memberships before falling back to org setup.
      const org = await resolveActiveOrg();
      if (org) {
        p = await getProfile(userId);
        setPendingJoin(null);
        setPendingCreate(null);
      } else {
        setPendingJoin(join);
        setPendingCreate(create);
      }
    }
    setProfile(p);
    setLoading(false);
  }

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
        setInactiveMemberships(null);
        setLoading(false);
      } else if (session && event !== 'TOKEN_REFRESHED') {
        await loadUserState(session.user.id);
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
        <ToastProvider>
          <AuthScreen />
        </ToastProvider>
      </SafeAreaProvider>
    );
  }

  // Every org this user belongs to has been deactivated.
  if (inactiveMemberships) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <ToastProvider>
          <OrgInactiveScreen
            memberships={inactiveMemberships}
            onRecheck={() => loadUserState(session.user.id)}
            onSignOut={signOut}
          />
        </ToastProvider>
      </SafeAreaProvider>
    );
  }

  // Signed in but not yet in an organisation (unless they've chosen the
  // public-reporter path, which needs no organisation at all).
  if (!profile?.org_id && !publicReporter) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <ToastProvider>
          <OrgSetupScreen
            userId={session.user.id}
            initialMode={undefined}
            pendingJoin={pendingJoin}
            onClearPending={clearIntent}
            onComplete={async () => {
              clearIntent();
              const p = await getProfile(session.user.id);
              setProfile(p);
              if (p?.role === 'officer_admin') {
                setIsNewAdmin(true);
              }
            }}
            onPublicReporter={() => {
              AsyncStorage.setItem(PUBLIC_REPORTER_KEY, 'true');
              setPublicReporter(true);
            }}
          />
        </ToastProvider>
      </SafeAreaProvider>
    );
  }

  // First-time admin setup after creating an organisation
  if (isNewAdmin && profile) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <ToastProvider>
          <AdminSetupScreen
            profile={profile}
            onDone={(name) => {
              if (name) setProfile(p => p ? { ...p, name } : p);
              setIsNewAdmin(false);
            }}
          />
        </ToastProvider>
      </SafeAreaProvider>
    );
  }

  // Fully set up — show the app
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <ToastProvider>
          {/* Public reporters may have no profile row yet — worker-level UI,
              with the Admin tab role-gated away. */}
          <RootNavigator userRole={profile?.role ?? 'worker'} />
        </ToastProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
