import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Linking,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation, useFocusEffect, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import {
  SnagStatus, SnagKind, SnagLane, SnagSeverity, Comment, Profile, RootStackParamList, VoteValue,
} from '../types';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  supabase, upsertVote, deleteVote, getUserVote, getProfile, getOrgMembers,
  addComment, getSnagPhotoUrl, getInvestigationState, InvestigationState,
  getSiteAssignees, SiteAssignee, unmergeSnag,
  getSnagAuditLog, describeAuditAction, AuditLogEntry, exportInvestigation, escalateSnag,
  getSnagRca, SnagRca, getSnagDebriefs, SnagDebrief,
} from '../lib/supabase';
import StatusBadge from '../components/StatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import CategoryBadge from '../components/CategoryBadge';
import ManageIssuePanel from '../components/ManageIssuePanel';
import ChecklistPanel from '../components/ChecklistPanel';
import WitnessesPanel from '../components/WitnessesPanel';
import EvidencePanel from '../components/EvidencePanel';
import RootCausePanel from '../components/RootCausePanel';
import NotifiableEventPanel from '../components/NotifiableEventPanel';
import CorrectiveActionsPanel from '../components/CorrectiveActionsPanel';
import RcaPanel from '../components/RcaPanel';
import DebriefPanel from '../components/DebriefPanel';
import StepCard, { StepStatus } from '../components/StepCard';
import NextStepCard, { NextStep } from '../components/NextStepCard';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import { useBadge } from '../context/BadgeContext';
import { useToast } from '../hooks/useToast';

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
  is_notifiable: boolean;
  notifiable_marked_by: string | null;
  notifiable_marked_at: string | null;
  notifying_org_id: string | null;
  notifying_pcbu_note: string | null;
  notifying_org_name?: string | null;
  rca_waived_at?: string | null;
  rca_waived_reason?: string | null;
  escalated_at?: string | null;
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

type StepKey =
  | 'notifiable'
  | 'checklist'
  | 'witnesses'
  | 'evidence'
  | 'rootCause'
  | 'correctiveActions'
  | 'rca'
  | 'debrief';

/** A resolve-gate condition, in the same order update_snag_status checks them. */
interface GateCondition {
  unmet: boolean;
  /** Imperative — what to do, not what's missing. */
  title: string;
  detail: string;
  cta: string;
  stepKey: StepKey;
  /** The terser phrasing ManageIssuePanel shows under its Resolve button. */
  blockReason: string;
}

// Mirrors the serious-lane resolve gate in update_snag_status. This is the one
// place that ordering lives: both the Next-step card and ManageIssuePanel's
// blocked-reason line read from it, so they can never disagree about what's
// outstanding.
function computeGate(
  status: SnagStatus | undefined,
  inv: InvestigationState | null,
  notifiableDecided: boolean,
): GateCondition[] {
  if (status === 'rca_pending') {
    return [{
      unmet: true,
      title: 'Review the 5 Whys',
      detail: 'The analysis has been submitted and is waiting on you to accept it or send it back.',
      cta: 'Open the analysis',
      stepKey: 'rca',
      blockReason: 'RCA in progress — accept or reject it first',
    }];
  }
  if (!inv) {
    return [{
      unmet: true,
      title: 'Loading investigation…',
      detail: 'Fetching what has been recorded so far.',
      cta: 'Open investigation',
      stepKey: 'checklist',
      blockReason: 'Loading investigation…',
    }];
  }

  const done = inv.completedSteps.length;
  return [
    {
      // First, matching the server: the most time-critical thing on a serious
      // snag, and the one with a statutory clock attached.
      unmet: !notifiableDecided,
      title: 'Decide if this is notifiable',
      detail: "Does it meet WorkSafe's threshold? A notifiable event has to be reported as soon as possible, and the site preserved.",
      cta: 'Make the call',
      stepKey: 'notifiable',
      blockReason: 'Decide if this is a notifiable event',
    },
    {
      unmet: done < 5,
      title: 'Finish the first-response checklist',
      detail: `${done} of 5 steps done — make safe, preserve the scene, capture evidence, identify witnesses, find the cause.`,
      cta: 'Open the checklist',
      stepKey: 'checklist',
      blockReason: `Finish the checklist (${done}/5)`,
    },
    {
      unmet: inv.witnesses.length === 0,
      title: 'Add a witness statement',
      detail: 'Record what someone who was there saw, in their words.',
      cta: 'Add a witness',
      stepKey: 'witnesses',
      blockReason: 'Add a witness statement',
    },
    {
      unmet: inv.evidence.length === 0,
      title: 'Capture evidence',
      detail: 'Photos of the scene, the equipment, and anything that explains how this happened.',
      cta: 'Add evidence',
      stepKey: 'evidence',
      blockReason: 'Add evidence',
    },
    {
      unmet: !inv.rootCause || !inv.rootCause.trim(),
      title: 'Record the root cause',
      detail: 'What actually caused this — not what went wrong, but why it could.',
      cta: 'Record root cause',
      stepKey: 'rootCause',
      blockReason: 'Record a root cause',
    },
    {
      unmet: inv.openCorrectiveActions > 0,
      title: 'Close the corrective actions',
      detail: `${inv.openCorrectiveActions} still open — each needs completing and verifying.`,
      cta: 'Open corrective actions',
      stepKey: 'correctiveActions',
      blockReason: 'Close corrective actions',
    },
  ];
}

/** The first unmet gate condition — the reason Resolve is blocked, or null. */
function computeResolveBlockReason(
  status: SnagStatus | undefined,
  inv: InvestigationState | null,
  notifiableDecided: boolean,
): string | null {
  return computeGate(status, inv, notifiableDecided).find((c) => c.unmet)?.blockReason ?? null;
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
  const { showToast } = useToast();

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [parentReference, setParentReference] = useState<string | null>(null);
  const [children, setChildren] = useState<MergedChild[]>([]);
  const [childToRemove, setChildToRemove] = useState<MergedChild | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  /** Manage is a disclosure on the serious lane — see the render for why. */
  const [manageOpen, setManageOpen] = useState(false);
  /** The comment bar is a one-line prompt until tapped. */
  const [composerOpen, setComposerOpen] = useState(false);
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
  const [exportingPdf, setExportingPdf] = useState(false);
  const [escalating, setEscalating] = useState(false);

  // System activity trail — audit_log entries for this snag, shown alongside
  // comments so every status/owner/category change is timestamped and
  // attributed without relying on someone leaving a manual note.
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);

  // Voting/commenting are internal engagement mechanics — only members of
  // the snag's own organisation get them. A public reporter (or a member
  // viewing their own cross-org report) sees status + details only.
  const isOrgMember = Boolean(userProfile?.org_id && issue && userProfile.org_id === issue.org_id);
  const canEdit = isOrgMember && (userProfile?.role === 'officer_admin' || userProfile?.role === 'supervisor');
  const isSerious = issue?.lane === 'serious';

  // Comments and system activity entries merged into one chronological feed.
  const feedItems = useMemo(() => {
    type FeedItem =
      | { type: 'comment'; id: string; created_at: string; comment: Comment }
      | { type: 'activity'; id: string; created_at: string; entry: AuditLogEntry };
    const items: FeedItem[] = [
      ...comments.map((c): FeedItem => ({ type: 'comment', id: c.id, created_at: c.created_at, comment: c })),
      ...activity.map((a): FeedItem => ({ type: 'activity', id: a.id, created_at: a.created_at, entry: a })),
    ];
    items.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return items;
  }, [comments, activity]);

  useEffect(() => {
    fetchIssue();
    fetchComments();
    fetchActivity();

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
      fetchActivity();
    }, [issueId])
  );

  // Serious-lane investigation state powers the progress panel and the
  // resolve gate. Only fetched for editors of a serious snag.
  const canManageInvestigation = isSerious && canEdit;

  // Escalation is reporter-only, enforced server-side (escalate_snag checks
  // reporter_id = auth.uid()) — it's the person who raised a fixit/improvement
  // saying "this is actually unsafe", not a supervisor action. Open niggles
  // only, and only once. Previously the RPC had no caller at all, so this was
  // unreachable from either app (PRODUCT_REVIEW.md §3.8).
  const canEscalate = Boolean(
    issue && !isSerious && isOrgMember &&
    currentUserId === issue.reporter?.id &&
    (issue.status === 'flagged' || issue.status === 'in_progress') &&
    !issue.escalated_at
  );

  const fetchInvestigation = useCallback(async () => {
    if (!canManageInvestigation) { setInvestigation(null); return; }
    setInvestigation(await getInvestigationState(issueId));
  }, [canManageInvestigation, issueId]);

  useEffect(() => { fetchInvestigation(); }, [fetchInvestigation]);

  // Seeds the RCA and debrief card summaries. Serious lane only, and run in
  // parallel with the investigation fetch — two small reads on a screen that
  // already makes several.
  const fetchRcaAndDebriefs = useCallback(async () => {
    if (!isSerious || !isOrgMember) { setRcaState(null); setDebriefs(null); return; }
    const [rca, briefs] = await Promise.all([
      getSnagRca(issueId),
      getSnagDebriefs(issueId),
    ]);
    setRcaState(rca);
    setDebriefs(briefs);
  }, [isSerious, isOrgMember, issueId]);

  useEffect(() => { fetchRcaAndDebriefs(); }, [fetchRcaAndDebriefs]);

  // ── Guided serious-incident steps ─────────────────────────────────────────
  // NextStepCard names the one thing to do now; below it the collapsed
  // StepCard headers act as the progress list, each carrying its own summary.
  // (That replaced a horizontal ProgressStrip, which could only fit ~2.5 of
  // five phases at phone width and clipped the rest mid-word.)
  //
  // Steps toggle independently rather than as a strict accordion; the seeding
  // effect below only sets the *initial* expanded step once per snag, so it
  // never fights a manual toggle afterward.
  const [stepExpanded, setStepExpanded] = useState<Record<StepKey, boolean>>({
    notifiable: false, checklist: false, witnesses: false, evidence: false,
    rootCause: false, correctiveActions: false, rca: false, debrief: false,
  });
  const toggleStep = useCallback((key: string) => {
    setStepExpanded((prev) => ({ ...prev, [key]: !prev[key as StepKey] }));
  }, []);
  /** Every investigation card changes the same three things: the gate state,
   *  the snag row (status can flip), and the activity log. */
  const onInvestigationChanged = useCallback(() => {
    fetchInvestigation(); fetchIssue(); fetchActivity();
  }, [fetchInvestigation, fetchIssue, fetchActivity]);

  /** Open a step outright rather than toggle it — what NextStepCard needs, so
   *  its CTA can't close the very thing it just pointed you at. */
  const openStep = useCallback((key: StepKey) => {
    setStepExpanded((prev) => ({ ...prev, [key]: true }));
  }, []);

  // RcaPanel/DebriefPanel/CorrectiveActionsPanel self-fetch, so they report
  // their own coarse status up for the StepCard header — accurate for every
  // org member, not just editors (who are the only ones the parent's own
  // `investigation` state covers).
  // RCA and debrief state, read by the parent rather than only by the panels.
  // StepCard doesn't mount its children while collapsed, so a panel that
  // fetches its own data can't report a summary until it has been opened at
  // least once — which left those two cards blank in the very state the
  // progress list exists to describe. The panels still self-report once open
  // (fresher, and the only source for a non-editor); this just seeds it.
  const [rcaState, setRcaState] = useState<SnagRca | null>(null);
  const [debriefs, setDebriefs] = useState<SnagDebrief[] | null>(null);

  const [correctiveActionsStatus, setCorrectiveActionsStatus] = useState<{ status: StepStatus; summary: string }>({ status: 'pending', summary: '' });
  const [rcaStatus, setRcaStatus] = useState<{ status: StepStatus; summary: string }>({ status: 'pending', summary: '' });
  const [debriefStatus, setDebriefStatus] = useState<{ status: StepStatus; summary: string }>({ status: 'optional', summary: '' });
  const handleCorrectiveActionsStatusChange = useCallback((status: StepStatus, summary: string) => setCorrectiveActionsStatus({ status, summary }), []);
  const handleRcaStatusChange = useCallback((status: StepStatus, summary: string) => setRcaStatus({ status, summary }), []);
  const handleDebriefStatusChange = useCallback((status: StepStatus, summary: string) => setDebriefStatus({ status, summary }), []);

  const notifiableDecided = Boolean(issue?.is_notifiable || issue?.notifiable_marked_at);
  const notifiableStatus: StepStatus = notifiableDecided ? 'done' : 'pending';
  const notifiableSummary = issue?.is_notifiable
    ? 'Flagged as notifiable'
    : issue?.notifiable_marked_at
    ? 'Not notifiable'
    : 'Needs a decision';

  // One status/summary per investigation card. Each collapsed card has to say
  // where it stands on its own — that's what makes the stack readable without
  // opening anything, and it's why the horizontal strip wasn't needed.
  const checklistDone = investigation?.completedSteps.length ?? 0;
  const checklistStatus: StepStatus =
    checklistDone >= 5 ? 'done' : checklistDone > 0 ? 'in_progress' : 'pending';
  const checklistSummary = `${checklistDone} of 5 done`;

  const witnessCount = investigation?.witnesses.length ?? 0;
  const witnessStatus: StepStatus = witnessCount > 0 ? 'done' : 'pending';
  const witnessSummary = witnessCount === 0
    ? 'None recorded'
    : witnessCount === 1
    ? `1 statement · ${investigation?.witnesses[0]?.witness_name ?? ''}`.trim()
    : `${witnessCount} statements`;

  const evidenceCount = investigation?.evidence.length ?? 0;
  const evidenceStatus: StepStatus = evidenceCount > 0 ? 'done' : 'pending';
  const evidenceSummary = evidenceCount === 0
    ? 'None captured'
    : `${evidenceCount} item${evidenceCount === 1 ? '' : 's'}`;

  const hasRootCause = Boolean(investigation?.rootCause?.trim());
  const rootCauseStatus: StepStatus = hasRootCause ? 'done' : 'pending';
  const rootCauseSummary = hasRootCause ? 'Recorded' : 'Not recorded';

  // What NextStepCard points at. The notifiable decision comes first even
  // though it isn't a resolve-gate condition — it's the most time-critical
  // thing on a serious snag (it can carry a duty to preserve the site), and
  // the seeding effect below already treats it as step one. `remaining`
  // counts only real gate conditions, so the locked Resolve row stays
  // truthful about what's actually blocking closure.
  const gate = computeGate(issue?.status, investigation, notifiableDecided);
  const gateRemaining = gate.filter((c) => c.unmet).length;
  const firstUnmet = gate.find((c) => c.unmet);
  const nextStep: NextStep | null = firstUnmet
    ? {
        title: firstUnmet.title,
        detail: firstUnmet.detail,
        cta: firstUnmet.cta,
        remaining: gateRemaining,
      }
    : null;
  const nextStepKey: StepKey = firstUnmet?.stepKey ?? 'checklist';

  // StepCard only mounts its children while expanded, so a panel that reports
  // its own summary upward can't do so until it has been opened once — every
  // collapsed card sat blank, which is precisely what the progress list needs
  // them not to do. Corrective actions can be answered from investigation
  // state the parent already holds, so prefer that and fall back to the
  // panel's own report (the only source a non-editor has, since they get no
  // investigation state).
  const correctiveActionsSummary =
    correctiveActionsStatus.summary ||
    (investigation
      ? investigation.openCorrectiveActions > 0
        ? `${investigation.openCorrectiveActions} open`
        : 'None open'
      : '');

  // Same pattern for the RCA and debrief cards: the panel's own report wins
  // once it has mounted, and these keep the collapsed card honest until then.
  // Kept deliberately in step with what RcaPanel/DebriefPanel report, so the
  // summary doesn't visibly change wording the first time a card is opened.
  const rcaSeedSummary = (() => {
    if (issue?.rca_waived_at) return 'Waived';
    if (!rcaState) return issue?.status === 'resolved' ? 'Not assigned' : '';
    // Who owes it is the useful part while it's out for analysis — "In
    // progress" tells a supervisor nothing they can act on. orgMembers is
    // already loaded for the @mention composer, so this costs no query.
    const withName = orgMembers.find((m) => m.id === rcaState.assignedTo)?.name;
    switch (rcaState.status) {
      case 'submitted': return 'Submitted — awaiting review';
      case 'rejected': return 'Sent back — needs another look';
      case 'accepted': return 'Accepted';
      case 'cancelled': return 'Cancelled';
      default: return withName ? `With ${withName}` : 'In progress';
    }
  })();
  const rcaSummary = rcaStatus.summary || rcaSeedSummary;

  const debriefSeedSummary = !debriefs
    ? ''
    : debriefs.length === 0
    ? 'None yet — optional'
    : debriefs.some((d) => d.status === 'in_progress')
    ? 'In progress'
    : `${debriefs.length} completed`;
  const debriefSummary = debriefStatus.summary || debriefSeedSummary;

  const debriefSeedStatus: StepStatus = !debriefs || debriefs.length === 0
    ? 'optional'
    : debriefs.some((d) => d.status === 'in_progress')
    ? 'in_progress'
    : 'done';

  // No step is auto-expanded any more. NextStepCard names the current step and
  // its CTA opens it, so seeding one open as well showed the same question
  // twice — once as "Decide if this is notifiable / Make the call", and again
  // in an already-open card directly below it. The card and the seeding served
  // the same audience (canManageInvestigation) and the same purpose, so the
  // card wins and everything below it starts collapsed.

  function handleEscalate() {
    Alert.alert(
      'Flag this as a safety issue?',
      "This tells the supervisors for this site that what you reported is a hazard, not just a niggle. You can only do this once.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Flag it',
          onPress: async () => {
            setEscalating(true);
            const { error } = await escalateSnag(issueId);
            setEscalating(false);
            if (error) {
              showToast(error.message ?? 'Could not flag this');
              return;
            }
            showToast('Flagged — a supervisor has been notified');
            fetchIssue();
            fetchActivity();
          },
        },
      ]
    );
  }

  async function handleExportInvestigation() {
    if (exportingPdf) return;
    setExportingPdf(true);
    const { signedUrl, error } = await exportInvestigation(issueId);
    setExportingPdf(false);
    if (error || !signedUrl) {
      showToast(error?.message ?? 'Could not export the investigation file');
      return;
    }
    Linking.openURL(signedUrl);
  }

  // Owner/RCA-assignee candidates, scoped to the snag's site (its members
  // and supervisors, plus org admins). Fetched for any org member — not just
  // editors — since RcaPanel needs it to resolve an assignee's name even for
  // a plain worker viewing (or completing) their own delegated RCA.
  useEffect(() => {
    if (isOrgMember && issue?.site_id) {
      getSiteAssignees(issue.site_id).then(({ data, error }) => {
        setSiteAssignees(data);
        if (error) showToast(error.message ?? 'Could not load assignable people');
      });
    }
  }, [isOrgMember, issue?.site_id]);

  async function fetchIssue() {
    const { data } = await supabase
      .from('snags_with_details')
      .select('id, reference, description, status, kind, lane, severity, photo_path, photo_paths, occurred_at, created_at, reporter_id, reporter_name, owner_id, owner_name, comment_count, vote_score, upvote_count, downvote_count, org_id, site_id, site_name, is_public_submission, parent_snag_id, child_count, is_notifiable, notifiable_marked_by, notifiable_marked_at, notifying_org_id, notifying_pcbu_note, notifying_org_name, rca_waived_at, rca_waived_reason, escalated_at')
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
    if (!error) { fetchIssue(); fetchActivity(); }
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

  async function fetchActivity() {
    setActivity(await getSnagAuditLog(issueId));
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

  // @mentions are plain "@Name" text (see insertMention) rather than a
  // token tied to an ID, so resolve the final comment text back to org
  // member IDs at send time. Longest name first, masking each match before
  // checking the next — otherwise "@Jane Doe" would also register a
  // spurious mention of a separate member named "Jane".
  function extractMentionedUserIds(text: string): string[] {
    const ids = new Set<string>();
    let working = text;
    const byNameLength = [...orgMembers].sort((a, b) => b.name.length - a.name.length);
    for (const member of byNameLength) {
      if (!member.name) continue;
      const token = '@' + member.name;
      if (working.includes(token)) {
        ids.add(member.id);
        working = working.split(token).join(' '.repeat(token.length));
      }
    }
    return Array.from(ids);
  }

  async function sendComment() {
    if (!commentText.trim() || !currentUserId) return;
    setSendingComment(true);

    const trimmed = commentText.trim();
    const { error } = await addComment(issueId, trimmed, extractMentionedUserIds(trimmed));

    if (!error) {
      setCommentText('');
      setMentionQuery(null);
      setMentionAt(-1);
      setComposerOpen(false);
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
        ) : null}
        {/* No placeholder when there are no photos. It used to render a 200px
            camera icon — 58% of the first viewport on a snag that has no
            photo, pushing every actionable thing below the fold to advertise
            an absence the user already knows about. */}

        <View style={[styles.content, isSerious && styles.contentSerious]}>
          {/* Reference + site */}
          <View style={styles.referenceRow}>
            <Text style={styles.reference}>{issue.reference}</Text>
            {issue.site_name && <Text style={styles.siteText} numberOfLines={1}>{issue.site_name}</Text>}
          </View>

          {/* The description is a sentence of body copy, so it's set as body
              copy. It used to be a 28px/36 headline, which on a typical report
              ran five lines and pushed the workflow off-screen on its own.
              Clamped to three lines with a tap to expand. */}
          <TouchableOpacity
            onPress={() => setDescriptionExpanded((v) => !v)}
            activeOpacity={0.7}
            disabled={!issue.description}
          >
            <Text style={styles.title} numberOfLines={descriptionExpanded ? undefined : 3}>
              {issue.description || 'No description'}
            </Text>
          </TouchableOpacity>

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

          {/* Reporter's escalation path — "I reported this as a niggle, but it's
              actually a safety problem". Server-enforced reporter-only. */}
          {canEscalate && (
            <Button
              label="This is a safety issue"
              variant="outline"
              icon="warning-outline"
              onPress={handleEscalate}
              loading={escalating}
              fullWidth
            />
          )}

          {/* Already escalated — confirms to the reporter that it landed,
              rather than silently removing the button. */}
          {!isSerious && issue.escalated_at && (
            <View style={styles.escalatedRow}>
              <Icon name="warning-outline" size="sm" color={Colors.serious} />
              <Text style={styles.escalatedText}>
                Flagged as a safety issue · {timeAgo(issue.escalated_at)}
              </Text>
            </View>
          )}

          {/* Manage — inline for supervisors/admins, boxed between the
              assignee line and the vote bar (replaces the old header
              button that pushed a separate ManageIssue screen). */}
          {/* Behind a disclosure on the serious lane: Type/Severity/Owner are
              settings, and settings shouldn't sit between the reader and the
              investigation. Niggles keep it inline — there's no workflow below
              it there for it to get in the way of. */}
          {canEdit && isSerious && (
            <>
              <TouchableOpacity
                style={styles.manageToggle}
                onPress={() => setManageOpen((v) => !v)}
                activeOpacity={0.7}
              >
                <Icon name="options-outline" size="sm" color={Colors.textSecondary} />
                <Text style={styles.manageToggleText}>Manage</Text>
                <Icon
                  name={manageOpen ? 'chevron-up' : 'chevron-down'}
                  size="sm"
                  color={Colors.textMuted}
                />
              </TouchableOpacity>
              {manageOpen && (
                <ManageIssuePanel
                  issueId={issue.id}
                  status={issue.status}
                  lane={issue.lane}
                  kind={issue.kind}
                  severity={issue.severity}
                  owner={issue.owner ?? null}
                  assignees={siteAssignees}
                  resolveBlockReason={computeResolveBlockReason(issue.status, investigation, notifiableDecided)}
                  isPublicSubmission={issue.is_public_submission ?? false}
                  onUpdated={() => { fetchIssue(); fetchInvestigation(); fetchActivity(); }}
                />
              )}
            </>
          )}

          {canEdit && !isSerious && (
            <ManageIssuePanel
              issueId={issue.id}
              status={issue.status}
              lane={issue.lane}
              kind={issue.kind}
              severity={issue.severity}
              owner={issue.owner ?? null}
              assignees={siteAssignees}
              resolveBlockReason={computeResolveBlockReason(issue.status, investigation, notifiableDecided)}
              isPublicSubmission={issue.is_public_submission ?? false}
              onUpdated={() => { fetchIssue(); fetchInvestigation(); fetchActivity(); }}
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

          {/* One answer to "what do I do now", above the fold. The collapsed
              StepCards below are the progress list — each carries its own
              summary, so nothing needs a separate strip to advertise it. */}
          {canManageInvestigation && (
            <NextStepCard
              step={nextStep}
              onGo={() => openStep(nextStepKey)}
              onGoToResolve={() => setManageOpen(true)}
            />
          )}

          {/* Notifiable-event decision — ahead of the investigation checklist,
              since "preserve the scene" below is how the decision gets acted on. */}
          {canManageInvestigation && (
            <StepCard
              title="Notifiable Event"
              status={notifiableStatus}
              summary={notifiableSummary}
              expanded={stepExpanded.notifiable}
              onToggle={() => toggleStep('notifiable')}
            >
              <NotifiableEventPanel
                issueId={issue.id}
                isNotifiable={issue.is_notifiable}
                notifiableMarkedAt={issue.notifiable_marked_at}
                notifyingOrgId={issue.notifying_org_id}
                notifyingOrgName={issue.notifying_org_name}
                notifyingPcbuNote={issue.notifying_pcbu_note}
                canEdit={canEdit}
                onChanged={() => { fetchIssue(); fetchActivity(); }}
              />
            </StepCard>
          )}

          {/* Serious-lane investigation — four resolve-gate conditions, one
              card each. They used to share a single "Investigation" drawer
              that opened onto a checklist plus three simultaneous add-forms;
              split, each card carries its own summary while collapsed and
              only one task is ever on screen. */}
          {canManageInvestigation && investigation && (
            <>
              <StepCard
                title="Make safe & preserve scene"
                status={checklistStatus}
                summary={checklistSummary}
                expanded={stepExpanded.checklist}
                onToggle={() => toggleStep('checklist')}
              >
                <ChecklistPanel
                  issueId={issue.id}
                  state={investigation}
                  onChanged={onInvestigationChanged}
                />
              </StepCard>

              <StepCard
                title="Witnesses"
                status={witnessStatus}
                summary={witnessSummary}
                expanded={stepExpanded.witnesses}
                onToggle={() => toggleStep('witnesses')}
              >
                <WitnessesPanel
                  issueId={issue.id}
                  state={investigation}
                  onChanged={onInvestigationChanged}
                />
              </StepCard>

              <StepCard
                title="Evidence"
                status={evidenceStatus}
                summary={evidenceSummary}
                expanded={stepExpanded.evidence}
                onToggle={() => toggleStep('evidence')}
              >
                <EvidencePanel
                  issueId={issue.id}
                  orgId={issue.org_id}
                  state={investigation}
                  onChanged={onInvestigationChanged}
                />
              </StepCard>

              <StepCard
                title="Root cause"
                status={rootCauseStatus}
                summary={rootCauseSummary}
                expanded={stepExpanded.rootCause}
                onToggle={() => toggleStep('rootCause')}
              >
                <RootCausePanel
                  issueId={issue.id}
                  state={investigation}
                  onChanged={onInvestigationChanged}
                />
              </StepCard>
            </>
          )}

          {/* Corrective actions — visible to any org member on the snag's own
              org (not just editors), since an owner who isn't a supervisor
              still needs to see and complete their own assigned action;
              creating and verifying stay canEdit-gated inside the panel. */}
          {isSerious && isOrgMember && (
            <StepCard
              title="Corrective Actions"
              status={correctiveActionsStatus.status}
              summary={correctiveActionsSummary}
              expanded={stepExpanded.correctiveActions}
              onToggle={() => toggleStep('correctiveActions')}
            >
              <CorrectiveActionsPanel
                issueId={issue.id}
                orgId={issue.org_id}
                canEdit={canEdit}
                currentUserId={currentUserId}
                assignees={siteAssignees}
                onChanged={() => { fetchInvestigation(); fetchIssue(); fetchActivity(); }}
                onStatusChange={handleCorrectiveActionsStatusChange}
              />
            </StepCard>
          )}

          {/* Root cause analysis — delegated once a serious snag is resolved;
              a supervisor/admin assigns it, the assignee answers 5 Whys, then
              a supervisor/admin accepts or sends it back. */}
          {isSerious && isOrgMember && (issue.status === 'resolved' || issue.status === 'rca_pending') && (
            <StepCard
              title="5 Whys analysis"
              status={rcaStatus.status}
              summary={rcaSummary}
              expanded={stepExpanded.rca}
              onToggle={() => toggleStep('rca')}
            >
              <RcaPanel
                issueId={issue.id}
                status={issue.status}
                problem={issue.description ?? 'the incident'}
                canEdit={canEdit}
                currentUserId={currentUserId}
                assignees={siteAssignees}
                rcaWaivedAt={issue.rca_waived_at}
                rcaWaivedReason={issue.rca_waived_reason}
                onChanged={() => { fetchIssue(); fetchActivity(); fetchRcaAndDebriefs(); }}
                onStatusChange={handleRcaStatusChange}
              />
            </StepCard>
          )}

          {/* Debriefs — the record-keeping half of the investigate-then-
              change loop; RCA/corrective actions already cover the other
              two steps. Any number of debriefs, any status, in-app. */}
          {isSerious && isOrgMember && (
            <StepCard
              title="Debrief"
              status={debriefStatus.summary ? debriefStatus.status : debriefSeedStatus}
              summary={debriefSummary}
              expanded={stepExpanded.debrief}
              onToggle={() => toggleStep('debrief')}
            >
              <DebriefPanel
                issueId={issue.id}
                canEdit={canEdit}
                orgMembers={orgMembers}
                onChanged={() => { fetchActivity(); fetchRcaAndDebriefs(); }}
                onStatusChange={handleDebriefStatusChange}
              />
            </StepCard>
          )}

          {/* Export investigation — same gate as the edge function itself
              (supervisor/officer_admin on a serious snag), so this never
              appears for someone who'd just get a 403. */}
          {canManageInvestigation && (
            <Button
              label="Export investigation (PDF)"
              variant="outline"
              icon="document-text-outline"
              onPress={handleExportInvestigation}
              loading={exportingPdf}
              fullWidth
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

          {/* Activity — comments plus system entries (status/owner/category
              changes, investigation steps, merges, ...) in one timestamped,
              attributed feed. Internal, hidden from public reporters. */}
          {isOrgMember && (
          <>
          <Text style={styles.commentsHeader}>Activity ({feedItems.length})</Text>

          {feedItems.length === 0 ? (
            <Text style={styles.noComments}>No activity yet.</Text>
          ) : (
            feedItems.map((item) => item.type === 'comment' ? (
              <Card key={`comment-${item.id}`} variant="elevated" style={styles.commentBubble}>
                <View style={styles.commentHeader}>
                  <Avatar name={item.comment.author?.name ?? '?'} size={30} />
                  <View style={styles.commentMeta}>
                    <View style={styles.commentAuthorRow}>
                      <Text style={styles.commentAuthor}>{item.comment.author?.name ?? 'Unknown'}</Text>
                    </View>
                    <Text style={styles.commentTime}>{timeAgo(item.comment.created_at)}</Text>
                  </View>
                </View>
                {renderCommentBody(item.comment.body)}
              </Card>
            ) : (
              <View key={`activity-${item.id}`} style={styles.activityRow}>
                <Icon name="time-outline" size="sm" color={Colors.textMuted} />
                <Text style={styles.activityText}>
                  <Text style={styles.activityActor}>{item.entry.actor_name ?? 'Someone'}</Text>
                  {' '}{describeAuditAction(item.entry.action)} · {timeAgo(item.entry.created_at)}
                </Text>
              </View>
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

      {/* Sticky comment input — org members only.
          Collapsed to a single row until tapped. This bar is fixed chrome, so
          its height is subtracted from the viewport on every screen of scroll,
          not just once; halving it gives back more usable space than trimming
          the same number of pixels anywhere in the document would. */}
      {isOrgMember && !composerOpen && (
        <TouchableOpacity
          style={[styles.commentPrompt, { paddingBottom: insets.bottom + 8 }]}
          onPress={() => setComposerOpen(true)}
          activeOpacity={0.7}
        >
          <Icon name="chatbubble-outline" size="sm" color={Colors.textMuted} />
          <Text style={styles.commentPromptText}>Add a comment</Text>
        </TouchableOpacity>
      )}

      {isOrgMember && composerOpen && (
      <View style={[styles.commentInputBar, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.commentInput}
          placeholder="Add a comment… type @ to mention"
          placeholderTextColor={Colors.textMuted}
          value={commentText}
          onChangeText={handleCommentChange}
          multiline
          maxLength={500}
          autoFocus
          // Collapse again only when nothing is part-written, so a stray tap
          // outside can't discard a comment someone was mid-way through.
          onBlur={() => { if (!commentText.trim()) setComposerOpen(false); }}
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
  // Body copy, not a headline — see the render comment. lg/24 keeps it the most
  // prominent text on the screen without spending five lines to say so.
  title: { fontSize: Typography.lg, fontWeight: Typography.semibold, color: Colors.textPrimary, lineHeight: 24 },
  manageToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  manageToggleText: {
    flex: 1,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  badgeRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  meta: { fontSize: Typography.sm, color: Colors.textMuted },
  assigneeText: { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.medium },
  unassigned: { fontSize: Typography.sm, color: Colors.textMuted, fontStyle: 'italic' },
  description: { fontSize: Typography.base, color: Colors.textSecondary, lineHeight: 22 },

  escalatedRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.seriousBg, borderRadius: Radius.button, padding: Spacing.sm,
  },
  escalatedText: { flex: 1, fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.serious },

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
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.xs },
  activityText: { flex: 1, fontSize: Typography.xs, color: Colors.textMuted },
  activityActor: { fontWeight: Typography.semibold, color: Colors.textSecondary },

  // Comment bar
  commentPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  commentPromptText: { flex: 1, fontSize: Typography.sm, color: Colors.textMuted },
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
