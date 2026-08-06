import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';

import { UserRole, RootStackParamList, ManageTab, MANAGE_TAB_LABELS } from '../types';
import { supabase } from '../lib/supabase';
import { Colors, Spacing } from '../constants/theme';
import ScreenHeader from '../components/ScreenHeader';
import Chip from '../components/Chip';
import EmptyState from '../components/EmptyState';

import OrganisationTab from './manage/OrganisationTab';
import SitesTab from './manage/SitesTab';
import TeamsTab from './manage/TeamsTab';

type Route = RouteProp<RootStackParamList, 'Manage'>;

// One screen for the three things an organisation configures. They were three
// screens reached from three buttons, and the seams between them were where
// things went missing: site creation existed in three places, a site's QR code
// sat on one screen while the switch that makes it work sat on another, and a
// work group could be scoped to a site by someone who couldn't open the site
// list.
//
// Each tab loads its own data. They are independent enough that a shared
// loader would only be a bigger thing to invalidate, and every tab has pull-to-
// refresh of its own.
export default function ManageScreen() {
  const route = useRoute<Route>();
  const requestedTab = route.params?.tab;

  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ManageTab | null>(null);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (data) setRole(data.role as UserRole);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const isAdmin = role === 'officer_admin';
  const isSupervisor = role === 'supervisor';

  // Work groups have always been admin-or-supervisor while sites and the
  // organisation are admin-only, so a supervisor gets one tab rather than a
  // screen with two locked doors on it.
  const availableTabs: ManageTab[] = isAdmin
    ? ['organisation', 'sites', 'teams']
    : isSupervisor
      ? ['teams']
      : [];

  // Held until the role is known: `tab` decides what renders, and defaulting it
  // before then would flash the wrong panel at a supervisor.
  useEffect(() => {
    if (loading || availableTabs.length === 0) return;
    setTab((prev) => {
      if (prev && availableTabs.includes(prev)) return prev;
      if (requestedTab && availableTabs.includes(requestedTab)) return requestedTab;
      return availableTabs[0];
    });
  }, [loading, role, requestedTab]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Manage" />
        <View style={styles.centre}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  }

  if (availableTabs.length === 0) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Manage" />
        <View style={styles.centre}>
          <EmptyState
            icon="lock-closed-outline"
            title="Managers and Site Leads only"
            message="Only a manager or Site Lead can change how this organisation is set up."
          />
        </View>
      </View>
    );
  }

  // The effect below settles `tab` a tick after loading ends, so render off a
  // fallback rather than blanking for that frame.
  const activeTab = tab && availableTabs.includes(tab) ? tab : availableTabs[0];

  return (
    <View style={styles.container}>
      <ScreenHeader title="Manage" />

      {availableTabs.length > 1 && (
        <View style={styles.tabBar}>
          <Chip
            options={availableTabs.map((t) => ({ key: t, label: MANAGE_TAB_LABELS[t] }))}
            value={activeTab}
            onChange={(next) => setTab(next)}
            variant="segmented"
          />
        </View>
      )}

      {activeTab === 'organisation' && <OrganisationTab />}
      {activeTab === 'sites' && <SitesTab />}
      {activeTab === 'teams' && <TeamsTab />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  tabBar: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.background,
  },
});
