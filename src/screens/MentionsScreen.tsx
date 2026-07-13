import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { RootStackParamList } from '../types';
import { Colors, Spacing, Typography } from '../constants/theme';
import { getMyMentions, markAllMentionsSeen, MentionEntry } from '../lib/supabase';
import { useBadge } from '../context/BadgeContext';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function MentionsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { refreshMentionCount } = useBadge();

  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Viewing this screen is what "reads" a mention — fetch, then clear the
  // badge, on every focus (not just first mount) so mentions picked up
  // while this screen isn't visible still get cleared next time it opens.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const rows = await getMyMentions();
        if (cancelled) return;
        setMentions(rows);
        setLoading(false);
        if (rows.some((m) => !m.seenAt)) {
          await markAllMentionsSeen();
          refreshMentionCount();
        }
      })();
      return () => { cancelled = true; };
    }, [refreshMentionCount])
  );

  return (
    <View style={styles.container}>
      <ScreenHeader title="Mentions" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}>
        {loading ? (
          <ActivityIndicator style={styles.loading} color={Colors.primary} />
        ) : mentions.length === 0 ? (
          <EmptyState
            icon="at-outline"
            title="No mentions yet"
            message="When someone @mentions you in a comment, it'll show up here."
          />
        ) : (
          mentions.map((mention) => (
            <TouchableOpacity
              key={mention.mentionId}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('IssueDetail', { issueId: mention.snagId })}
            >
              <Card variant="elevated" style={styles.card}>
                <View style={styles.row}>
                  <Avatar name={mention.authorName} size={30} />
                  <View style={styles.meta}>
                    <Text style={styles.line}>
                      <Text style={styles.author}>{mention.authorName}</Text>
                      {' mentioned you in '}
                      <Text style={styles.reference}>{mention.snagReference}</Text>
                    </Text>
                    <Text style={styles.time}>{timeAgo(mention.commentCreatedAt)}</Text>
                  </View>
                </View>
                <Text style={styles.body} numberOfLines={3}>{mention.commentBody}</Text>
              </Card>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.md },
  loading: { marginTop: 64 },
  card: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  meta: { flex: 1 },
  line: { fontSize: Typography.sm, color: Colors.textPrimary },
  author: { fontWeight: Typography.semibold },
  reference: { fontWeight: Typography.semibold, color: Colors.primary },
  time: { fontSize: Typography.xs, color: Colors.textMuted },
  body: { fontSize: Typography.base, color: Colors.textSecondary, lineHeight: 21 },
});
