import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Modal, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';

import { SnagStatus, ROLE_LABELS } from '../types';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import {
  getSnagRca, assignRca, saveRcaWhy, submitRca, acceptRca, rejectRca, SnagRca, SiteAssignee,
} from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import Card from './Card';
import Button from './Button';
import Icon from './Icon';

const WHY_INDICES = [1, 2, 3, 4, 5];

interface WhyDraft {
  why: string;
  answer: string;
}

function emptyDrafts(): Record<number, WhyDraft> {
  return Object.fromEntries(WHY_INDICES.map((i) => [i, { why: '', answer: '' }]));
}

interface Props {
  issueId: string;
  /** Only meaningful for 'resolved' (assign a new RCA) and 'rca_pending'
   *  (an RCA is currently in flight) — the caller only renders this panel
   *  for a resolved or rca_pending serious snag. */
  status: SnagStatus;
  /** Supervisor/admin of this site — can assign, and accept/reject a
   *  submitted RCA. */
  canEdit: boolean;
  currentUserId: string | null;
  /** Candidate pool for delegation — same site-scoped list ManageIssuePanel
   *  uses for the owner picker. */
  assignees: SiteAssignee[];
  /** Called after any action that could change the snag's own status
   *  (assign, accept) so the parent re-fetches the issue. */
  onChanged: () => void;
}

export default function RcaPanel({ issueId, status, canEdit, currentUserId, assignees, onChanged }: Props) {
  const { showToast } = useToast();

  const [rca, setRca] = useState<SnagRca | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [whyDrafts, setWhyDrafts] = useState<Record<number, WhyDraft>>(emptyDrafts());

  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const fetchRca = useCallback(async () => {
    const data = await getSnagRca(issueId);
    setRca(data);
    const drafts = emptyDrafts();
    for (const w of data?.whys ?? []) {
      drafts[w.whyIndex] = { why: w.whyText, answer: w.answerText };
    }
    setWhyDrafts(drafts);
    setLoaded(true);
  }, [issueId]);

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

  async function handleSaveDraft() {
    if (!rca) return;
    setSaving(true);
    const calls = WHY_INDICES
      .filter((i) => whyDrafts[i].why.trim() && whyDrafts[i].answer.trim())
      .map((i) => saveRcaWhy(rca.id, i, whyDrafts[i].why.trim(), whyDrafts[i].answer.trim()));
    const results = await Promise.all(calls);
    setSaving(false);
    const error = results.find((r) => r.error)?.error;
    if (!error) {
      showToast('Draft saved');
      fetchRca();
    } else {
      showToast(error.message ?? 'Could not save draft');
    }
  }

  const allWhysFilled = WHY_INDICES.every((i) => whyDrafts[i].why.trim() && whyDrafts[i].answer.trim());

  async function handleSubmit() {
    if (!rca || !allWhysFilled) return;
    setSubmitting(true);
    const saveResults = await Promise.all(
      WHY_INDICES.map((i) => saveRcaWhy(rca.id, i, whyDrafts[i].why.trim(), whyDrafts[i].answer.trim()))
    );
    const saveError = saveResults.find((r) => r.error)?.error;
    if (saveError) {
      setSubmitting(false);
      showToast(saveError.message ?? 'Could not save your answers');
      return;
    }
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

  if (!loaded) return null;

  // ── Resolved: assign a (new) RCA, or show the last completed one ──────────
  if (status === 'resolved') {
    const hasAccepted = rca?.status === 'accepted';
    if (!canEdit && !hasAccepted) return null;

    return (
      <Card variant="elevated" style={styles.card}>
        <Text style={styles.panelLabel}>ROOT CAUSE ANALYSIS</Text>

        {hasAccepted && rca && (
          <View style={styles.completedBlock}>
            <Text style={styles.completedText}>
              Completed by {nameOf(rca.assignedTo)}
              {rca.acceptedAt ? ` · accepted ${new Date(rca.acceptedAt).toLocaleDateString()}` : ''}
            </Text>
            {rca.whys.map((w) => (
              <View key={w.whyIndex} style={styles.whyReadRow}>
                <Text style={styles.whyReadQuestion}>{w.whyIndex}. {w.whyText}</Text>
                <Text style={styles.whyReadAnswer}>{w.answerText}</Text>
              </View>
            ))}
          </View>
        )}

        {canEdit && !showAssignPicker && (
          <Button
            label={hasAccepted ? 'Assign New RCA' : 'Assign RCA'}
            variant="outline"
            icon="git-branch-outline"
            onPress={() => setShowAssignPicker(true)}
            fullWidth
          />
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
      </Card>
    );
  }

  // ── rca_pending: an RCA is currently in flight ─────────────────────────────
  if (status === 'rca_pending' && rca) {
    const isAssignee = currentUserId === rca.assignedTo;
    const canEditWhys = isAssignee || canEdit;

    return (
      <Card variant="elevated" style={styles.card}>
        <Text style={styles.panelLabel}>ROOT CAUSE ANALYSIS</Text>

        {rca.status === 'submitted' ? (
          <>
            <Text style={styles.hint}>
              {canEdit
                ? `Submitted by ${nameOf(rca.assignedTo)} — review the 5 Whys below.`
                : 'Submitted — waiting for review.'}
            </Text>
            {rca.whys.map((w) => (
              <View key={w.whyIndex} style={styles.whyReadRow}>
                <Text style={styles.whyReadQuestion}>{w.whyIndex}. {w.whyText}</Text>
                <Text style={styles.whyReadAnswer}>{w.answerText}</Text>
              </View>
            ))}
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
            <Text style={styles.hint}>Answer all five whys, then submit for review.</Text>
            {WHY_INDICES.map((i) => (
              <View key={i} style={styles.whyEditBlock}>
                <Text style={styles.whyLabel}>Why {i}</Text>
                <TextInput
                  style={styles.whyInput}
                  placeholder="What's the question?"
                  placeholderTextColor={Colors.textMuted}
                  value={whyDrafts[i].why}
                  onChangeText={(t) => setWhyDrafts((prev) => ({ ...prev, [i]: { ...prev[i], why: t } }))}
                />
                <TextInput
                  style={[styles.whyInput, styles.answerInput]}
                  placeholder="Answer"
                  placeholderTextColor={Colors.textMuted}
                  value={whyDrafts[i].answer}
                  onChangeText={(t) => setWhyDrafts((prev) => ({ ...prev, [i]: { ...prev[i], answer: t } }))}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            ))}
            <View style={styles.rowButtons}>
              <Button label="Save Draft" variant="outline" onPress={handleSaveDraft} loading={saving} style={styles.flex1} />
              <Button
                label="Submit"
                onPress={handleSubmit}
                loading={submitting}
                disabled={!allWhysFilled}
                style={styles.flex1}
              />
            </View>
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
      </Card>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm, marginTop: Spacing.sm },
  panelLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
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

  whyReadRow: {
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    padding: Spacing.sm,
    gap: 2,
  },
  whyReadQuestion: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  whyReadAnswer: { fontSize: Typography.sm, color: Colors.textSecondary },

  whyEditBlock: { gap: Spacing.xs },
  whyLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  whyInput: {
    minHeight: 44,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  answerInput: { minHeight: 64 },

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
