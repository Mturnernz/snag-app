import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Organisation, Profile, UserRole, RootStackParamList } from '../types';
import {
  supabase, getSiteBreakdown, SiteBreakdown, getMemberships, setOrganisationActive, Membership,
  getUnassignedSnags, UnassignedSnag, getSiteAssignees, SiteAssignee, assignSnagOwner,
} from '../lib/supabase';
import { Colors, Spacing, Typography, Radius } from '../constants/theme';
import { useBreakpoint } from '../hooks/useBreakpoint';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import OrgSwitcherHeader from '../components/OrgSwitcherHeader';
import OwnerPicker from '../components/OwnerPicker';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function AdminDashboardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { isWide } = useBreakpoint();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [siteBreakdown, setSiteBreakdown] = useState<SiteBreakdown[]>([]);
  // One-click assign — tapping a site's "Unassigned" count expands its
  // unassigned snags right there, each with an OwnerPicker that assigns
  // immediately (no staged-edit step, unlike ManageIssuePanel's own use of
  // the same picker).
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);
  const [unassignedBySite, setUnassignedBySite] = useState<Record<string, UnassignedSnag[]>>({});
  const [siteAssigneesCache, setSiteAssigneesCache] = useState<Record<string, SiteAssignee[]>>({});
  const [assigningSnagId, setAssigningSnagId] = useState<string | null>(null);
  const [ownedOrgs, setOwnedOrgs] = useState<Membership[]>([]);
  const [togglingOrgId, setTogglingOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const canManageWorkGroups = role === 'officer_admin' || role === 'supervisor';

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
      // This screen is only reachable via the Admin tab, already gated to
      // supervisor/officer_admin — no extra role check needed here.
      if (profile.org_id) setSiteBreakdown(await getSiteBreakdown(profile.org_id));
    }

    // Every org this user administers, active or not — the only place
    // deactivated orgs remain visible/manageable.
    const memberships = await getMemberships();
    setOwnedOrgs(memberships.filter((m) => m.role === 'officer_admin'));

    setLoading(false);
  }, []);

  async function toggleUnassignedExpand(siteId: string) {
    if (expandedSiteId === siteId) { setExpandedSiteId(null); return; }
    setExpandedSiteId(siteId);
    if (!unassignedBySite[siteId]) {
      const snags = await getUnassignedSnags(siteId);
      setUnassignedBySite((prev) => ({ ...prev, [siteId]: snags }));
    }
    if (!siteAssigneesCache[siteId]) {
      const { data } = await getSiteAssignees(siteId);
      setSiteAssigneesCache((prev) => ({ ...prev, [siteId]: data }));
    }
  }

  async function handleQuickAssign(siteId: string, snagId: string, ownerId: string) {
    setAssigningSnagId(snagId);
    const { error } = await assignSnagOwner(snagId, ownerId);
    setAssigningSnagId(null);
    if (error) {
      Alert.alert('Error', error.message ?? 'Could not assign this snag');
      return;
    }
    setUnassignedBySite((prev) => ({ ...prev, [siteId]: prev[siteId].filter((s) => s.id !== snagId) }));
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', user.id).single();
      if (profile?.org_id) setSiteBreakdown(await getSiteBreakdown(profile.org_id));
    }
  }

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
        {/* Outstanding work — open investigations, unassigned reports, and
            overdue corrective actions, by site. The full org-wide status/
            type/severity breakdown still lives on Reports; this is the
            site-scoped complement, not a replacement. */}
        <Card variant="elevated" style={styles.breakdownCard}>
          <Text style={styles.sectionLabel}>OUTSTANDING WORK</Text>
          {siteBreakdown.length === 0 && (
            <Text style={styles.hintMuted}>No sites yet.</Text>
          )}
          {isWide ? (
            <View style={styles.siteTable}>
              <View style={styles.siteTableHeaderRow}>
                <Text style={[styles.siteTableHeaderCell, styles.siteNameCol]}>Site</Text>
                <Text style={styles.siteTableHeaderCell}>Open investigations</Text>
                <Text style={styles.siteTableHeaderCell}>Unassigned</Text>
                <Text style={styles.siteTableHeaderCell}>Overdue actions</Text>
              </View>
              {siteBreakdown.map((s) => (
                <React.Fragment key={s.siteId}>
                  <View style={styles.siteTableRow}>
                    <Text style={[styles.siteTableCell, styles.siteNameCol, styles.siteNameCellText]} numberOfLines={1}>
                      {s.siteName}
                    </Text>
                    <SiteCountCell value={s.openInvestigations} />
                    <SiteCountCell
                      value={s.unassigned}
                      onPress={s.unassigned > 0 ? () => toggleUnassignedExpand(s.siteId) : undefined}
                    />
                    <SiteCountCell value={s.overdueActions} alert />
                  </View>
                  {expandedSiteId === s.siteId && (
                    <UnassignedQuickAssign
                      siteId={s.siteId}
                      snags={unassignedBySite[s.siteId] ?? []}
                      assignees={siteAssigneesCache[s.siteId] ?? []}
                      assigningSnagId={assigningSnagId}
                      onAssign={handleQuickAssign}
                    />
                  )}
                </React.Fragment>
              ))}
            </View>
          ) : (
            siteBreakdown.map((s) => (
              <React.Fragment key={s.siteId}>
                <View style={styles.siteCardMobile}>
                  <Text style={styles.siteNameCellText}>{s.siteName}</Text>
                  <View style={styles.siteStatRow}>
                    <SiteStat label="Open investigations" value={s.openInvestigations} />
                    <SiteStat
                      label="Unassigned"
                      value={s.unassigned}
                      onPress={s.unassigned > 0 ? () => toggleUnassignedExpand(s.siteId) : undefined}
                    />
                    <SiteStat label="Overdue actions" value={s.overdueActions} alert />
                  </View>
                  {expandedSiteId === s.siteId && (
                    <UnassignedQuickAssign
                      siteId={s.siteId}
                      snags={unassignedBySite[s.siteId] ?? []}
                      assignees={siteAssigneesCache[s.siteId] ?? []}
                      assigningSnagId={assigningSnagId}
                      onAssign={handleQuickAssign}
                    />
                  )}
                </View>
              </React.Fragment>
            ))
          )}
        </Card>

        {/* Actions */}
        {isAdmin && (
          <>
            <Button
              label="Manage Organisation"
              icon="business-outline"
              onPress={() => navigation.navigate('ManageOrganisation')}
              fullWidth
            />
            <Button
              label="Manage Sites"
              variant="outline"
              icon="location-outline"
              onPress={() => navigation.navigate('ManageSites')}
              fullWidth
            />
          </>
        )}
        {canManageWorkGroups && (
          <Button
            label="Manage Work Groups"
            variant="outline"
            icon="people-circle-outline"
            onPress={() => navigation.navigate('ManageWorkGroups')}
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
              Organisation settings and sites are managed by a manager.
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

function SiteCountCell({ value, alert, onPress }: { value: number; alert?: boolean; onPress?: () => void }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.siteTableCell} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.siteCountText, alert && value > 0 && styles.siteCountTextAlert, onPress && styles.siteCountTextTappable]}>
        {value}
      </Text>
    </Wrapper>
  );
}

function SiteStat({ label, value, alert, onPress }: { label: string; value: number; alert?: boolean; onPress?: () => void }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.siteStat} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.siteCountText, alert && value > 0 && styles.siteCountTextAlert, onPress && styles.siteCountTextTappable]}>
        {value}
      </Text>
      <Text style={styles.siteStatLabel}>{label}</Text>
    </Wrapper>
  );
}

// One-click assign — the list of a site's unassigned snags, each with an
// inline OwnerPicker that assigns immediately on tap (no staged-edit step).
function UnassignedQuickAssign({
  siteId, snags, assignees, assigningSnagId, onAssign,
}: {
  siteId: string;
  snags: UnassignedSnag[];
  assignees: SiteAssignee[];
  assigningSnagId: string | null;
  onAssign: (siteId: string, snagId: string, ownerId: string) => void;
}) {
  if (snags.length === 0) {
    return <Text style={styles.hintMuted}>Nothing unassigned here right now.</Text>;
  }
  return (
    <View style={styles.quickAssignBlock}>
      {snags.map((snag) => (
        <View key={snag.id} style={styles.quickAssignRow}>
          <Text style={styles.quickAssignDescription} numberOfLines={1}>
            {snag.reference} · {snag.description || 'No description'}
          </Text>
          {assigningSnagId === snag.id ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <OwnerPicker
              assignees={assignees}
              currentOwnerId={null}
              allowUnassign={false}
              onSelect={(ownerId) => { if (ownerId) onAssign(siteId, snag.id, ownerId); }}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },

  scroll: { padding: Spacing.lg, gap: Spacing.lg },

  breakdownCard: { gap: Spacing.sm },
  sectionLabel: { fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.textMuted, letterSpacing: 0.8 },

  // Outstanding-work site breakdown — table layout on wide (web/tablet)
  // viewports, stacked cards on phone width. First responsive layout in
  // the app; see useBreakpoint.
  siteTable: { gap: 2 },
  siteTableHeaderRow: { flexDirection: 'row', paddingBottom: Spacing.xs, borderBottomWidth: 1, borderBottomColor: Colors.border },
  siteTableHeaderCell: { flex: 1, fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.textMuted, textAlign: 'center' },
  siteTableRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  siteTableCell: { flex: 1, alignItems: 'center' },
  siteNameCol: { flex: 1.4, textAlign: 'left' },
  siteNameCellText: { fontSize: Typography.base, fontWeight: Typography.medium, color: Colors.textPrimary },

  siteCardMobile: {
    gap: Spacing.sm, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  siteStatRow: { flexDirection: 'row', gap: Spacing.lg },
  siteStat: { alignItems: 'flex-start', gap: 2 },
  siteStatLabel: { fontSize: Typography.xs, color: Colors.textMuted },
  siteCountText: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  siteCountTextAlert: { color: Colors.danger },
  siteCountTextTappable: { color: Colors.primary, textDecorationLine: 'underline' },

  quickAssignBlock: { gap: Spacing.sm, paddingVertical: Spacing.sm, paddingLeft: Spacing.sm },
  quickAssignRow: { gap: Spacing.xs },
  quickAssignDescription: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textPrimary },

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

  hintMuted: { fontSize: Typography.sm, color: Colors.textMuted, fontStyle: 'italic' },
});
