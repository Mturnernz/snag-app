import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';

import { Issue, Comment, RootStackParamList, VoteValue } from '../types';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { supabase, upsertVote, deleteVote, getUserVote } from '../lib/supabase';
import StatusBadge from '../components/StatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import CategoryBadge from '../components/CategoryBadge';

type Route = RouteProp<RootStackParamList, 'IssueDetail'>;

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

function AvatarCircle({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

export default function IssueDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const { issueId } = route.params;

  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingIssue, setLoadingIssue] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [userVote, setUserVote] = useState<VoteValue | null>(null);
  const [voteLoading, setVoteLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setCurrentUserId(user.id);
        getUserVote(issueId, user.id).then(setUserVote);
      }
    });
    fetchIssue();
    fetchComments();
  }, [issueId]);

  async function fetchIssue() {
    setLoadingIssue(true);
    const { data } = await supabase
      .from('issues_with_details')
      .select('*')
      .eq('id', issueId)
      .single();

    if (data) {
      setIssue({
        ...data,
        reporter: data.reporter_id
          ? { id: data.reporter_id, name: data.reporter_name, avatar_url: data.reporter_avatar }
          : undefined,
        assignee: data.assignee_id
          ? { id: data.assignee_id, name: data.assignee_name, avatar_url: data.assignee_avatar }
          : null,
      });
    }
    setLoadingIssue(false);
  }

  async function fetchComments() {
    const { data } = await supabase
      .from('comments')
      .select('*, author:profiles(id, name, avatar_url)')
      .eq('issue_id', issueId)
      .order('created_at', { ascending: true });

    if (data) setComments(data as Comment[]);
  }

  async function handleVote(value: VoteValue) {
    if (!currentUserId || voteLoading) return;
    setVoteLoading(true);

    if (userVote === value) {
      // Tapping same vote removes it
      await deleteVote(issueId, currentUserId);
      setUserVote(null);
      setIssue((prev) => prev ? {
        ...prev,
        vote_score: (prev.vote_score ?? 0) - value,
        upvote_count: value === 1 ? (prev.upvote_count ?? 1) - 1 : prev.upvote_count,
        downvote_count: value === -1 ? (prev.downvote_count ?? 1) - 1 : prev.downvote_count,
      } : prev);
    } else {
      const previous = userVote ?? 0;
      await upsertVote(issueId, currentUserId, value);
      setUserVote(value);
      setIssue((prev) => prev ? {
        ...prev,
        vote_score: (prev.vote_score ?? 0) - previous + value,
        upvote_count: value === 1
          ? (prev.upvote_count ?? 0) + 1
          : previous === 1 ? (prev.upvote_count ?? 1) - 1 : prev.upvote_count,
        downvote_count: value === -1
          ? (prev.downvote_count ?? 0) + 1
          : previous === -1 ? (prev.downvote_count ?? 1) - 1 : prev.downvote_count,
      } : prev);
    }
    setVoteLoading(false);
  }

  async function sendComment() {
    if (!commentText.trim() || !currentUserId) return;
    setSendingComment(true);

    const { error } = await supabase.from('comments').insert({
      issue_id: issueId,
      author_id: currentUserId,
      body: commentText.trim(),
    });

    if (!error) {
      setCommentText('');
      fetchComments();
    }
    setSendingComment(false);
  }

  if (loadingIssue) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!issue) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={{ color: Colors.textMuted }}>Issue not found.</Text>
      </View>
    );
  }

  const voteScore = issue.vote_score ?? 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Back button */}
      <View style={[styles.backButtonContainer, { top: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero photo */}
        {issue.photo_url ? (
          <Image source={{ uri: issue.photo_url }} style={styles.heroPhoto} />
        ) : (
          <View style={styles.heroPlaceholder}>
            <Text style={{ fontSize: 36 }}>📷</Text>
          </View>
        )}

        <View style={styles.content}>
          {/* Title */}
          <Text style={styles.title}>{issue.title}</Text>

          {/* Badges */}
          <View style={styles.badgeRow}>
            <StatusBadge status={issue.status} />
            <PriorityBadge priority={issue.priority} />
            <CategoryBadge category={issue.category} />
          </View>

          {/* Meta */}
          <Text style={styles.meta}>
            Reported by {issue.reporter?.name ?? 'Unknown'} · {timeAgo(issue.created_at)}
          </Text>

          {/* Assignee */}
          {issue.assignee ? (
            <Text style={styles.assigneeText}>Assigned to {issue.assignee.name}</Text>
          ) : (
            <Text style={styles.unassigned}>Unassigned</Text>
          )}

          {/* Description */}
          {issue.description ? (
            <Text style={styles.description}>{issue.description}</Text>
          ) : null}

          {/* Vote bar */}
          <View style={styles.voteBar}>
            <TouchableOpacity
              style={[styles.voteButton, userVote === 1 && styles.voteButtonUpActive]}
              onPress={() => handleVote(1)}
              disabled={voteLoading}
              activeOpacity={0.75}
            >
              <Text style={[styles.voteArrow, userVote === 1 && styles.voteArrowUpActive]}>▲</Text>
              <Text style={[styles.voteLabel, userVote === 1 && styles.voteLabelUpActive]}>
                {issue.upvote_count ?? 0}
              </Text>
            </TouchableOpacity>

            <View style={styles.voteScore}>
              <Text style={[
                styles.voteScoreNumber,
                voteScore > 0 ? styles.voteScorePositive : voteScore < 0 ? styles.voteScoreNegative : null,
              ]}>
                {voteScore > 0 ? '+' : ''}{voteScore}
              </Text>
              <Text style={styles.voteScoreLabel}>score</Text>
            </View>

            <TouchableOpacity
              style={[styles.voteButton, userVote === -1 && styles.voteButtonDownActive]}
              onPress={() => handleVote(-1)}
              disabled={voteLoading}
              activeOpacity={0.75}
            >
              <Text style={[styles.voteArrow, userVote === -1 && styles.voteArrowDownActive]}>▼</Text>
              <Text style={[styles.voteLabel, userVote === -1 && styles.voteLabelDownActive]}>
                {issue.downvote_count ?? 0}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          {/* Comments */}
          <Text style={styles.commentsHeader}>Comments ({comments.length})</Text>

          {comments.length === 0 ? (
            <Text style={styles.noComments}>No comments yet.</Text>
          ) : (
            comments.map((comment) => (
              <View key={comment.id} style={styles.commentBubble}>
                <View style={styles.commentHeader}>
                  <AvatarCircle name={comment.author?.name ?? '?'} size={30} />
                  <View style={styles.commentMeta}>
                    <Text style={styles.commentAuthor}>{comment.author?.name ?? 'Unknown'}</Text>
                    <Text style={styles.commentTime}>{timeAgo(comment.created_at)}</Text>
                  </View>
                </View>
                <Text style={styles.commentBody}>{comment.body}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Sticky comment input */}
      <View style={[styles.commentInputBar, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.commentInput}
          placeholder="Add a comment..."
          placeholderTextColor={Colors.textMuted}
          value={commentText}
          onChangeText={setCommentText}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!commentText.trim() || sendingComment) && styles.sendButtonDisabled]}
          onPress={sendComment}
          disabled={!commentText.trim() || sendingComment}
        >
          {sendingComment ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <Text style={styles.sendButtonText}>↑</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  backButtonContainer: { position: 'absolute', left: Spacing.lg, zIndex: 10 },
  backButton: { backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.button },
  backButtonText: { color: Colors.white, fontSize: Typography.sm, fontWeight: Typography.semibold },
  scroll: { flex: 1 },
  heroPhoto: { width: '100%', height: 280, backgroundColor: Colors.background },
  heroPlaceholder: { width: '100%', height: 200, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, gap: Spacing.md },
  title: { fontSize: Typography.xxl, fontWeight: Typography.bold, color: Colors.textPrimary, lineHeight: 36 },
  badgeRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  meta: { fontSize: Typography.sm, color: Colors.textMuted },
  assigneeText: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.medium },
  unassigned: { fontSize: Typography.sm, color: Colors.textMuted, fontStyle: 'italic' },
  description: { fontSize: Typography.base, color: Colors.textSecondary, lineHeight: 22 },

  // Voting
  voteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.xl,
    marginTop: Spacing.sm,
  },
  voteButton: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 2,
    minWidth: 64,
  },
  voteButtonUpActive: { backgroundColor: '#F0FDF4', borderColor: '#16A34A' },
  voteButtonDownActive: { backgroundColor: '#FEF2F2', borderColor: '#DC2626' },
  voteArrow: { fontSize: 18, color: Colors.textMuted },
  voteArrowUpActive: { color: '#16A34A' },
  voteArrowDownActive: { color: '#DC2626' },
  voteLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textMuted },
  voteLabelUpActive: { color: '#16A34A' },
  voteLabelDownActive: { color: '#DC2626' },
  voteScore: { alignItems: 'center', minWidth: 48 },
  voteScoreNumber: { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.textSecondary },
  voteScorePositive: { color: '#16A34A' },
  voteScoreNegative: { color: '#DC2626' },
  voteScoreLabel: { fontSize: Typography.xs, color: Colors.textMuted },

  divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
  commentsHeader: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  noComments: { fontSize: Typography.sm, color: Colors.textMuted, fontStyle: 'italic' },
  commentBubble: { backgroundColor: Colors.surface, borderRadius: Radius.card, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: Spacing.sm },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Colors.primary, fontWeight: Typography.bold },
  commentMeta: { flex: 1 },
  commentAuthor: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  commentTime: { fontSize: Typography.xs, color: Colors.textMuted },
  commentBody: { fontSize: Typography.base, color: Colors.textSecondary, lineHeight: 21 },

  // Comment bar
  commentInputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border },
  commentInput: { flex: 1, minHeight: MIN_TOUCH_TARGET, maxHeight: 100, backgroundColor: Colors.background, borderRadius: Radius.input, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: Typography.base, color: Colors.textPrimary },
  sendButton: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: Radius.button, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: Colors.white, fontSize: 18, fontWeight: Typography.bold },
});
