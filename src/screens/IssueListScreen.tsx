import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Snag, SnagStatus, STATUS_LABELS, UserRole, RootStackParamList } from '../types';
import { Colors, Spacing, Typography, Radius, Shadow } from '../constants/theme';
import { supabase, getSnagPhotoUrls, getProfile } from '../lib/supabase';
import IssueCard from '../components/IssueCard';
import Chip from '../components/Chip';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import OrgSwitcherHeader from '../components/OrgSwitcherHeader';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type FilterOption = 'all' | 'public' | 'unassigned' | SnagStatus;
type SortOption = 'newest' | 'site' | 'comments' | 'votes';

const FILTER_OPTIONS: { key: FilterOption; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'flagged', label: STATUS_LABELS.flagged },
  { key: 'in_progress', label: STATUS_LABELS.in_progress },
  { key: 'resolved', label: STATUS_LABELS.resolved },
];

// Members also get an "Unassigned" triage queue and the public-submissions
// queue; their default view shows internal reports only.
const MEMBER_FILTER_OPTIONS: { key: FilterOption; label: string }[] = [
  ...FILTER_OPTIONS,
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'public', label: 'Public' },
];

const SORT_OPTIONS: { key: SortOption; label: string; icon: React.ComponentProps<typeof Icon>['name'] }[] = [
  { key: 'newest', label: 'Newest first', icon: 'time-outline' },
  { key: 'site', label: 'Site', icon: 'business-outline' },
  { key: 'comments', label: 'Most commented', icon: 'chatbubble-outline' },
  { key: 'votes', label: 'Highest voted', icon: 'caret-up-outline' },
];

export default function IssueListScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [filter, setFilter] = useState<FilterOption>('all');
  const [sort, setSort] = useState<SortOption>('newest');
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [issues, setIssues] = useState<Snag[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [hasOrg, setHasOrg] = useState<boolean | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchIssues = useCallback(async () => {
    // Re-check org state every fetch — it changes with the org switcher, and
    // it decides both the screen title and the public-submission filtering.
    const { data: { user } } = await supabase.auth.getUser();
    let memberOfOrg = false;
    if (user) {
      const profile = await getProfile(user.id);
      memberOfOrg = Boolean(profile?.org_id);
      setRole(profile?.role ?? null);
      setOrgName(profile?.organisation?.name ?? null);
    }
    setHasOrg(memberOfOrg);

    let query = supabase
      .from('snags_with_details')
      .select('id, reference, status, kind, severity, photo_path, created_at, reporter_id, reporter_name, owner_id, owner_name, comment_count, vote_score, description, site_name, is_public_submission')
      .limit(50);

    if (memberOfOrg) {
      // Members: internal reports by default; the Public chip shows the
      // public-submissions queue. Public reporters (no org) see all their
      // own reports — RLS already scopes them.
      query = query.eq('is_public_submission', filter === 'public');
    }

    switch (sort) {
      case 'site':
        query = query.order('site_name', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
        break;
      case 'comments':
        query = query.order('comment_count', { ascending: false }).order('created_at', { ascending: false });
        break;
      case 'votes':
        query = query.order('vote_score', { ascending: false }).order('created_at', { ascending: false });
        break;
      case 'newest':
      default:
        query = query.order('created_at', { ascending: false });
    }

    if (filter === 'unassigned') {
      // Supervisor triage queue — snags with no owner yet (RLS already scopes
      // these to the viewer's sites).
      query = query.is('owner_id', null);
    } else if (filter !== 'all' && filter !== 'public') {
      query = query.eq('status', filter);
    }

    const { data, error } = await query;

    if (!error && data) {
      const mapped = data.map((row: any) => ({
        ...row,
        reporter: row.reporter_id ? { id: row.reporter_id, name: row.reporter_name } : undefined,
        owner: row.owner_id ? { id: row.owner_id, name: row.owner_name } : null,
      }));
      // Injury snags float to the top regardless of the active sort, unless
      // already resolved — everything else keeps its existing relative order
      // (Array.sort is stable).
      const isPinned = (s: Snag) => s.severity === 'injury' && s.status !== 'resolved';
      mapped.sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)));
      setIssues(mapped);
      const paths = data.map((row: any) => row.photo_path).filter(Boolean);
      getSnagPhotoUrls(paths).then(setPhotoUrls);
    }
  }, [filter, sort]);

  useEffect(() => {
    setLoading(true);
    fetchIssues().finally(() => setLoading(false));
  }, [fetchIssues]);

  // Refetch on focus — the visible snags are scoped to the active org, which
  // may have changed (org switcher / QR scan) since this tab last rendered.
  useFocusEffect(
    useCallback(() => {
      fetchIssues();
    }, [fetchIssues])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchIssues();
    setRefreshing(false);
  }, [fetchIssues]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <OrgSwitcherHeader
        title={hasOrg === false ? 'My Reports' : 'Snags'}
        role={role}
        orgName={orgName}
        onSwitched={fetchIssues}
      />

      <View style={styles.filterWrap}>
        <View style={styles.filterChips}>
          <Chip
            options={hasOrg ? MEMBER_FILTER_OPTIONS : FILTER_OPTIONS}
            value={filter}
            onChange={setFilter}
            variant="chip"
          />
        </View>
        <TouchableOpacity style={styles.sortButton} onPress={() => setSortModalVisible(true)} activeOpacity={0.7}>
          <Icon name="swap-vertical-outline" size="sm" color={Colors.textSecondary} />
          <Text style={styles.sortButtonText}>{SORT_OPTIONS.find((o) => o.key === sort)?.label}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={sortModalVisible} transparent animationType="fade" onRequestClose={() => setSortModalVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSortModalVisible(false)}>
          <View style={styles.sortSheet}>
            <Text style={styles.sortSheetTitle}>Sort by</Text>
            {SORT_OPTIONS.map((option) => {
              const active = option.key === sort;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={styles.sortOption}
                  onPress={() => {
                    setSort(option.key);
                    setSortModalVisible(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Icon name={option.icon} size="md" color={active ? Colors.primary : Colors.textSecondary} />
                  <Text style={[styles.sortOptionText, active && styles.sortOptionTextActive]}>{option.label}</Text>
                  {active && <Icon name="checkmark" size="sm" color={Colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={issues}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          renderItem={({ item }) => (
            <IssueCard
              issue={item}
              compact
              photoUrl={item.photo_path ? photoUrls[item.photo_path] ?? null : null}
              onPress={() =>
                navigation.navigate('IssueDetail', { issueId: item.id })
              }
            />
          )}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 16 },
          ]}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          removeClippedSubviews
          windowSize={5}
          initialNumToRender={8}
          maxToRenderPerBatch={5}
          updateCellsBatchingPeriod={50}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="build-outline"
              title={filter === 'all' ? 'No snags yet' : `No ${filter.replace('_', ' ')} snags`}
              message={
                filter === 'all'
                  ? 'Be the first to report an issue in your workplace.'
                  : 'Try a different filter or report a new issue.'
              }
              actionLabel={filter === 'all' ? 'Report a Snag' : undefined}
              onAction={
                filter === 'all'
                  ? () => navigation.navigate('Main' as any, { screen: 'Report' } as any)
                  : undefined
              }
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  filterWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterChips: {
    flex: 1,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 34,
    paddingHorizontal: Spacing.md,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  sortButtonText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    justifyContent: 'flex-end',
  },
  sortSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.xs,
    ...Shadow.lg,
  },
  sortSheetTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  sortOptionText: {
    flex: 1,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  sortOptionTextActive: {
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  listContent: {
    padding: Spacing.lg,
  },
  columnWrapper: {
    gap: Spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
