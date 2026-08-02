import React, { useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Snag } from '../types';
import { Colors, Radius, Spacing, Typography, Shadow, IconSize, CardAlertBorder, CardAlertGlyph } from '../constants/theme';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';
import CategoryBadge from './CategoryBadge';
import RelevanceBadge from './RelevanceBadge';
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
  /** Filed since the reader last left this list — see lib/snagFreshness.ts. */
  isNew?: boolean;
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
function alertKind(issue: Snag): keyof typeof CardAlertBorder | null {
  if (issue.severity === 'injury') return 'injury';
  if (issue.severity === 'critical') return 'critical';
  if (issue.kind === 'improvement') return 'improvement';
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

function IssueCard({ issue, photoUrl, compact, onPress, onLongPress, selectable, selected, isNew }: Props) {
  const reporterName = issue.reporter_name || issue.reporter?.name || 'Unknown';
  // owner_name comes off snags_with_details, already selected by both clients'
  // list queries and, until now, displayed by neither.
  const assigneeName = issue.owner_name || issue.owner?.name || null;
  const commentCount = issue.comment_count ?? 0;
  const voteScore = issue.vote_score ?? 0;
  const alert = alertKind(issue);
  const borderColor = alert && CardAlertBorder[alert];

  // TouchableOpacity fires onPress on release even after onLongPress has
  // already fired for the same gesture — suppress that one auto-fired press
  // so long-pressing to enter select mode doesn't immediately toggle the
  // selection straight back off.
  const suppressNextPress = useRef(false);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        compact && styles.cardCompact,
        borderColor && { borderWidth: 2, borderColor },
        selected && styles.cardSelected,
      ]}
      onPress={() => {
        if (suppressNextPress.current) {
          suppressNextPress.current = false;
          return;
        }
        onPress();
      }}
      onLongPress={() => {
        suppressNextPress.current = true;
        onLongPress?.();
      }}
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
      <View style={styles.photoWrap}>
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

        {/* Top-left stack: merge-parent indicator + relevance tag — both
            hidden in select mode, which claims this corner for its
            checkmark overlay instead. */}
        {!selectable && (Boolean(issue.child_count) || issue.relevance_reason) && (
          <View style={styles.topLeftStack} pointerEvents="none">
            {Boolean(issue.child_count) && (
              <View style={styles.mergeOverlay}>
                <Icon name="albums-outline" size="sm" color={Colors.white} />
              </View>
            )}
            {issue.relevance_reason && <RelevanceBadge reason={issue.relevance_reason} />}
          </View>
        )}

        {/* Status overlay on photo */}
        <View style={styles.statusOverlay}>
          <StatusBadge status={issue.status} />
        </View>

        {/* Bottom edge of the photo: severity glyph left, site pill centre,
            "new since your last visit" right. One row rather than three
            absolutely-positioned overlays — on a 110px compact card all three
            land within a few pixels of each other, and a centred site pill
            wide enough to be worth reading will run straight through both
            corners. As a row the pill simply shrinks instead. */}
        {(alert || issue.site_name || isNew) && (
          <View style={styles.photoFooterRow} pointerEvents="none">
            <View style={styles.photoFooterSide}>
              {alert && (
                <View style={styles.alertGlyph}>
                  <Icon name={CardAlertGlyph[alert]} size="sm" color={CardAlertBorder[alert]} />
                </View>
              )}
            </View>

            <View style={styles.photoFooterCenter}>
              {issue.site_name && (
                <View style={styles.sitePill}>
                  <Text style={styles.sitePillText} numberOfLines={1}>{issue.site_name}</Text>
                </View>
              )}
            </View>

            <View style={[styles.photoFooterSide, styles.photoFooterSideRight]}>
              {isNew && (
                <View style={styles.newBadge}>
                  <View style={styles.newDot} />
                  <Text style={styles.newLabel}>NEW</Text>
                </View>
              )}
            </View>
          </View>
        )}
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

        {/* Who is on it, bottom right. Omitted rather than labelled
            "Unassigned": most snags in a list have nobody on them, so the
            label would be on nearly every card and carry no information —
            the empty slot says the same thing more quietly. The Scope
            dropdown's "Unassigned in my sites" is where you go looking for
            them deliberately. */}
        {assigneeName && (
          <View style={styles.assignee}>
            <Icon name="person-circle-outline" size="sm" color={Colors.textMuted} />
            <Text style={styles.assigneeName} numberOfLines={1}>{assigneeName}</Text>
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
  topLeftStack: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.md,
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  mergeOverlay: {
    backgroundColor: Colors.photoOverlay,
    borderRadius: Radius.chip,
    padding: Spacing.xs,
  },
  photoWrap: {
    position: 'relative',
  },
  photoFooterRow: {
    position: 'absolute',
    bottom: Spacing.sm,
    left: Spacing.sm,
    right: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  // Equal-width side slots so the site pill stays centred on the photo
  // whether or not either corner is occupied.
  photoFooterSide: {
    flex: 1,
    alignItems: 'flex-start',
  },
  photoFooterSideRight: {
    alignItems: 'flex-end',
  },
  photoFooterCenter: {
    flexShrink: 1,
    alignItems: 'center',
  },
  sitePill: {
    maxWidth: '100%',
    backgroundColor: Colors.photoOverlay,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  sitePillText: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
  // On a light coin rather than the dark scrim the other photo chips use: the
  // glyph is carrying the border's own colour, and that colour is the point.
  alertGlyph: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.avatar,
    padding: Spacing.xs,
    ...Shadow.sm,
  },
  // Neutral by design. The warm hues are all spoken for by lane and severity,
  // so a "new" pill in any of them reads as a fourth alert on a card that can
  // already carry three. White on the standard photo scrim has no hue to
  // mistake for one — and grey-on-scrim, the other way to say "neutral", is
  // two greys deep and unreadable at 11px.
  newBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.photoOverlay,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  newDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.white,
  },
  newLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.semibold,
    color: Colors.white,
    letterSpacing: 0.4,
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
  // Its own row, right-aligned, in both variants: the compact footer is a
  // column (not a row), and the full-width footer already has StatsRow in its
  // right-hand slot — so there is nowhere to tuck this into either one.
  assignee: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  assigneeName: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    flexShrink: 1,
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
