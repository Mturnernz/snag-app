import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { getUserTitle } from '../lib/points';

type FilterOption = 'week' | 'month' | 'all';

interface LeaderboardEntry {
  user_id: string;
  name: string;
  points: number;
  rank: number;
}

const FILTERS: { key: FilterOption; label: string }[] = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All Time' },
];

function AvatarCircle({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

const RANK_MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [filter, setFilter] = useState<FilterOption>('week');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setCurrentUserId(user.id);
      const { data: profile } = await supabase
        .from('profiles')
        .select('organisation_id')
        .eq('id', user.id)
        .single();
      if (profile?.organisation_id) {
        setOrgId(profile.organisation_id);
      }
    });
  }, []);

  const fetchLeaderboard = useCallback(async () => {
    if (!orgId) return;

    let data: { user_id: string; points: number }[] = [];

    if (filter === 'all') {
      // Use user_points aggregate table
      const { data: rows } = await supabase
        .from('user_points')
        .select('user_id, points')
        .eq('org_id', orgId)
        .order('points', { ascending: false });
      data = rows ?? [];
    } else {
      // Sum points_log for the time period
      const since = new Date();
      if (filter === 'week') since.setDate(since.getDate() - 7);
      if (filter === 'month') since.setDate(since.getDate() - 30);

      const { data: rows } = await supabase
        .from('points_log')
        .select('user_id, points')
        .eq('org_id', orgId)
        .gte('created_at', since.toISOString());

      // Aggregate by user
      const totals: Record<string, number> = {};
      for (const row of rows ?? []) {
        totals[row.user_id] = (totals[row.user_id] ?? 0) + row.points;
      }
      data = Object.entries(totals)
        .map(([user_id, points]) => ({ user_id, points }))
        .sort((a, b) => b.points - a.points);
    }

    // Fetch names for all users in the result
    const userIds = data.map((r) => r.user_id);
    const { data: profiles } = userIds.length > 0
      ? await supabase.from('profiles').select('id, name').in('id', userIds)
      : { data: [] };

    const nameMap: Record<string, string> = {};
    for (const p of profiles ?? []) {
      nameMap[p.id] = p.name || 'Unknown';
    }

    setEntries(
      data.map((row, i) => ({
        user_id: row.user_id,
        name: nameMap[row.user_id] ?? 'Unknown',
        points: row.points,
        rank: i + 1,
      }))
    );
  }, [orgId, filter]);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    fetchLeaderboard().finally(() => setLoading(false));
  }, [fetchLeaderboard, orgId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLeaderboard();
    setRefreshing(false);
  }, [fetchLeaderboard]);

  // Find current user's rank for pinned footer
  const currentUserEntry = entries.find((e) => e.user_id === currentUserId);
  const showPinnedFooter = currentUserEntry && currentUserEntry.rank > 5;

  const renderItem = ({ item }: { item: LeaderboardEntry }) => {
    const isMe = item.user_id === currentUserId;
    const medal = RANK_MEDALS[item.rank];
    return (
      <View style={[styles.row, isMe && styles.rowMe]}>
        <View style={styles.rankCell}>
          {medal ? (
            <Text style={styles.medal}>{medal}</Text>
          ) : (
            <Text style={styles.rankNumber}>{item.rank}</Text>
          )}
        </View>
        <AvatarCircle name={item.name} size={36} />
        <View style={styles.nameCell}>
          <Text style={styles.entryName} numberOfLines={1}>
            {item.name}{isMe ? ' (you)' : ''}
          </Text>
          <Text style={styles.entryTitle}>{getUserTitle(item.points)}</Text>
        </View>
        <Text style={styles.pointsLabel}>{item.points} pts</Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Leaderboard</Text>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterTab, filter === f.key && styles.filterTabActive]}
            onPress={() => setFilter(f.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterTabText, filter === f.key && styles.filterTabTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={entries.slice(0, 20)}
          keyExtractor={(item) => item.user_id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + (showPinnedFooter ? 80 : 16) },
          ]}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🏆</Text>
              <Text style={styles.emptyTitle}>No scores yet</Text>
              <Text style={styles.emptyText}>
                Submit and resolve issues to earn points and appear on the leaderboard.
              </Text>
            </View>
          }
        />
      )}

      {/* Pinned current user row when outside top 5 */}
      {showPinnedFooter && currentUserEntry && (
        <View style={[styles.pinnedFooter, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.row}>
            <View style={styles.rankCell}>
              <Text style={styles.rankNumber}>{currentUserEntry.rank}</Text>
            </View>
            <AvatarCircle name={currentUserEntry.name} size={36} />
            <View style={styles.nameCell}>
              <Text style={styles.entryName} numberOfLines={1}>
                {currentUserEntry.name} (you)
              </Text>
              <Text style={styles.entryTitle}>{getUserTitle(currentUserEntry.points)}</Text>
            </View>
            <Text style={styles.pointsLabel}>{currentUserEntry.points} pts</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  backBtn: {
    paddingVertical: Spacing.xs,
    paddingRight: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.primary,
  },
  headerTitle: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  filterTab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderRadius: Radius.chip,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterTabActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  filterTabText: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  filterTabTextActive: {
    color: Colors.primary,
    fontWeight: Typography.semibold,
  },
  listContent: {
    padding: Spacing.lg,
  },
  separator: { height: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  rowMe: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  rankCell: {
    width: 32,
    alignItems: 'center',
  },
  medal: { fontSize: 22 },
  rankNumber: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
  },
  avatar: {
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: Colors.primary,
    fontWeight: Typography.bold,
  },
  nameCell: {
    flex: 1,
    gap: 2,
  },
  entryName: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  entryTitle: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    fontWeight: Typography.medium,
  },
  pointsLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
    color: Colors.primary,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 64,
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  emptyIcon: { fontSize: 48, marginBottom: Spacing.sm },
  emptyTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  pinnedFooter: {
    borderTopWidth: 2,
    borderTopColor: Colors.primary,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
});
