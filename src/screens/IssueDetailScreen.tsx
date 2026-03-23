import React, { useState, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';

import {
  Issue, Comment, Profile, RootStackParamList, VoteValue,
  IssueStatus, IssuePriority, IssueCategory,
  STATUS_LABELS, PRIORITY_LABELS, CATEGORY_LABELS,
} from '../types';
// Profile is used for orgMembers array type
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { supabase, upsertVote, deleteVote, getUserVote, getOrgMembers, updateIssue } from '../lib/supabase';
import { useUserProfile } from '../context/UserProfileContext';
import { getUserTitle } from '../lib/points';
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

  // Auth + profile from context — no per-screen re-fetch needed.
  const { userId: currentUserId, profile: userProfile, orgId } = useUserProfile();

  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingIssue, setLoadingIssue] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [userVote, setUserVote] = useState<VoteValue | null>(null);
  const [voteLoading, setVoteLoading] = useState(false);
  const [orgMembers, setOrgMembers] = useState<Profile[]>([]);
  const [editingField, setEditingField] = useState<'status' | 'priority' | 'category' | 'assignee' | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<Parameters<typeof updateIssue>[1]>({});
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAt, setMentionAt] = useState(-1);
  const [authorPoints, setAuthorPoints] = useState<Record<string, number>>({});

  const canEdit = userProfile?.role === 'admin' || userProfile?.role === 'manager';

  useEffect(() => {
    fetchIssue();
    fetchComments();

    // Fetch the user's vote (only needs userId, already from context)
    if (currentUserId) {
      getUserVote(issueId, currentUserId).then(setUserVote);
    }

    // Only admins/managers need org members (for the assignee picker)
    if (canEdit && orgId) {
      getOrgMembers(orgId).then(setOrgMembers);
    }
  }, [issueId]);

  // Re-fetch author points once org is known
  useEffect(() => {
    if (comments.length > 0 && orgId) {
      const authorIds = [...new Set(comments.map((c) => c.author_id))];
      fetchAuthorPoints(authorIds, orgId);
    }
  }, [orgId]);

  async function fetchIssue() {
    setLoadingIssue(true);
    const { data } = await supabase
      .from('issues_with_details')
      .select('id, title, description, status, priority, category, photo_url, created_at, updated_at, reporter_id, reporter_name, reporter_avatar, assignee_id, assignee_name, assignee_avatar, comment_count, vote_score, upvote_count, downvote_count, organisation_id')
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

    if (data) {
      setComments(data as Comment[]);
      const authorIds = [...new Set(data.map((c: any) => c.author_id))];
      if (authorIds.length > 0 && orgId) {
        fetchAuthorPoints(authorIds, orgId);
      }
    }
  }

  async function fetchAuthorPoints(authorIds: string[], orgId: string) {
    const { data } = await supabase
      .from('user_points')
      .select('user_id, points')
      .in('user_id', authorIds)
      .eq('org_id', orgId);
    if (data) {
      const map: Record<string, number> = {};
      for (const row of data) map[row.user_id] = row.points;
      setAuthorPoints(map);
    }
  }

  async function handleVote(value: VoteValue) {
    if (!currentUserId || voteLoading) return;
    setVoteLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (userVote === value) {
      // Optimistic: remove vote immediately
      const prevVote = userVote;
      const prevIssue = issue;
      setUserVote(null);
      setIssue((prev) => prev ? {
        ...prev,
        vote_score: (prev.vote_score ?? 0) - value,
        upvote_count: value === 1 ? (prev.upvote_count ?? 1) - 1 : prev.upvote_count,
        downvote_count: value === -1 ? (prev.downvote_count ?? 1) - 1 : prev.downvote_count,
      } : prev);
      const { error } = await deleteVote(issueId, currentUserId);
      if (error) {
        // Revert on failure
        setUserVote(prevVote);
        setIssue(prevIssue);
      }
    } else {
      // Optimistic: apply new vote immediately
      const prevVote = userVote;
      const prevIssue = issue;
      const previous = userVote ?? 0;
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
      const { error } = await upsertVote(issueId, currentUserId, value);
      if (error) {
        // Revert on failure
        setUserVote(prevVote);
        setIssue(prevIssue);
      }
    }
    setVoteLoading(false);
  }

  function stageUpdate(updates: Parameters<typeof updateIssue>[1]) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIssue((prev) => prev ? { ...prev, ...updates } : prev);
    setPendingUpdates((prev) => ({ ...prev, ...updates }));
    setEditingField(null);
  }

  async function handleSave() {
    if (!issue || saving || Object.keys(pendingUpdates).length === 0) return;
    setSaving(true);
    const { error } = await updateIssue(issue.id, pendingUpdates);
    if (!error) {
      setPendingUpdates({});
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
    setSaving(false);
  }

  function toggleField(field: typeof editingField) {
    setEditingField((prev) => (prev === field ? null : field));
  }

  function handleCommentChange(text: string) {
    setCommentText(text);
    const lastAt = text.lastIndexOf('@');
    if (lastAt >= 0) {
      const afterAt = text.slice(lastAt + 1);
      if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
        setMentionQuery(afterAt);
        setMentionAt(lastAt);
        return;
      }
    }
    setMentionQuery(null);
    setMentionAt(-1);
  }

  function insertMention(member: Profile) {
    const before = commentText.slice(0, mentionAt);
    const after = commentText.slice(mentionAt + 1 + (mentionQuery?.length ?? 0));
    setCommentText(before + '@' + member.name + ' ' + after.trimStart());
    setMentionQuery(null);
    setMentionAt(-1);
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
      setMentionQuery(null);
      setMentionAt(-1);
      fetchComments();
    }
    setSendingComment(false);
  }

  const mentionSuggestions = mentionQuery !== null
    ? orgMembers.filter((m) => m.name.toLowerCase().startsWith(mentionQuery.toLowerCase()))
    : [];

  function renderCommentBody(body: string) {
    const parts = body.split(/(@\S+)/g);
    return (
      <Text style={styles.commentBody}>
        {parts.map((part, i) =>
          part.startsWith('@') ? (
            <Text key={i} style={styles.mentionText}>{part}</Text>
          ) : (
            part
          )
        )}
      </Text>
    );
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
          <Image
            source={{ uri: issue.photo_url }}
            style={styles.heroPhoto}
            contentFit="cover"
            cachePolicy="memory-disk"
            placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
            transition={200}
          />
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

          {/* Management card — admins and managers only */}
          {saveSuccess && (
            <View style={styles.successBanner}>
              <Text style={styles.successBannerText}>Snag updated!</Text>
            </View>
          )}

          {canEdit && (
            <View style={styles.manageCard}>
              <View style={styles.manageTitleRow}>
                <Text style={styles.manageTitle}>Manage Issue</Text>
                {Object.keys(pendingUpdates).length > 0 && (
                  <TouchableOpacity
                    style={[styles.updateButton, saving && styles.updateButtonDisabled]}
                    onPress={handleSave}
                    disabled={saving}
                    activeOpacity={0.85}
                  >
                    {saving
                      ? <ActivityIndicator size="small" color={Colors.white} />
                      : <Text style={styles.updateButtonText}>Update Snag</Text>
                    }
                  </TouchableOpacity>
                )}
              </View>

              {/* Status */}
              <View style={styles.manageRow}>
                <Text style={styles.manageLabel}>Status</Text>
                <TouchableOpacity onPress={() => toggleField('status')} style={styles.manageCurrentChip}>
                  <StatusBadge status={issue.status} />
                  <Text style={styles.manageChevron}>{editingField === 'status' ? '▲' : '▼'}</Text>
                </TouchableOpacity>
              </View>
              {editingField === 'status' && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionRow} contentContainerStyle={styles.optionRowContent}>
                  {(Object.keys(STATUS_LABELS) as IssueStatus[]).map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => stageUpdate({ status: s })}
                      style={[styles.optionChip, issue.status === s && styles.optionChipActive]}
                    >
                      <Text style={[styles.optionChipText, issue.status === s && styles.optionChipTextActive]}>
                        {STATUS_LABELS[s]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {/* Priority */}
              <View style={styles.manageRow}>
                <Text style={styles.manageLabel}>Priority</Text>
                <TouchableOpacity onPress={() => toggleField('priority')} style={styles.manageCurrentChip}>
                  <PriorityBadge priority={issue.priority} />
                  <Text style={styles.manageChevron}>{editingField === 'priority' ? '▲' : '▼'}</Text>
                </TouchableOpacity>
              </View>
              {editingField === 'priority' && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionRow} contentContainerStyle={styles.optionRowContent}>
                  {(Object.keys(PRIORITY_LABELS) as IssuePriority[]).map((p) => (
                    <TouchableOpacity
                      key={p}
                      onPress={() => stageUpdate({ priority: p })}
                      style={[styles.optionChip, issue.priority === p && styles.optionChipActive]}
                    >
                      <Text style={[styles.optionChipText, issue.priority === p && styles.optionChipTextActive]}>
                        {PRIORITY_LABELS[p]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {/* Category */}
              <View style={styles.manageRow}>
                <Text style={styles.manageLabel}>Category</Text>
                <TouchableOpacity onPress={() => toggleField('category')} style={styles.manageCurrentChip}>
                  <CategoryBadge category={issue.category} />
                  <Text style={styles.manageChevron}>{editingField === 'category' ? '▲' : '▼'}</Text>
                </TouchableOpacity>
              </View>
              {editingField === 'category' && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionRow} contentContainerStyle={styles.optionRowContent}>
                  {(Object.keys(CATEGORY_LABELS) as IssueCategory[]).map((c) => (
                    <TouchableOpacity
                      key={c}
                      onPress={() => stageUpdate({ category: c })}
                      style={[styles.optionChip, issue.category === c && styles.optionChipActive]}
                    >
                      <Text style={[styles.optionChipText, issue.category === c && styles.optionChipTextActive]}>
                        {CATEGORY_LABELS[c]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {/* Assignee */}
              <View style={styles.manageRow}>
                <Text style={styles.manageLabel}>Assignee</Text>
                <TouchableOpacity onPress={() => toggleField('assignee')} style={styles.manageCurrentChip}>
                  <Text style={styles.manageCurrentText}>
                    {issue.assignee ? issue.assignee.name : 'Unassigned'}
                  </Text>
                  <Text style={styles.manageChevron}>{editingField === 'assignee' ? '▲' : '▼'}</Text>
                </TouchableOpacity>
              </View>
              {editingField === 'assignee' && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionRow} contentContainerStyle={styles.optionRowContent}>
                  <TouchableOpacity
                    onPress={() => stageUpdate({ assignee_id: null })}
                    style={[styles.optionChip, issue.assignee_id === null && styles.optionChipActive]}
                  >
                    <Text style={[styles.optionChipText, issue.assignee_id === null && styles.optionChipTextActive]}>
                      Unassigned
                    </Text>
                  </TouchableOpacity>
                  {orgMembers.map((member) => (
                    <TouchableOpacity
                      key={member.id}
                      onPress={() => stageUpdate({ assignee_id: member.id })}
                      style={[styles.optionChip, issue.assignee_id === member.id && styles.optionChipActive]}
                    >
                      <Text style={[styles.optionChipText, issue.assignee_id === member.id && styles.optionChipTextActive]}>
                        {member.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

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
                    <View style={styles.commentAuthorRow}>
                      <Text style={styles.commentAuthor}>{comment.author?.name ?? 'Unknown'}</Text>
                      <Text style={styles.commentTitleBadge}>
                        {getUserTitle(authorPoints[comment.author_id] ?? 0)}
                      </Text>
                    </View>
                    <Text style={styles.commentTime}>{timeAgo(comment.created_at)}</Text>
                  </View>
                </View>
                {renderCommentBody(comment.body)}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Mention picker */}
      {mentionSuggestions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.mentionPicker}
          contentContainerStyle={styles.mentionPickerContent}
          keyboardShouldPersistTaps="always"
        >
          {mentionSuggestions.map((member) => (
            <TouchableOpacity
              key={member.id}
              style={styles.mentionChip}
              onPress={() => insertMention(member)}
            >
              <AvatarCircle name={member.name} size={22} />
              <Text style={styles.mentionChipText}>{member.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Sticky comment input */}
      <View style={[styles.commentInputBar, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.commentInput}
          placeholder="Add a comment… type @ to mention"
          placeholderTextColor={Colors.textMuted}
          value={commentText}
          onChangeText={handleCommentChange}
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
  commentAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  commentAuthor: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  commentTitleBadge: { fontSize: Typography.xs, color: Colors.textMuted, fontStyle: 'italic' },
  commentTime: { fontSize: Typography.xs, color: Colors.textMuted },
  commentBody: { fontSize: Typography.base, color: Colors.textSecondary, lineHeight: 21 },

  // Success banner
  successBanner: {
    backgroundColor: '#F0FDF4',
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: '#16A34A',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  successBannerText: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: '#16A34A',
  },

  // Management card
  manageCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  manageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  manageTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  updateButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minWidth: 110,
    alignItems: 'center',
  },
  updateButtonDisabled: { opacity: 0.6 },
  updateButtonText: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
  },
  manageLabel: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.medium,
    width: 72,
  },
  manageCurrentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
    justifyContent: 'flex-end',
  },
  manageCurrentText: {
    fontSize: Typography.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.medium,
  },
  manageChevron: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  optionRow: { marginTop: Spacing.xs },
  optionRowContent: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  optionChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  optionChipActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  optionChipText: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.medium,
  },
  optionChipTextActive: {
    color: Colors.primary,
  },

  // Comment bar
  commentInputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border },
  commentInput: { flex: 1, minHeight: MIN_TOUCH_TARGET, maxHeight: 100, backgroundColor: Colors.background, borderRadius: Radius.input, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: Typography.base, color: Colors.textPrimary },
  sendButton: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: Radius.button, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: Colors.white, fontSize: 18, fontWeight: Typography.bold },

  // Mention picker
  mentionPicker: { backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border, maxHeight: 56 },
  mentionPickerContent: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm, alignItems: 'center' },
  mentionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  mentionChipText: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.medium },

  // Inline mention highlight in comment bodies
  mentionText: { color: Colors.primary, fontWeight: Typography.semibold },
});
