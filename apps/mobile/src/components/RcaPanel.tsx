import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';

import { SnagStatus, ROLE_LABELS } from '../types';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import {
  getSnagRca, assignRca, submitRca, acceptRca, rejectRca, reassignRca, cancelRca,
  waiveRca, unwaiveRca, SnagRca, SiteAssignee,
} from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import Button from './Button';
import Icon from './Icon';
import WhyChain, { WHY_INDICES } from './WhyChain';
import { StepStatus } from './StepCard';

interface Props {
  issueId: string;
  /** Only meaningful for 'resolved' (assign a new RCA) and 'rca_pending'
   *  (an RCA is currently in flight) — the caller only renders this panel
   *  for a resolved or rca_pending serious snag. */
  status: SnagStatus;
  /** The problem statement why #1 is asked of — the snag's own description.
   *  The 5 Whys starts from what happened, not from the cause already on
   *  record, so this is deliberately the description and not root_cause_text. */
  problem: string;
  /** Supervisor/admin of this site — can assign, and accept/reject a
   *  submitted RCA. */
  canEdit: boolean;
  currentUserId: string | null;
  /** Candidate pool for delegation — same site-scoped list ManageIssuePanel
   *  uses for the owner picker. */
  assignees: SiteAssignee[];
  /** Waiver state from the snag row — "no formal RCA needed here", recorded so
   *  the snag stops counting as outstanding analysis on the Admin dashboard.
   *  Null/undefined means not waived. */
  rcaWaivedAt?: string | null;
  rcaWaivedReason?: string | null;
  /** Called after any action that could change the snag's own status
   *  (assign, accept) so the parent re-fetches the issue. */
  onChanged: () => void;
  /** Reports a coarse status/summary up whenever the RCA state is (re)fetched,
   *  so the parent's StepCard header can reflect it without duplicating the
   *  getSnagRca fetch itself — same idea as onChanged, just for display. */
  onStatusChange?: (status: StepStatus, summary: string) => void;
}

export default function RcaPanel({
  issueId, status, problem, canEdit, currentUserId, assignees, rcaWaivedAt, rcaWaivedReason,
  onChanged, onStatusChange,
}: Props) {
  const { showToast } = useToast();

  const [rca, setRca] = useState<SnagRca | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // Recovery actions — an assignee who's left or gone quiet shouldn't be
  // able to strand a case at rca_pending forever.
  const [showReassignPicker, setShowReassignPicker] = useState(false);
  const [reassigneeId, setReassigneeId] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // "No RCA needed" — the disposition that lets a resolved serious snag leave
  // the Admin dashboard's RCA-outstanding count without a formal 5-Whys.
  const [waiveModalOpen, setWaiveModalOpen] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');
  const [waiving, setWaiving] = useState(false);
  const [unwaiving, setUnwaiving] = useState(false);
  const isWaived = Boolean(rcaWaivedAt);

  const fetchRca = useCallback(async () => {
    const data = await getSnagRca(issueId);
    setRca(data);
    setLoaded(true);

    if (status === 'resolved') {
      if (data?.status === 'accepted') {
        onStatusChange?.('done', `Completed by ${assignees.find((a) => a.id === data.assignedTo)?.name ?? 'Unknown'}`);
      } else if (rcaWaivedAt) {
        // A recorded "not required" decision is a finished step, not a pending
        // one — this is what stops the Root Cause chip sitting amber forever on
        // every resolved serious snag (PRODUCT_REVIEW.md §3.1/§6.2).
        onStatusChange?.('done', 'Not required');
      } else if (data?.status === 'cancelled') {
        // Previously fell through to "Not started", hiding the fact that an
        // analysis had been assigned and abandoned (PRODUCT_REVIEW.md §3.3).
        onStatusChange?.('pending', 'Cancelled — not restarted');
      } else {
        onStatusChange?.('pending', 'Not started');
      }
    } else if (status === 'rca_pending') {
      const assigneeName = data ? assignees.find((a) => a.id === data.assignedTo)?.name ?? 'Unknown' : 'Unknown';
      if (data?.status === 'submitted') onStatusChange?.('in_progress', 'Submitted — awaiting review');
      else if (data?.status === 'rejected') onStatusChange?.('in_progress', 'Sent back — needs another look');
      else onStatusChange?.('in_progress', `Assigned to ${assigneeName}`);
    }
    // onStatusChange deliberately excluded — the parent passes a stable,
    // useCallback-memoized handler, and excluding it here avoids re-fetching
    // RCA state if that identity were ever to change for an unrelated reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId, status, assignees, rcaWaivedAt]);

  useEffect(() => { fetchRca(); }, [fetchRca, status]);

  function nameOf(userId: string): string {
    return assignees.find((a) => a.id === userId)?.name ?? 'Unknown';
  }

  async function handleAssign() {
    if (!assigneeId) return;
    setAssigning(true);
    const { error } = await assignRca(issueId, assigneeId);
    setAssigning(false);
    if (!error) {
      setShowAssignPicker(false);
      setAssigneeId(null);
      showToast('RCA assigned');
      onChanged();
      fetchRca();
    } else {
      showToast(error.message ?? 'Could not assign RCA');
    }
  }

  // Read from what's actually saved, not from local drafts: WhyChain persists
  // each step as it's answered, so the server is the only state that matters
  // and submit no longer has to re-save five rows first.
  const allWhysFilled = WHY_INDICES.every((i) => {
    const w = rca?.whys.find((x) => x.whyIndex === i);
    return Boolean(w?.whyText.trim() && w?.answerText.trim());
  });

  async function handleSubmit() {
    if (!rca || !allWhysFilled) return;
    setSubmitting(true);
    const { error } = await submitRca(rca.id);
    setSubmitting(false);
    if (!error) {
      showToast('RCA submitted for review');
      onChanged();
      fetchRca();
    } else {
      showToast(error.message ?? 'Could not submit RCA');
    }
  }

  async function handleAccept() {
    if (!rca) return;
    setAccepting(true);
    const { error } = await acceptRca(rca.id);
    setAccepting(false);
    if (!error) {
      showToast('RCA accepted — snag resolved');
      onChanged();
      fetchRca();
    } else {
      showToast(error.message ?? 'Could not accept RCA');
    }
  }

  async function handleReject() {
    if (!rca || !rejectNote.trim()) return;
    setRejecting(true);
    const { error } = await rejectRca(rca.id, rejectNote.trim());
    setRejecting(false);
    if (!error) {
      setRejectModalOpen(false);
      setRejectNote('');
      showToast('RCA sent back');
      onChanged();
      fetchRca();
    } else {
      showToast(error.message ?? 'Could not reject RCA');
    }
  }

  async function handleReassign() {
    if (!rca || !reassigneeId) return;
    setReassigning(true);
    const { error } = await reassignRca(rca.id, reassigneeId);
    setReassigning(false);
    if (!error) {
      setShowReassignPicker(false);
      setReassigneeId(null);
      showToast('RCA reassigned');
      onChanged();
      fetchRca();
    } else {
      showToast(error.message ?? 'Could not reassign RCA');
    }
  }

  async function handleCancel() {
    if (!rca) return;
    setCancelling(true);
    const { error } = await cancelRca(rca.id);
    setCancelling(false);
    if (!error) {
      setCancelConfirmOpen(false);
      showToast('RCA cancelled — snag back to resolved');
      onChanged();
      fetchRca();
    } else {
      showToast(error.message ?? 'Could not cancel RCA');
    }
  }

  async function handleWaive() {
    if (!waiveReason.trim()) return;
    setWaiving(true);
    const { error } = await waiveRca(issueId, waiveReason.trim());
    setWaiving(false);
    if (!error) {
      setWaiveModalOpen(false);
      setWaiveReason('');
      showToast('Recorded — no RCA needed');
      onChanged();
    } else {
      showToast(error.message ?? 'Could not record that');
    }
  }

  async function handleUnwaive() {
    setUnwaiving(true);
    const { error } = await unwaiveRca(issueId);
    setUnwaiving(false);
    if (!error) {
      showToast('RCA is outstanding again');
      onChanged();
    } else {
      showToast(error.message ?? 'Could not undo that');
    }
  }

  if (!loaded) return null;

  // ── Resolved: assign a (new) RCA, or show the last completed one ──────────
  if (status === 'resolved') {
    const hasAccepted = rca?.status === 'accepted';
    const wasCancelled = rca?.status === 'cancelled';
    if (!canEdit && !hasAccepted && !isWaived) return null;

    return (
      <>
        {/* A recorded "not required" decision, with who made it and why —
            otherwise the reason for skipping a formal analysis lives nowhere. */}
        {isWaived && (
          <View style={styles.waivedBlock}>
            <View style={styles.waivedHeaderRow}>
              <Icon name="checkmark-circle-outline" size="sm" color={Colors.success} />
              <Text style={styles.waivedTitle}>
                No RCA required
                {rcaWaivedAt ? ` · ${new Date(rcaWaivedAt).toLocaleDateString()}` : ''}
              </Text>
            </View>
            {rcaWaivedReason ? <Text style={styles.waivedReason}>{rcaWaivedReason}</Text> : null}
            {canEdit && (
              <Button
                label="Mark RCA as needed"
                variant="outline"
                onPress={handleUnwaive}
                loading={unwaiving}
                fullWidth
              />
            )}
          </View>
        )}

        {/* An abandoned round used to be invisible here — the panel showed
            "Assign RCA" as though nothing had ever happened. */}
        {wasCancelled && !isWaived && rca && (
          <View style={styles.cancelledBanner}>
            <Icon name="close-circle-outline" size="sm" color={Colors.textSecondary} />
            <Text style={styles.cancelledText}>
              A previous RCA assigned to {nameOf(rca.assignedTo)} was cancelled without being completed.
            </Text>
          </View>
        )}

        {hasAccepted && rca && (
          <View style={styles.completedBlock}>
            <Text style={styles.completedText}>
              Completed by {nameOf(rca.assignedTo)}
              {rca.acceptedAt ? ` · accepted ${new Date(rca.acceptedAt).toLocaleDateString()}` : ''}
            </Text>
            <WhyChain
              rcaId={rca.id}
              whys={rca.whys}
              problem={problem}
              canEdit={false}
              onSaved={fetchRca}
            />
          </View>
        )}

        {canEdit && !showAssignPicker && (
          <>
            <Button
              label={hasAccepted ? 'Assign New RCA' : 'Assign RCA'}
              variant="outline"
              icon="git-branch-outline"
              onPress={() => setShowAssignPicker(true)}
              fullWidth
            />
            {/* The escape hatch that makes the dashboard count meaningful: not
                every resolved serious snag warrants a formal 5-Whys, and
                without a way to say so the count never reaches zero. */}
            {!hasAccepted && !isWaived && (
              <Button
                label="No RCA needed"
                variant="outline"
                onPress={() => setWaiveModalOpen(true)}
                fullWidth
              />
            )}
          </>
        )}

        {canEdit && showAssignPicker && (
          <>
            <Text style={styles.hint}>Who should complete the 5 Whys for this incident?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
              {assignees.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => setAssigneeId(a.id)}
                  style={[styles.optionChip, assigneeId === a.id && styles.optionChipActive]}
                >
                  <Text style={[styles.optionChipText, assigneeId === a.id && styles.optionChipTextActive]}>
                    {a.name} · {ROLE_LABELS[a.role]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.rowButtons}>
              <Button
                label="Cancel"
                variant="outline"
                onPress={() => { setShowAssignPicker(false); setAssigneeId(null); }}
                style={styles.flex1}
              />
              <Button
                label="Delegate"
                onPress={handleAssign}
                loading={assigning}
                disabled={!assigneeId}
                style={styles.flex1}
              />
            </View>
          </>
        )}

        <Modal visible={waiveModalOpen} transparent animationType="fade" onRequestClose={() => setWaiveModalOpen(false)}>
          <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>No RCA needed?</Text>
              <Text style={styles.hint}>
                This stays on the record as your decision, with your name against it. The snag drops off the
                dashboard&apos;s RCA-outstanding count. You can reverse it at any time.
              </Text>
              <TextInput
                style={styles.noteInput}
                placeholder="Why doesn't this need a formal analysis?"
                placeholderTextColor={Colors.textMuted}
                value={waiveReason}
                onChangeText={setWaiveReason}
                multiline
                textAlignVertical="top"
              />
              <View style={styles.rowButtons}>
                <Button
                  label="Cancel"
                  variant="outline"
                  onPress={() => { setWaiveModalOpen(false); setWaiveReason(''); }}
                  style={styles.flex1}
                />
                <Button
                  label="Record"
                  onPress={handleWaive}
                  loading={waiving}
                  disabled={!waiveReason.trim()}
                  style={styles.flex1}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </>
    );
  }

  // ── rca_pending: an RCA is currently in flight ─────────────────────────────
  if (status === 'rca_pending' && rca) {
    const isAssignee = currentUserId === rca.assignedTo;
    const canEditWhys = isAssignee || canEdit;

    const canReassign = canEdit && rca.status !== 'submitted';

    return (
      <>
        {/* Recovery actions — supervisor/admin only. Handles the case where
            the assignee has left or gone quiet, so the snag doesn't get
            stuck at rca_pending forever. */}
        {canEdit && !showReassignPicker && (
          <View style={styles.rowButtons}>
            {canReassign && (
              <Button
                label="Reassign"
                variant="outline"
                icon="swap-horizontal-outline"
                onPress={() => setShowReassignPicker(true)}
                style={styles.flex1}
              />
            )}
            <Button
              label="Cancel RCA"
              variant="dangerOutline"
              onPress={() => setCancelConfirmOpen(true)}
              style={styles.flex1}
            />
          </View>
        )}

        {showReassignPicker && (
          <>
            <Text style={styles.hint}>Hand this RCA to someone else.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
              {assignees.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => setReassigneeId(a.id)}
                  style={[styles.optionChip, reassigneeId === a.id && styles.optionChipActive]}
                >
                  <Text style={[styles.optionChipText, reassigneeId === a.id && styles.optionChipTextActive]}>
                    {a.name} · {ROLE_LABELS[a.role]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.rowButtons}>
              <Button
                label="Cancel"
                variant="outline"
                onPress={() => { setShowReassignPicker(false); setReassigneeId(null); }}
                style={styles.flex1}
              />
              <Button
                label="Reassign"
                onPress={handleReassign}
                loading={reassigning}
                disabled={!reassigneeId}
                style={styles.flex1}
              />
            </View>
          </>
        )}

        {rca.status === 'submitted' ? (
          <>
            <Text style={styles.hint}>
              {canEdit
                ? `Submitted by ${nameOf(rca.assignedTo)} — review the 5 Whys below.`
                : 'Submitted — waiting for review.'}
            </Text>
            <WhyChain
              rcaId={rca.id}
              whys={rca.whys}
              problem={problem}
              canEdit={false}
              onSaved={fetchRca}
            />
            {canEdit && (
              <View style={styles.rowButtons}>
                <Button
                  label="Reject"
                  variant="dangerOutline"
                  onPress={() => setRejectModalOpen(true)}
                  style={styles.flex1}
                />
                <Button label="Accept" onPress={handleAccept} loading={accepting} style={styles.flex1} />
              </View>
            )}
          </>
        ) : canEditWhys ? (
          <>
            {rca.status === 'rejected' && rca.rejectionNote && (
              <View style={styles.rejectionBanner}>
                <Icon name="alert-circle-outline" size="sm" color={Colors.danger} />
                <Text style={styles.rejectionText}>{rca.rejectionNote}</Text>
              </View>
            )}
            <Text style={styles.hint}>
              Work down the chain — each why is asked of the answer above it.
            </Text>
            <WhyChain
              rcaId={rca.id}
              whys={rca.whys}
              problem={problem}
              canEdit
              onSaved={fetchRca}
            />
            <Button
              label="Submit for review"
              onPress={handleSubmit}
              loading={submitting}
              disabled={!allWhysFilled}
              fullWidth
            />
          </>
        ) : (
          <Text style={styles.hint}>Waiting on {nameOf(rca.assignedTo)} to complete this.</Text>
        )}

        <Modal visible={rejectModalOpen} transparent animationType="fade" onRequestClose={() => setRejectModalOpen(false)}>
          <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Send this RCA back</Text>
              <Text style={styles.hint}>Explain what needs another look.</Text>
              <TextInput
                style={styles.noteInput}
                placeholder="What needs fixing?"
                placeholderTextColor={Colors.textMuted}
                value={rejectNote}
                onChangeText={setRejectNote}
                multiline
                textAlignVertical="top"
              />
              <View style={styles.rowButtons}>
                <Button label="Cancel" variant="outline" onPress={() => setRejectModalOpen(false)} style={styles.flex1} />
                <Button
                  label="Send Back"
                  variant="dangerOutline"
                  onPress={handleReject}
                  loading={rejecting}
                  disabled={!rejectNote.trim()}
                  style={styles.flex1}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal visible={cancelConfirmOpen} transparent animationType="fade" onRequestClose={() => setCancelConfirmOpen(false)}>
          <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Cancel this RCA?</Text>
              <Text style={styles.hint}>
                The snag goes back to Resolved with no completed root-cause analysis on record. You can assign a
                new RCA at any time.
              </Text>
              <View style={styles.rowButtons}>
                <Button label="Keep it" variant="outline" onPress={() => setCancelConfirmOpen(false)} style={styles.flex1} />
                <Button
                  label="Cancel RCA"
                  variant="dangerOutline"
                  onPress={handleCancel}
                  loading={cancelling}
                  style={styles.flex1}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  hint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },

  rowButtons: { flexDirection: 'row', gap: Spacing.sm },
  flex1: { flex: 1 },

  optionRow: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  optionChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  optionChipActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  optionChipText: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
  optionChipTextActive: { color: Colors.primary },

  completedBlock: { gap: Spacing.sm },
  completedText: { fontSize: Typography.sm, color: Colors.textSecondary },

  waivedBlock: {
    gap: Spacing.sm,
    backgroundColor: Colors.successBg,
    borderRadius: Radius.button,
    padding: Spacing.sm,
  },
  waivedHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  waivedTitle: { flex: 1, fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.success },
  waivedReason: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },

  cancelledBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    padding: Spacing.sm,
  },
  cancelledText: { flex: 1, fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },



  rejectionBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.priority.highBg,
    borderRadius: Radius.button,
    padding: Spacing.sm,
  },
  rejectionText: { flex: 1, fontSize: Typography.sm, color: Colors.danger },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  modalTitle: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.textPrimary },
  noteInput: {
    minHeight: 88,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
});
