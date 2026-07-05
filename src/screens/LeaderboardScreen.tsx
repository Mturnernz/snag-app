import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Typography } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { getUserTitle } from '../lib/points';
import ScreenHeader from '../components/ScreenHeader';
import Chip from '../components/Chip';
import Card from '../components/Card';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';

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

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <View style={styles.rankCircle}>
        <Text style={styles.rankCircleText}>{rank}</Text>
      </View>
    );
  }
  return (
    <View style={styles.rankCell}>
      <Text style={styles.rankNumber}>{rank}</Text>
    </View>
  );
}

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets();

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

    let data: { user_id: string; points: number; name: string }[] = [];

    if (filter === 'all') {
      const { data: rows } = await supabase
        .from('user_points')
        .select('user_id, points, profile:profiles(name)')
        .eq('org_id', orgId)
        .order('points', { ascending: false })
        .limit(50);

      data = (rows ?? []).map((r: any) => ({
        user_id: r.user_id,
        points: r.points,
        name: r.profile?.name || 'Unknown',
      }));
    } else {
      const since = new Date();
      if (filter === 'week') since.setDate(since.getDate() - 7);
      if (filter === 'month') since.setDate(since.getDate() - 30);

      const { data: rows } = await supabase.rpc('get_leaderboard', {
        p_org_id: orgId,
        p_since: since.toISOString(),
      });

      data = (rows ?? []).map((r: any) => ({
        user_id: r.user_id,
        points: r.total_points,
        name: r.name || 'Unknown',
      }));
    }

    setEntries(
      data.map((row, i) => ({
        user_id: row.user_id,
        name: row.name,
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

  const currentUserEntry = entries.find((e) => e.user_id === currentUserId);
  const showPinnedFooter = currentUserEntry && currentUserEntry.rank > 5;

  const renderItem = ({ item }: { item: LeaderboardEntry }) => {
    const isMe = item.user_id === currentUserId;
    return (
      <Card variant="elevated" style={[styles.row, isMe && styles.rowMe] as any}>
        <RankBadge rank={item.rank} />
        <Avatar name={item.name} size={36} ring={isMe} />
        <View style={styles.nameCell}>
          <Text style={styles.entryName} numberOfLines={1}>
            {item.name}{isMe ? ' (you)' : ''}
          </Text>
          <Text style={styles.entryTitle}>{getUserTitle(item.points)}</Text>
        </View>
        <Text style={styles.pointsLabel}>{item.points} pts</Text>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Leaderboard" />

      <View style={styles.filterWrap}>
        <Chip options={FILTERS} value={filter} onChange={setFilter} variant="segmented" />
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
            <EmptyState
              icon="trophy-outline"
              title="No scores yet"
              message="Submit and resolve issues to earn points and appear on the leaderboard."
            />
          }
        />
      )}

      {showPinnedFooter && currentUserEntry && (
        <View style={[styles.pinnedFooter, { paddingBottom: insets.bottom + 8 }]}>
          <Card variant="elevated" style={styles.row}>
            <RankBadge rank={currentUserEntry.rank} />
            <Avatar name={currentUserEntry.name} size={36} ring />
            <View style={styles.nameCell}>
              <Text style={styles.entryName} numberOfLines={1}>
                {currentUserEntry.name} (you)
              </Text>
              <Text style={styles.entryTitle}>{getUserTitle(currentUserEntry.points)}</Text>
            </View>
            <Text style={styles.pointsLabel}>{currentUserEntry.points} pts</Text>
          </Card>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filterWrap: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  listContent: {
    padding: Spacing.lg,
  },
  separator: { height: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  rowMe: {
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  rankCell: {
    width: 32,
    alignItems: 'center',
  },
  rankNumber: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
  },
  rankCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankCircleText: {
    fontSize: Typography.sm,
    fontWeight: Typography.bold,
    color: Colors.primary,
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
  pinnedFooter: {
    borderTopWidth: 2,
    borderTopColor: Colors.primary,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
});
