import React, { useState, useEffect, useCallback } from 'react';
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
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation, useFocusEffect, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  SnagStatus, SnagKind, SnagLane, SnagSeverity, Comment, Profile, RootStackParamList, VoteValue,
} from '../types';
import { Colors, Radius, Spacing, Typography, IconSize } from '../constants/theme';
import {
  supabase, upsertVote, deleteVote, getUserVote, getProfile, getOrgMembers,
  addComment, getSnagPhotoUrl, getInvestigationState, InvestigationState,
  getSiteAssignees, SiteAssignee, unmergeSnag,
} from '../lib/supabase';
import StatusBadge from '../components/StatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import CategoryBadge from '../components/CategoryBadge';
import ManageIssuePanel from '../components/ManageIssuePanel';
import InvestigationPanel from '../components/InvestigationPanel';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import { useBadge } from '../context/BadgeContext';

type Route = RouteProp<RootStackParamList, 'IssueDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

interface IssueDetail {
  id: string;
  reference: string;
  org_id: string;
  site_id: string;
  site_name?: string;
  description: string | null;
  status: SnagStatus;
  kind: SnagKind;
  lane: SnagLane;
  severity: SnagSeverity | null;
  is_public_submission?: boolean;
  created_at: string;
  reporter?: { id: string; name: string };
  owner?: { id: string; name: string } | null;
  comment_count?: number;
  vote_score?: number;
  upvote_count?: number;
  downvote_count?: number;
  parent_snag_id?: string | null;
  child_count?: number;
}

interface MergedChild {
  id: string;
  reference: string;
  status: SnagStatus;
}

// Mirrors the serious-lane resolve gate in update_snag_status: the first
// unmet condition (in server order) is the reason Resolve is blocked.
function computeResolveBlockReason(
  status: SnagStatus | undefined,
  inv: InvestigationState | null,
): string | null {
  if (status === 'rca_pending') return 'RCA in progress — accept or reject it first';
  if (!inv) return 'Loading investigation…';
  if (inv.completedSteps.length < 5) return `Finish the checklist (${inv.completedSteps.length}/5)`;
  if (inv.witnesses.length === 0) return 'Add a witness statement';
  if (inv.evidence.length === 0) return 'Add evidence';
  if (!inv.rootCause || !inv.rootCause.trim()) return 'Record a root cause';
  if (inv.openCorrectiveActions > 0) return 'Close corrective actions';
  return null;
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

export default function IssueDetailScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { issueId } = route.params;
  const { refreshOpenIssueCount } = useBadge();

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [parentReference, setParentReference] = useState<string | null>(null);
  const [children, setChildren] = useState<MergedChild[]>([]);
  const [childToRemove, setChildToRemove] = useState<MergedChild | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingIssue, setLoadingIssue] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [userVote, setUserVote] = useState<VoteValue | null>(null);
  const [voteLoading, setVoteLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<Profile | null>(null);
  const [orgMembers, setOrgMembers] = useState<Profile[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAt, setMentionAt] = useState(-1);
  const [investigation, setInvestigation] = useState<InvestigationState | null>(null);
  const [siteAssignees, setSiteAssignees] = useState<SiteAssignee[]>([]);

  // Voting/commenting are internal engagement mechanics — only members of
  // the snag's own organisation get them. A public reporter (or a member
  // viewing their own cross-org report) sees status + details only.
  const isOrgMember = Boolean(userProfile?.org_id && issue && userProfile.org_id === issue.org_id);
  const canEdit = isOrgMember && (userProfile?.role === 'officer_admin' || userProfile?.role === 'supervisor');
  const isSerious = issue?.lane === 'serious';

  useEffect(() => {
    fetchIssue();
    fetchComments();

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      setCurrentUserId(user.id);

      const [vote, profile] = await Promise.all([
        getUserVote(issueId, user.id),
        getProfile(user.id),
      ]);

      setUserVote(vote);
      setUserProfile(profile);

      if (profile?.org_id) {
        getOrgMembers(profile.org_id).then(setOrgMembers);
      }
    });
  }, [issueId]);

  // Re-fetch the issue whenever this screen regains focus so it never shows
  // stale data after navigating away and back.
  useFocusEffect(
    useCallback(() => {
      fetchIssue();
    }, [issueId])
  );

  // Serious-lane investigation state powers the progress panel and the
  // resolve gate. Only fetched for editors of a serious snag.
  const canManageInvestigation = isSerious && canEdit;

  const fetchInvestigation = useCallback(async () => {
    if (!canManageInvestigation) { setInvestigation(null); return; }
    setInvestigation(await getInvestigationState(issueId));
  }, [canManageInvestigation, issueId]);

  useEffect(() => { fetchInvestigation(); }, [fetchInvestigation]);

  // Owner picker candidates are scoped to the snag's site (its members and
  // supervisors, plus org admins).
  useEffect(() => {
    if (canEdit && issue?.site_id) {
      getSiteAssignees(issue.site_id).then(setSiteAssignees);
    }
  }, [canEdit, issue?.site_id]);

  async function fetchIssue() {
    const { data } = await supabase
      .from('snags_with_details')
      .select('id, reference, description, status, kind, lane, severity, photo_path, photo_paths, occurred_at, created_at, reporter_id, reporter_name, owner_id, owner_name, comment_count, vote_score, upvote_count, downvote_count, org_id, site_id, site_name, is_public_submission, parent_snag_id, child_count')
      .eq('id', issueId)
      .single();

    if (data) {
      setIssue({
        ...data,
        reporter: data.reporter_id ? { id: data.reporter_id, name: data.reporter_name } : undefined,
        owner: data.owner_id ? { id: data.owner_id, name: data.owner_name } : null,
      });
      const paths: string[] = data.photo_paths?.length ? data.photo_paths : data.photo_path ? [data.photo_path] : [];
      setActivePhotoIndex(0);
      if (paths.length > 0) {
        Promise.all(paths.map((p) => getSnagPhotoUrl(p))).then((urls) =>
          setPhotoUrls(urls.filter((u): u is string => Boolean(u)))
        );
      } else {
        setPhotoUrls([]);
      }

      // Merge state — these two are mutually exclusive per the
      // single-level-hierarchy invariant enforced server-side.
      if (data.child_count > 0) {
        const { data: kids } = await supabase
          .from('snags_with_details')
          .select('id, reference, status')
          .eq('parent_snag_id', issueId)
          .order('created_at', { ascending: true });
        setChildren((kids ?? []) as MergedChild[]);
        setParentReference(null);
      } else if (data.parent_snag_id) {
        const { data: parent } = await supabase
          .from('snags_with_details')
          .select('reference')
          .eq('id', data.parent_snag_id)
          .single();
        setParentReference(parent?.reference ?? null);
        setChildren([]);
      } else {
        setChildren([]);
        setParentReference(null);
      }
    }
    // Keep the Snags tab badge in sync — this screen is where most status-
    // affecting actions (assign, recategorise, resolve, merge) happen.
    refreshOpenIssueCount();
    setLoadingIssue(false);
  }

  async function handleUnmerge() {
    if (!childToRemove) return;
    const { error } = await unmergeSnag(childToRemove.id);
    setChildToRemove(null);
    if (!error) fetchIssue();
  }

  async function fetchComments() {
    const { data } = await supabase
      .from('comments')
      .select('*, author:profiles(id, name)')
      .eq('snag_id', issueId)
      .order('created_at', { ascending: true });

    if (data) {
      setComments(data as Comment[]);
    }
  }

  async function handleVote(value: VoteValue) {
    if (!currentUserId || voteLoading) return;
    setVoteLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (userVote === value) {
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
        setUserVote(prevVote);
        setIssue(prevIssue);
      }
    } else {
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
        setUserVote(prevVote);
        setIssue(prevIssue);
      }
    }
    setVoteLoading(false);
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

    const { error } = await addComment(issueId, commentText.trim());

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
        <Text style={{ color: Colors.textMuted }}>Snag not found.</Text>
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
      <ScreenHeader
        title={isSerious ? 'Health & Safety Report' : 'Snag Details'}
        tone={isSerious ? 'serious' : 'default'}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 80 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero photo — swipeable gallery when more than one is attached */}
        {photoUrls.length > 0 ? (
          <View>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / Dimensions.get('window').width);
                setActivePhotoIndex(index);
              }}
              scrollEventThrottle={32}
            >
              {photoUrls.map((url, i) => (
                <Image
                  key={url}
                  source={{ uri: url }}
                  style={[styles.heroPhoto, { width: Dimensions.get('window').width }]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  placeholder={i === 0 ? { blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' } : undefined}
                  transition={200}
                />
              ))}
            </ScrollView>
            {photoUrls.length > 1 && (
              <View style={styles.photoDots}>
                {photoUrls.map((url, i) => (
                  <View key={url} style={[styles.photoDot, i === activePhotoIndex && styles.photoDotActive]} />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.heroPlaceholder}>
            <Icon name="camera-outline" size={IconSize.xxl} color={Colors.textMuted} />
          </View>
        )}

        <View style={[styles.content, isSerious && styles.contentSerious]}>
          {/* Reference + site */}
          <View style={styles.referenceRow}>
            <Text style={styles.reference}>{issue.reference}</Text>
            {issue.site_name && <Text style={styles.siteText} numberOfLines={1}>{issue.site_name}</Text>}
          </View>
          <Text style={styles.title}>{issue.description || 'No description'}</Text>

          {/* Badges — status before controls: current state shown up front */}
          <View style={styles.badgeRow}>
            <StatusBadge status={issue.status} />
            <CategoryBadge kind={issue.kind} />
            <PriorityBadge severity={issue.severity} />
          </View>

          {/* Meta */}
          <Text style={styles.meta}>
            Reported by {issue.reporter?.name ?? 'Unknown'} · {timeAgo(issue.created_at)}
          </Text>

          {issue.owner ? (
            <Text style={styles.assigneeText}>Assigned to {issue.owner.name}</Text>
          ) : (
            <Text style={styles.unassigned}>Unassigned</Text>
          )}

          {/* Manage — inline for supervisors/admins, boxed between the
              assignee line and the vote bar (replaces the old header
              button that pushed a separate ManageIssue screen). */}
          {canEdit && (
            <ManageIssuePanel
              issueId={issue.id}
              status={issue.status}
              lane={issue.lane}
              kind={issue.kind}
              severity={issue.severity}
              owner={issue.owner ?? null}
              assignees={siteAssignees}
              resolveBlockReason={computeResolveBlockReason(issue.status, investigation)}
              isPublicSubmission={issue.is_public_submission ?? false}
              onUpdated={() => { fetchIssue(); fetchInvestigation(); }}
            />
          )}

          {/* Merge — a snag is either a parent (with children below) or a
              child (with a banner pointing at its parent), never both. */}
          {parentReference && (
            <TouchableOpacity
              style={styles.mergeBanner}
              onPress={() => issue.parent_snag_id && navigation.push('IssueDetail', { issueId: issue.parent_snag_id })}
              activeOpacity={0.7}
            >
              <Icon name="git-merge-outline" size="sm" color={Colors.primary} />
              <Text style={styles.mergeBannerText}>Merged into {parentReference}</Text>
              <Icon name="chevron-forward" size="sm" color={Colors.primary} />
            </TouchableOpacity>
          )}

          {children.length > 0 && (
            <Card variant="elevated" style={styles.mergedCard}>
              <Text style={styles.mergedHeader}>Merged snags ({children.length})</Text>
              {children.map((child) => (
                <View key={child.id} style={styles.mergedRow}>
                  <TouchableOpacity
                    style={styles.mergedRowMain}
                    onPress={() => navigation.push('IssueDetail', { issueId: child.id })}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.mergedRowRef}>{child.reference}</Text>
                    <StatusBadge status={child.status} />
                  </TouchableOpacity>
                  {canEdit && (
                    <TouchableOpacity onPress={() => setChildToRemove(child)} hitSlop={8}>
                      <Icon name="close-circle-outline" size="md" color={Colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </Card>
          )}

          {/* Serious-lane investigation — clear the resolve gate in-app */}
          {canManageInvestigation && investigation && (
            <InvestigationPanel
              issueId={issue.id}
              orgId={issue.org_id}
              state={investigation}
              onChanged={() => { fetchInvestigation(); fetchIssue(); }}
            />
          )}

          {/* Vote bar — org members only */}
          {isOrgMember && (
          <Card variant="elevated" style={styles.voteBar}>
            <TouchableOpacity
              style={[styles.voteButton, userVote === 1 && styles.voteButtonUpActive]}
              onPress={() => handleVote(1)}
              disabled={voteLoading}
              activeOpacity={0.75}
            >
              <Icon name="caret-up" size="lg" color={userVote === 1 ? Colors.success : Colors.textMuted} />
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
              <Icon name="caret-down" size="lg" color={userVote === -1 ? Colors.danger : Colors.textMuted} />
              <Text style={[styles.voteLabel, userVote === -1 && styles.voteLabelDownActive]}>
                {issue.downvote_count ?? 0}
              </Text>
            </TouchableOpacity>
          </Card>
          )}

          {!isOrgMember && (
            <Text style={styles.publicViewerNote}>
              You'll see status updates for this report here. The team is on it.
            </Text>
          )}

          {isOrgMember && <View style={styles.divider} />}

          {/* Comments — internal, hidden from public reporters */}
          {isOrgMember && (
          <>
          <Text style={styles.commentsHeader}>Comments ({comments.length})</Text>

          {comments.length === 0 ? (
            <Text style={styles.noComments}>No comments yet.</Text>
          ) : (
            comments.map((comment) => (
              <Card key={comment.id} variant="elevated" style={styles.commentBubble}>
                <View style={styles.commentHeader}>
                  <Avatar name={comment.author?.name ?? '?'} size={30} />
                  <View style={styles.commentMeta}>
                    <View style={styles.commentAuthorRow}>
                      <Text style={styles.commentAuthor}>{comment.author?.name ?? 'Unknown'}</Text>
                    </View>
                    <Text style={styles.commentTime}>{timeAgo(comment.created_at)}</Text>
                  </View>
                </View>
                {renderCommentBody(comment.body)}
              </Card>
            ))
          )}
          </>
          )}
        </View>
      </ScrollView>

      {/* Mention picker */}
      {isOrgMember && mentionSuggestions.length > 0 && (
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
              <Avatar name={member.name} size={22} />
              <Text style={styles.mentionChipText}>{member.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Sticky comment input — org members only */}
      {isOrgMember && (
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
            <Icon name="arrow-up" size="md" color={Colors.white} />
          )}
        </TouchableOpacity>
      </View>
      )}

      <ConfirmDialog
        visible={!!childToRemove}
        title="Remove from this merge?"
        message={`${childToRemove?.reference} will become an independent snag again with its own status.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleUnmerge}
        onCancel={() => setChildToRemove(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  scroll: { flex: 1 },
  heroPhoto: { width: '100%', height: 280, backgroundColor: Colors.background },
  heroPlaceholder: { width: '100%', height: 200, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  photoDots: {
    position: 'absolute',
    bottom: Spacing.sm,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  photoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  photoDotActive: {
    backgroundColor: Colors.white,
  },
  content: { padding: Spacing.lg, gap: Spacing.md },
  contentSerious: {
    borderTopWidth: 3,
    borderTopColor: Colors.serious,
  },
  referenceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  reference: { fontSize: Typography.sm, fontWeight: Typography.bold, color: Colors.textMuted, letterSpacing: 0.5 },
  siteText: { flexShrink: 1, fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary, textAlign: 'right' },
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
  voteButtonUpActive: { backgroundColor: Colors.successBg, borderColor: Colors.success },
  voteButtonDownActive: { backgroundColor: Colors.priority.highBg, borderColor: Colors.danger },
  voteLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textMuted },
  voteLabelUpActive: { color: Colors.success },
  voteLabelDownActive: { color: Colors.danger },
  voteScore: { alignItems: 'center', minWidth: 48 },
  voteScoreNumber: { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.textSecondary },
  voteScorePositive: { color: Colors.success },
  voteScoreNegative: { color: Colors.danger },
  voteScoreLabel: { fontSize: Typography.xs, color: Colors.textMuted },

  divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
  publicViewerNote: {
    fontSize: Typography.sm,
    color: Colors.textMuted,
    fontStyle: 'italic',
    marginTop: Spacing.sm,
  },
  commentsHeader: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  noComments: { fontSize: Typography.sm, color: Colors.textMuted, fontStyle: 'italic' },
  commentBubble: { gap: Spacing.sm },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  commentMeta: { flex: 1 },
  commentAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  commentAuthor: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  commentTime: { fontSize: Typography.xs, color: Colors.textMuted },
  commentBody: { fontSize: Typography.base, color: Colors.textSecondary, lineHeight: 21 },

  // Comment bar
  commentInputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border },
  commentInput: { flex: 1, minHeight: 48, maxHeight: 100, backgroundColor: Colors.background, borderRadius: Radius.input, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: Typography.base, color: Colors.textPrimary },
  sendButton: { width: 48, height: 48, borderRadius: Radius.button, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: 0.4 },

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

  mentionText: { color: Colors.primary, fontWeight: Typography.semibold },

  // Merge
  mergeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
  },
  mergeBannerText: { flex: 1, fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.primary },
  mergedCard: { gap: Spacing.sm, marginTop: Spacing.sm },
  mergedHeader: { fontSize: Typography.sm, fontWeight: Typography.bold, color: Colors.textMuted, letterSpacing: 0.5 },
  mergedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  mergedRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  mergedRowRef: { flex: 1, fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textPrimary },
});
