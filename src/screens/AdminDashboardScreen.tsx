import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Organisation, Profile, SnagStatus, STATUS_LABELS, RootStackParamList } from '../types';
import { supabase, getOrgStats, OrgStats } from '../lib/supabase';
import { Colors, Spacing, Typography, Radius } from '../constants/theme';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';

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
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats] = useState<OrgStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('profiles')
      .select('*, organisation:organisations(id, name, industry, plan_tier, join_code, is_public, public_intake_site_id, created_at)')
      .eq('id', user.id)
      .single();

    if (data) {
      const profile = data as unknown as Profile;
      setOrg((profile.organisation as Organisation | undefined) ?? null);
      setIsAdmin(profile.role === 'officer_admin');
      if (profile.org_id) setStats(await getOrgStats(profile.org_id));
    }
    setLoading(false);
  }, []);

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

  const orgName = org?.name ?? 'Your Organisation';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Admin</Text>
        <Text style={styles.headerSub}>{orgName}</Text>
      </View>

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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },

  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.textPrimary },
  headerSub: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: 2 },

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
});
