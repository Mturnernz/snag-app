import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Issue, IssueStatus, RootStackParamList } from '../types';
import { Colors, Spacing, Typography } from '../constants/theme';
import { supabase } from '../lib/supabase';
import IssueCard from '../components/IssueCard';
import Chip from '../components/Chip';
import EmptyState from '../components/EmptyState';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type FilterOption = 'all' | IssueStatus;

const FILTER_OPTIONS: { key: FilterOption; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'resolved', label: 'Resolved' },
];

export default function IssueListScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  const [filter, setFilter] = useState<FilterOption>('all');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchIssues = useCallback(async () => {
    let query = supabase
      .from('issues_with_details')
      .select('id, title, status, priority, category, photo_url, created_at, reporter_id, reporter_name, reporter_avatar, assignee_id, assignee_name, comment_count, vote_score')
      .order('created_at', { ascending: false })
      .limit(50);

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data, error } = await query;

    if (!error && data) {
      setIssues(
        data.map((row: any) => ({
          ...row,
          reporter: row.reporter_id
            ? { id: row.reporter_id, name: row.reporter_name, avatar_url: row.reporter_avatar }
            : undefined,
          assignee: row.assignee_id
            ? { id: row.assignee_id, name: row.assignee_name, avatar_url: row.assignee_avatar }
            : null,
        }))
      );
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    fetchIssues().finally(() => setLoading(false));
  }, [fetchIssues]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchIssues();
    setRefreshing(false);
  }, [fetchIssues]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Snags</Text>
      </View>

      <View style={styles.filterWrap}>
        <Chip options={FILTER_OPTIONS} value={filter} onChange={setFilter} variant="chip" />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={issues}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <IssueCard
              issue={item}
              onPress={() =>
                navigation.navigate('IssueDetail', { issueId: item.id })
              }
            />
          )}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 16 },
          ]}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.lg }} />}
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
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  filterWrap: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  listContent: {
    padding: Spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
