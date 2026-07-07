import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Snag } from '../types';
import { Colors, Radius, Spacing, Typography, Shadow, IconSize } from '../constants/theme';
import { getSnagPhotoUrl } from '../lib/supabase';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';
import CategoryBadge from './CategoryBadge';
import Icon from './Icon';

interface Props {
  issue: Snag;
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

// Append Supabase Storage transform params to serve a 400px-wide thumbnail
// instead of the full-resolution image in list views.
function thumbnailUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('width', '400');
    u.searchParams.set('quality', '70');
    return u.toString();
  } catch {
    return url;
  }
}

function IssueCard({ issue, onPress }: Props) {
  const reporterName = issue.reporter_name || issue.reporter?.name || 'Unknown';
  const commentCount = issue.comment_count ?? 0;
  const voteScore = issue.vote_score ?? 0;

  // snag-photos is a private bucket — photo_path is a storage path, not a
  // renderable URL, so resolve a short-lived signed URL for display.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (issue.photo_path) {
      getSnagPhotoUrl(issue.photo_path).then((url) => {
        if (!cancelled) setPhotoUrl(url);
      });
    } else {
      setPhotoUrl(null);
    }
    return () => { cancelled = true; };
  }, [issue.photo_path]);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {/* Photo */}
      {photoUrl ? (
        <Image
          source={{ uri: thumbnailUrl(photoUrl) }}
          style={styles.photo}
          contentFit="cover"
          cachePolicy="memory-disk"
          placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
          transition={200}
        />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Icon name="camera-outline" size={IconSize.xl} color={Colors.textMuted} />
          <Text style={styles.photoPlaceholderText}>No photo</Text>
        </View>
      )}

      {/* Status overlay on photo */}
      <View style={styles.statusOverlay}>
        <StatusBadge status={issue.status} />
      </View>

      {/* Card body */}
      <View style={styles.body}>
        <Text style={styles.reference}>{issue.reference}</Text>
        <Text style={styles.title} numberOfLines={2}>
          {issue.description || 'No description'}
        </Text>

        {/* Badges */}
        <View style={styles.badgeRow}>
          <CategoryBadge kind={issue.kind} />
          <PriorityBadge severity={issue.severity} />
        </View>

        {/* Footer row */}
        <View style={styles.footer}>
          <Text style={styles.meta}>
            {issue.site_name ? `${issue.site_name} · ` : ''}{reporterName} · {timeAgo(issue.created_at)}
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statGroup}>
              <Icon name="chatbubble-outline" size="sm" color={Colors.textMuted} />
              <Text style={styles.stat}>{commentCount}</Text>
            </View>
            <View style={styles.statGroup}>
              <Icon
                name={voteScore > 0 ? 'caret-up' : voteScore < 0 ? 'caret-down' : 'remove'}
                size="sm"
                color={voteScore > 0 ? Colors.success : voteScore < 0 ? Colors.danger : Colors.textMuted}
              />
              <Text
                style={[
                  styles.stat,
                  voteScore > 0 ? styles.statPositive : voteScore < 0 ? styles.statNegative : null,
                ]}
              >
                {Math.abs(voteScore)}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default React.memo(IssueCard);

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    overflow: 'hidden',
    ...Shadow.sm,
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
    gap: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
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
  reference: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.5,
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
    gap: Spacing.sm,
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
  statGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  stat: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    fontWeight: Typography.medium,
  },
  statPositive: {
    color: Colors.success,
  },
  statNegative: {
    color: Colors.danger,
  },
});
