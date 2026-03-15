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
  const reporterName = issue.reporter?.name ?? 'Unknown';
  const commentCount = issue.comment_count ?? 0;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {/* Photo or placeholder */}
      {issue.photo_url ? (
        <Image source={{ uri: issue.photo_url }} style={styles.photo} />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoPlaceholderIcon}>📷</Text>
          <Text style={styles.photoPlaceholderText}>No photo</Text>
        </View>
      )}

      {/* Card body */}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {issue.title}
        </Text>

        {/* Badges row */}
        <View style={styles.badgeRow}>
          <CategoryBadge category={issue.category} />
          <View style={styles.badgeGap} />
          <PriorityBadge priority={issue.priority} />
          <View style={styles.badgeGap} />
          <StatusBadge status={issue.status} />
        </View>

        {/* Meta row */}
        <Text style={styles.meta}>
          {reporterName} · {timeAgo(issue.created_at)} · 💬 {commentCount}
        </Text>

        {/* Assignee */}
        {issue.assignee ? (
          <Text style={styles.assignee}>
            Assigned to {issue.assignee.name}
          </Text>
        ) : null}
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
    height: 180,
    backgroundColor: Colors.background,
  },
  photoPlaceholder: {
    width: '100%',
    height: 180,
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
  body: {
    padding: Spacing.lg,
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
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  badgeGap: {
    width: 0,
  },
  meta: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  assignee: {
    fontSize: Typography.sm,
    color: Colors.primary,
    fontWeight: Typography.medium,
  },
});
