import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Issue } from '../types';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';
import CategoryBadge from './CategoryBadge';

interface Props {
  issue: Issue;
  onPress: () => void;
}

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

export default function IssueCard({ issue, onPress }: Props) {
  const reporterName = issue.reporter?.name || 'Unknown';
  const commentCount = issue.comment_count ?? 0;
  const voteScore = issue.vote_score ?? 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {/* Photo */}
      {issue.photo_url ? (
        <Image source={{ uri: issue.photo_url }} style={styles.photo} />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoPlaceholderIcon}>📷</Text>
          <Text style={styles.photoPlaceholderText}>No photo</Text>
        </View>
      )}

      {/* Status overlay on photo */}
      <View style={styles.statusOverlay}>
        <StatusBadge status={issue.status} />
      </View>

      {/* Card body */}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {issue.title}
        </Text>

        {/* Badges */}
        <View style={styles.badgeRow}>
          <PriorityBadge priority={issue.priority} />
          <CategoryBadge category={issue.category} />
        </View>

        {/* Footer row */}
        <View style={styles.footer}>
          <Text style={styles.meta}>
            {reporterName} · {timeAgo(issue.created_at)}
          </Text>
          <View style={styles.statsRow}>
            <Text style={styles.stat}>💬 {commentCount}</Text>
            <Text style={[styles.stat, voteScore > 0 ? styles.statPositive : voteScore < 0 ? styles.statNegative : null]}>
              {voteScore > 0 ? '▲' : voteScore < 0 ? '▼' : '●'} {Math.abs(voteScore)}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: 220,
    backgroundColor: Colors.background,
  },
  photoPlaceholder: {
    width: '100%',
    height: 160,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  photoPlaceholderIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  photoPlaceholderText: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  statusOverlay: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
  },
  body: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  title: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    lineHeight: 24,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  meta: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  stat: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    fontWeight: Typography.medium,
  },
  statPositive: {
    color: '#16A34A',
  },
  statNegative: {
    color: '#DC2626',
  },
});
