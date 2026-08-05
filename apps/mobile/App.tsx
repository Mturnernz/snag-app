import 'react-native-url-polyfill/auto';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, View, ActivityIndicator, Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase, signOut, getProfile, createOrganisationAndOwner, resolveActiveOrg, getMemberships, Membership, signInAnonymouslyForReport } from './src/lib/supabase';
import { getPendingIntent, clearPendingIntent, PendingJoin, PendingCreate } from './src/lib/pendingIntent';
import { createAuthEventQueue } from './src/lib/authEvents';
import { resetWebPathIfStale } from './src/lib/webLocation';
import { getInitialJoinCode } from './src/lib/joinLink';
import { navigationRef } from './src/lib/navigationRef';
import { Profile } from './src/types';
import RootNavigator from './src/navigation';
import { linking } from './src/navigation/linking';
import { TourProvider } from './src/context/TourContext';
import AuthScreen from './src/screens/AuthScreen';
import OrgSetupScreen from './src/screens/OrgSetupScreen';
import AdminSetupScreen from './src/screens/AdminSetupScreen';
import OrgInactiveScreen from './src/screens/OrgInactiveScreen';
import PublicQrReportScreen from './src/screens/PublicQrReportScreen';
import ScanJoinCodeScreen from './src/screens/ScanJoinCodeScreen';
import { ToastProvider } from './src/hooks/useToast';

const PUBLIC_REPORTER_KEY = 'snag.publicReporterMode';

// A scanned site QR code opens `<web-or-app-url>/?report=<token>` — resolved
// once on boot, before any session/org gate below. Read from the initial URL
// only (not live URL-change listening): this is a one-shot landing, not a
// persistent route.
async function getQrReportToken(): Promise<string | null> {
  const url = Platform.OS === 'web' ? window.location.href : await Linking.getInitialURL();
  if (!url) return null;
  try {
    return new URL(url).searchParams.get('report');
  } catch {
    return null;
  }
}

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

  // QR public-report landing — resolved once on boot. A ref mirrors the
  // state so the auth-listener closure below (registered once, empty deps)
  // always reads the latest value instead of the null it captured on the
  // first render.
  const [qrToken, setQrTokenState] = useState<string | null>(null);
  const [qrTokenChecked, setQrTokenChecked] = useState(false);
  // Org join QR landing — `?join=<code>`, the other printable code. Unlike the
  // report token this needs a real account, so it feeds the sign-up flow rather
  // than an anonymous session.
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [anonSignInAttempted, setAnonSignInAttempted] = useState(false);
  const qrTokenRef = useRef<string | null>(null);
  // Everything an auth event triggers runs through here, off the auth lock and
  // one at a time. See src/lib/authEvents.ts.
  const queueAuthWork = useRef(createAuthEventQueue()).current;
  function setQrToken(token: string | null) {
    qrTokenRef.current = token;
    setQrTokenState(token);
  }

  useEffect(() => {
    getQrReportToken().then((token) => {
      setQrToken(token);
      setQrTokenChecked(true);
    });
    getInitialJoinCode().then(setJoinCode);
  }, []);

  // Done with the join landing (joined, switched, or backed out). Drop the
  // param as well as the state so a refresh doesn't put them back on it.
  function clearJoinCode() {
    setJoinCode(null);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', '/');
    }
  }

  // Once the token is known and the initial session has resolved to "signed
  // out", sign in anonymously so create_public_snag_by_token's auth.uid()
  // check is satisfied without ever showing AuthScreen. Requires "Allow
  // anonymous sign-ins" enabled in the Supabase project's Auth settings; if
  // that's off (or the call otherwise fails), fall back to the normal
  // signed-out flow rather than leaving the QR path stuck on a spinner.
  useEffect(() => {
    if (!qrTokenChecked || !qrToken || anonSignInAttempted || loading || session) return;
    setAnonSignInAttempted(true);
    signInAnonymouslyForReport().then(({ error }) => {
      if (error) {
        console.error('Anonymous sign-in for QR report failed', error);
        setQrToken(null);
      }
    });
  }, [qrTokenChecked, qrToken, loading, session, anonSignInAttempted]);

  // A pending join carries the same code *plus* the name they gave at sign-up,
  // so it supersedes the raw link — otherwise the poster's `?join=`, which
  // survives the sign-in round trip by design, would out-rank it and ask for
  // the name a second time.
  useEffect(() => {
    if (pendingJoin && joinCode) clearJoinCode();
  }, [pendingJoin, joinCode]);

  // First-run onboarding used to be two full-screen gates here — a welcome
  // screen and a four-slide carousel, both worker-only. It is now the guided
  // walkthrough, which runs *inside* the app rather than in front of it (see
  // TourProvider below), so there is no gate: it starts itself for anyone whose
  // `tour_status` is `not_started`, whatever their role. A Site Lead or Manager
  // getting any first-run experience at all is new.
  //
  // The provider records progress; this keeps App's copy of the profile in step
  // so a remount doesn't re-read a stale status and restart the walkthrough.
  function handleTourStatus(status: NonNullable<Profile['tour_status']>, stepId: string | null) {
    setProfile((p) =>
      p
        ? {
            ...p,
            tour_status: status,
            tour_step: stepId,
            tour_updated_at: new Date().toISOString(),
            has_seen_onboarding: p.has_seen_onboarding || status === 'done',
          }
        : p,
    );
  }

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
    //
    // This callback MUST stay synchronous. auth-js runs it inside its lock and
    // awaits it, so awaiting a Supabase call in here deadlocks the whole client
    // permanently — no request is ever issued again, nothing rejects, nothing
    // is logged. It shipped that way and cost three rounds of debugging; see
    // src/lib/authEvents.ts for the cycle and how it gets triggered by nothing
    // more exotic than picking a photo and coming back.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);

      // Both ends of the sign-out/sign-in round trip, because either one alone
      // leaves a hole: SIGNED_OUT clears the `/profile` the Sign Out button
      // itself put in the address bar, and SIGNED_IN covers a session that
      // ended some other way (expiry, another tab). Deliberately not
      // INITIAL_SESSION — reloading the page on a tab is not logging in, and
      // staying put is what a browser is supposed to do. Synchronous, and
      // touches nothing but `history`, so it is safe in this callback.
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') resetWebPathIfStale();

      // Only re-fetch the profile on meaningful auth events.
      // TOKEN_REFRESHED must not overwrite a profile that was just set by
      // onComplete() after org creation — that would reset the user back to
      // OrgSetupScreen.
      if (event === 'SIGNED_OUT') {
        setProfile(null);
        setInactiveMemberships(null);
        setLoading(false);
      } else if (qrTokenRef.current) {
        // QR public-report path — PublicQrReportScreen is rendered
        // standalone below, never through the normal profile/org
        // resolution an anonymous reporter has none of.
        setLoading(false);
      } else if (session && event !== 'TOKEN_REFRESHED') {
        queueAuthWork(() => loadUserState(session.user.id));
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

  // QR public-report landing — bypasses every gate below (auth, org setup,
  // onboarding); the anonymous session is still being established until
  // `session` is set.
  if (qrToken) {
    if (!session) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9FAFB' }}>
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      );
    }
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <ToastProvider>
          <PublicQrReportScreen token={qrToken} userId={session.user.id} />
        </ToastProvider>
      </SafeAreaProvider>
    );
  }

  // Not signed in. A `?join=` code opens the sign-up stepper on the org it
  // names — that poster's audience is people without an account — but the
  // stepper's own "Back to sign in" still gets an existing user home.
  if (!session) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <ToastProvider>
          <AuthScreen initialJoinCode={joinCode} onClearJoinCode={clearJoinCode} />
        </ToastProvider>
      </SafeAreaProvider>
    );
  }

  // Signed in and landing on a join link: straight to the join step. Handles
  // the already-a-member case too — ScanJoinCodeScreen treats that as a switch
  // rather than a join, which is what scanning another site's poster means.
  if (joinCode) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <ToastProvider>
          <ScanJoinCodeScreen
            initialCode={joinCode}
            onComplete={async () => {
              clearJoinCode();
              // Not just getProfile: joining or switching changes the active
              // org and the membership set, which loadUserState owns.
              await loadUserState(session.user.id);
            }}
            onBack={clearJoinCode}
          />
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
      <NavigationContainer ref={navigationRef} linking={linking}>
        <StatusBar style="dark" backgroundColor="#FFFFFF" />
        <ToastProvider>
          {/* The walkthrough wraps the navigator rather than sitting inside a
              screen: its first steps point at the tab bar, and an overlay
              rendered inside a screen cannot draw over it. Inert without a
              profile — a public reporter has no role to filter steps by. */}
          <TourProvider profile={profile} onStatusChange={handleTourStatus}>
            {/* Public reporters may have no profile row yet — worker-level UI,
                with the Admin tab role-gated away. */}
            <RootNavigator userRole={profile?.role ?? 'worker'} />
          </TourProvider>
        </ToastProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
