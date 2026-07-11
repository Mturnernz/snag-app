import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Organisation, Profile, SnagStatus, STATUS_LABELS, UserRole, RootStackParamList } from '../types';
import { supabase, getOrgStats, OrgStats, getMemberships, setOrganisationActive, Membership } from '../lib/supabase';
import { Colors, Spacing, Typography, Radius } from '../constants/theme';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import OrgSwitcherHeader from '../components/OrgSwitcherHeader';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// The three snag states worth surfacing at a glance on the dashboard.
const HEADLINE_STATUSES: SnagStatus[] = ['flagged', 'in_progress', 'resolved'];
const STATUS_COLOR: Record<SnagStatus, string> = {
  flagged: Colors.status.flagged,
  in_progress: Colors.status.inProgress,
  resolved: Colors.status.resolved,
  rca_pending: Colors.status.rcaPending,
};

export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats] = useState<OrgStats | null>(null);
  const [ownedOrgs, setOwnedOrgs] = useState<Membership[]>([]);
  const [togglingOrgId, setTogglingOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('profiles')
      .select('*, organisation:organisations!profiles_org_id_fkey(id, name, industry, plan_tier, join_code, is_public, public_intake_site_id, created_at, is_active)')
      .eq('id', user.id)
      .single();

    if (data) {
      const profile = data as unknown as Profile;
      setOrg((profile.organisation as Organisation | undefined) ?? null);
      setRole(profile.role);
      setIsAdmin(profile.role === 'officer_admin');
      if (profile.org_id) setStats(await getOrgStats(profile.org_id));
    }

    // Every org this user administers, active or not — the only place
    // deactivated orgs remain visible/manageable.
    const memberships = await getMemberships();
    setOwnedOrgs(memberships.filter((m) => m.role === 'officer_admin'));

    setLoading(false);
  }, []);

  function handleToggleActive(m: Membership) {
    const deactivating = m.org_active;
    Alert.alert(
      deactivating ? 'Deactivate organisation?' : 'Reactivate organisation?',
      deactivating
        ? `${m.org_name} will be hidden from every member's org switcher, and they won't be able to view or submit snags there until you reactivate it.`
        : `${m.org_name} will be visible again and members will be able to switch to it, view, and submit snags.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: deactivating ? 'Deactivate' : 'Reactivate',
          style: deactivating ? 'destructive' : 'default',
          onPress: async () => {
            setTogglingOrgId(m.org_id);
            const { error } = await setOrganisationActive(m.org_id, !deactivating);
            setTogglingOrgId(null);
            if (error) {
              Alert.alert('Error', error.message ?? 'Could not update organisation status');
            } else {
              await load();
            }
          },
        },
      ]
    );
  }

  // Reload on focus — the org this dashboard reflects is the active org, which
  // may have changed via the Profile switcher or a QR scan.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <OrgSwitcherHeader title="Admin" role={role} orgName={org?.name ?? null} onSwitched={load} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* Snapshot */}
        <View style={styles.statRow}>
          <Card variant="elevated" style={styles.statTile}>
            <Text style={styles.statValue}>{stats?.totalSnags ?? 0}</Text>
            <Text style={styles.statLabel}>Total snags</Text>
          </Card>
          <Card variant="elevated" style={styles.statTile}>
            <Text style={styles.statValue}>{stats?.totalMembers ?? 0}</Text>
            <Text style={styles.statLabel}>Members</Text>
          </Card>
        </View>

        <Card variant="elevated" style={styles.breakdownCard}>
          <Text style={styles.sectionLabel}>BY STATUS</Text>
          {HEADLINE_STATUSES.map((s) => (
            <View key={s} style={styles.breakdownRow}>
              <View style={styles.breakdownLeft}>
                <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[s] }]} />
                <Text style={styles.breakdownLabel}>{STATUS_LABELS[s]}</Text>
              </View>
              <Text style={styles.breakdownValue}>{stats?.byStatus[s] ?? 0}</Text>
            </View>
          ))}
        </Card>

        {/* Actions */}
        {isAdmin && (
          <Button
            label="Manage Organisation"
            icon="business-outline"
            onPress={() => navigation.navigate('ManageOrganisation')}
            fullWidth
          />
        )}
        <Button
          label="View Reports"
          variant="outline"
          icon="bar-chart-outline"
          onPress={() => navigation.navigate('Reports')}
          fullWidth
        />

        {!isAdmin && (
          <View style={styles.noteRow}>
            <Icon name="information-circle-outline" size="sm" color={Colors.textMuted} />
            <Text style={styles.noteText}>
              Organisation settings, sites and members are managed by an officer admin.
            </Text>
          </View>
        )}

        {/* Owned organisations, active or not — the only place a deactivated
            org stays visible and manageable. */}
        {ownedOrgs.length > 0 && (
          <Card variant="elevated" style={styles.ownedCard}>
            <Text style={styles.sectionLabel}>YOUR ORGANISATIONS</Text>
            {ownedOrgs.map((m) => (
              <View key={m.org_id} style={styles.ownedRow}>
                <View style={styles.ownedRowText}>
                  <View style={styles.ownedRowNameRow}>
                    <Text style={styles.ownedRowName}>{m.org_name}</Text>
                    {m.org_id === org?.id && <Text style={styles.ownedRowCurrent}>Current</Text>}
                  </View>
                  <View style={[styles.statusPill, m.org_active ? styles.statusPillActive : styles.statusPillInactive]}>
                    <Text style={[styles.statusPillText, m.org_active ? styles.statusPillTextActive : styles.statusPillTextInactive]}>
                      {m.org_active ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>
                {togglingOrgId === m.org_id ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <Button
                    label={m.org_active ? 'Deactivate' : 'Reactivate'}
                    variant={m.org_active ? 'dangerOutline' : 'outline'}
                    onPress={() => handleToggleActive(m)}
                  />
                )}
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },

  scroll: { padding: Spacing.lg, gap: Spacing.lg },

  statRow: { flexDirection: 'row', gap: Spacing.md },
  statTile: { flex: 1, alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  statValue: { fontSize: Typography.xxxl, fontWeight: Typography.bold, color: Colors.textPrimary },
  statLabel: { fontSize: Typography.sm, color: Colors.textSecondary },

  breakdownCard: { gap: Spacing.sm },
  sectionLabel: { fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.textMuted, letterSpacing: 0.8 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.xs },
  breakdownLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  breakdownLabel: { fontSize: Typography.base, color: Colors.textPrimary },
  breakdownValue: { fontSize: Typography.base, fontWeight: Typography.bold, color: Colors.textPrimary },

  noteRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', paddingHorizontal: Spacing.xs },
  noteText: { flex: 1, fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 18 },

  ownedCard: { gap: Spacing.md },
  ownedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  ownedRowText: { flex: 1, gap: Spacing.xs },
  ownedRowNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ownedRowName: { fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textPrimary },
  ownedRowCurrent: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.primary,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  statusPillActive: { backgroundColor: Colors.successBg },
  statusPillInactive: { backgroundColor: Colors.priority.mediumBg },
  statusPillText: { fontSize: Typography.xs, fontWeight: Typography.semibold },
  statusPillTextActive: { color: Colors.success },
  statusPillTextInactive: { color: Colors.priority.medium },
});
