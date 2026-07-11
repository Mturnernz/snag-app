import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Snag } from '../types';
import { Colors, Radius, Spacing, Typography, Shadow, IconSize, CardAlertBorder } from '../constants/theme';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';
import CategoryBadge from './CategoryBadge';
import Icon from './Icon';

interface Props {
  issue: Snag;
  /** Pre-resolved signed URL for issue.photo_path — the list screen fetches
   *  every visible card's URL in one batched call rather than each card
   *  resolving its own. */
  photoUrl?: string | null;
  /** Smaller photo/title and a one-line footer, for the 2-column grid. */
  compact?: boolean;
  onPress: () => void;
  /** Enters merge select mode on the list screen. */
  onLongPress?: () => void;
  /** Whether select mode is active — tapping toggles selection instead of navigating. */
  selectable?: boolean;
  selected?: boolean;
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

// Severity takes priority over kind — an injury/critical fixit is still an
// injury/critical fixit. Everything else (fixit/hazard, minor/moderate)
// keeps the plain shadow-only card.
function alertBorderColor(issue: Snag): string | null {
  if (issue.severity === 'injury') return CardAlertBorder.injury;
  if (issue.severity === 'critical') return CardAlertBorder.critical;
  if (issue.kind === 'improvement') return CardAlertBorder.improvement;
  return null;
}

function StatsRow({ commentCount, voteScore }: { commentCount: number; voteScore: number }) {
  return (
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
  );
}

function IssueCard({ issue, photoUrl, compact, onPress, onLongPress, selectable, selected }: Props) {
  const reporterName = issue.reporter_name || issue.reporter?.name || 'Unknown';
  const commentCount = issue.comment_count ?? 0;
  const voteScore = issue.vote_score ?? 0;
  const borderColor = alertBorderColor(issue);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        compact && styles.cardCompact,
        borderColor && { borderWidth: 2, borderColor },
        selected && styles.cardSelected,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.85}
    >
      {selectable && (
        <View style={styles.selectOverlay}>
          <Icon
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size="lg"
            color={selected ? Colors.primary : Colors.white}
          />
        </View>
      )}

      {/* Photo */}
      {photoUrl ? (
        <Image
          source={{ uri: thumbnailUrl(photoUrl) }}
          style={[styles.photo, compact && styles.photoCompact]}
          contentFit="cover"
          cachePolicy="memory-disk"
          placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
          transition={200}
        />
      ) : (
        <View style={[styles.photoPlaceholder, compact && styles.photoCompact]}>
          <Icon name="camera-outline" size={compact ? IconSize.lg : IconSize.xl} color={Colors.textMuted} />
          {!compact && <Text style={styles.photoPlaceholderText}>No photo</Text>}
        </View>
      )}

      {/* Status overlay on photo */}
      <View style={styles.statusOverlay}>
        <StatusBadge status={issue.status} />
      </View>

      {/* Card body */}
      <View style={[styles.body, compact && styles.bodyCompact]}>
        {!compact && <Text style={styles.reference}>{issue.reference}</Text>}
        <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={2}>
          {issue.description || 'No description'}
        </Text>

        {/* Badges */}
        <View style={styles.badgeRow}>
          <CategoryBadge kind={issue.kind} />
          {!compact && <PriorityBadge severity={issue.severity} />}
        </View>

        {/* Footer row */}
        {compact ? (
          <View style={styles.footerCompact}>
            <Text style={styles.metaCompact} numberOfLines={1}>{timeAgo(issue.created_at)}</Text>
            <StatsRow commentCount={commentCount} voteScore={voteScore} />
          </View>
        ) : (
          <View style={styles.footer}>
            <Text style={styles.meta}>
              {issue.site_name ? `${issue.site_name} · ` : ''}{reporterName} · {timeAgo(issue.created_at)}
            </Text>
            <StatsRow commentCount={commentCount} voteScore={voteScore} />
          </View>
        )}
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
  cardCompact: {
    flex: 1,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  selectOverlay: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.md,
    zIndex: 1,
  },
  photo: {
    width: '100%',
    height: 220,
    backgroundColor: Colors.background,
  },
  photoCompact: {
    height: 110,
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
  bodyCompact: {
    padding: Spacing.sm,
    gap: Spacing.xs,
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
  titleCompact: {
    fontSize: Typography.sm,
    lineHeight: 18,
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
  footerCompact: {
    gap: 2,
    marginTop: Spacing.xs,
  },
  meta: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    flex: 1,
  },
  metaCompact: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
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
