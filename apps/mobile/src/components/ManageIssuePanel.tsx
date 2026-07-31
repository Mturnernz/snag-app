import React, { useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';

import {
  SnagStatus, SnagKind, SnagSeverity, SnagLane,
  KIND_LABELS, SEVERITY_LABELS, INVESTIGATION_MODE_OPTIONS,
} from '../types';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import {
  updateSnagStatus, recategoriseSnag, assignSnagOwner, blockPublicReporter, resolveSnag,
  assignInvestigation, SiteAssignee, InvestigationMode,
} from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import Card from './Card';
import Button from './Button';
import Icon from './Icon';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';
import CategoryBadge from './CategoryBadge';
import ConfirmDialog from './ConfirmDialog';
import ResolvedCheckmark from './ResolvedCheckmark';
import OwnerPicker from './OwnerPicker';

type EditingField = 'severity' | 'kind' | 'assignee' | 'mode' | null;

interface PendingUpdates {
  kind?: SnagKind;
  severity?: SnagSeverity | null;
  owner_id?: string | null;
  mode?: InvestigationMode;
}

// Two genuinely different ways to run an investigation, so each option carries
// its consequence — picking the second changes what closes the snag. The copy
// is shared with the triage prompt (@snag/shared-types), which asks the same
// question at allocation time; this panel is the re-decide path.
const MODE_OPTIONS = INVESTIGATION_MODE_OPTIONS;

interface Props {
  issueId: string;
  status: SnagStatus;
  lane: SnagLane;
  kind: SnagKind;
  severity: SnagSeverity | null;
  owner: { id: string; name: string } | null;
  /** Site-scoped assignees for the owner picker (site members/supervisors + admins). */
  assignees: SiteAssignee[];
  /** Serious lane only: how this snag is being investigated. */
  investigationMode?: InvestigationMode;
  /** The investigation is under way and has work recorded under its current
   *  mode, so switching would strand it. Mirrors assign_investigation's guard —
   *  see investigationModeLocked in @snag/supabase-queries. */
  modeLocked?: boolean;
  /** Officer admins may still overturn a locked mode; the server audits it. */
  canOverrideMode?: boolean;
  /** Serious lane only: null = resolvable, otherwise the reason Resolve is
   *  blocked (e.g. "Checklist 2/5"). Ignored for niggles. */
  resolveBlockReason?: string | null;
  /** Public submissions expose a block-reporter action. */
  isPublicSubmission?: boolean;
  /** Called after a successful save/resolve so the parent can re-fetch the issue. */
  onUpdated: () => void;
}

export default function ManageIssuePanel({
  issueId, status, lane, kind, severity, owner, assignees, investigationMode = 'snag',
  modeLocked = false, canOverrideMode = false,
  resolveBlockReason = null, isPublicSubmission = false, onUpdated,
}: Props) {
  const { showToast } = useToast();

  const isSerious = lane === 'serious';
  const isOpen = status === 'flagged' || status === 'in_progress';
  /** Locked *and* this person can't overturn it — the case where the control
   *  should not be offered at all. */
  const modeFrozen = modeLocked && !canOverrideMode;

  const [editingField, setEditingField] = useState<EditingField>(null);
  const [saving, setSaving] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdates>({});
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blocking, setBlocking] = useState(false);

  // Resolve is a distinct action (not part of the staged status/kind/severity
  // edits): niggles go via resolve_snag (note required), serious via
  // update_snag_status('resolved') once the investigation gate is clear.
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const [resolving, setResolving] = useState(false);
  // Transient "nice, sorted" beat — niggle lane only, cleared after it plays.
  const [justResolved, setJustResolved] = useState(false);

  const resolveBlocked = isSerious && resolveBlockReason !== null;

  async function handleResolve() {
    if (!isSerious && !resolveNote.trim()) {
      showToast('Add a note describing what was done');
      return;
    }
    setResolving(true);
    const { error } = isSerious
      ? await updateSnagStatus(issueId, 'resolved', resolveNote.trim() || null)
      : await resolveSnag(issueId, resolveNote.trim());
    setResolving(false);
    if (!error) {
      setResolveModalOpen(false);
      setResolveNote('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (isSerious) {
        showToast('Resolved');
      } else {
        showToast('Nice, sorted!');
        setJustResolved(true);
        setTimeout(() => setJustResolved(false), 1200);
      }
      onUpdated();
    } else {
      showToast(error.message ?? 'Could not resolve snag');
    }
  }

  async function handleBlockReporter() {
    setConfirmBlock(false);
    setBlocking(true);
    const { error } = await blockPublicReporter(issueId);
    setBlocking(false);
    showToast(error ? (error.message ?? 'Could not block reporter') : 'Reporter blocked');
  }

  // Staged (displayed) values: pending edit wins over the current issue value.
  const shownKind = pendingUpdates.kind ?? kind;
  const shownSeverity = pendingUpdates.severity !== undefined ? pendingUpdates.severity : severity;
  // Reacts to a staged kind change, not just the current lane — so staging
  // fixit -> hazard immediately reveals the severity picker (required before
  // save) instead of only showing it for snags that were already serious.
  const shownIsSerious = shownKind === 'hazard' || shownKind === 'incident';
  const shownOwner = pendingUpdates.owner_id !== undefined
    ? (pendingUpdates.owner_id ? assignees.find((m) => m.id === pendingUpdates.owner_id) ?? null : null)
    : owner;
  const shownMode = pendingUpdates.mode ?? investigationMode;

  function stageUpdate(updates: PendingUpdates) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPendingUpdates((prev) => ({ ...prev, ...updates }));
    setEditingField(null);
  }

  function toggleField(field: EditingField) {
    setEditingField((prev) => (prev === field ? null : field));
  }

  async function handleSave() {
    if (saving || Object.keys(pendingUpdates).length === 0) return;
    setSaving(true);

    const calls: Promise<{ error: any }>[] = [];

    if (pendingUpdates.kind !== undefined || pendingUpdates.severity !== undefined) {
      calls.push(recategoriseSnag(
        issueId,
        pendingUpdates.kind ?? kind,
        pendingUpdates.severity !== undefined ? pendingUpdates.severity : severity
      ));
    }
    if (pendingUpdates.owner_id !== undefined) {
      calls.push(assignSnagOwner(issueId, pendingUpdates.owner_id));
    }

    const results = await Promise.all(calls);

    // Sequenced after the owner change rather than alongside it:
    // assign_investigation names the lead investigator, and on a snag being
    // allocated in the same save that person is whoever was just picked.
    const leadId = pendingUpdates.owner_id !== undefined ? pendingUpdates.owner_id : owner?.id ?? null;
    if (pendingUpdates.mode !== undefined) {
      if (!leadId) {
        setSaving(false);
        showToast("Pick an owner — they're the one running the investigation");
        return;
      }
      const { error: modeError } = await assignInvestigation(issueId, leadId, pendingUpdates.mode);
      if (modeError) results.push({ error: modeError });
    }

    const error = results.find((r) => r.error)?.error ?? null;
    setSaving(false);

    if (!error) {
      setPendingUpdates({});
      showToast('Snag updated');
      onUpdated();
    } else {
      showToast(error.message ?? 'Could not update snag');
    }
  }

  const hasPendingChanges = Object.keys(pendingUpdates).length > 0;

  return (
    <Card variant="elevated" style={styles.card}>
      <Text style={styles.panelLabel}>MANAGE ISSUE</Text>

      {/* Status — read-only here. It moves flagged -> in_progress on its own
          the moment any triage/investigation action is taken, and to
          resolved/rca_pending only via the actions below. */}
      <View style={styles.row}>
        <Text style={styles.label}>Status</Text>
        <View style={styles.currentChip}>
          <StatusBadge status={status} />
        </View>
      </View>

      {/* Type (kind) */}
      <View style={styles.row}>
        <Text style={styles.label}>Type</Text>
        <TouchableOpacity onPress={() => toggleField('kind')} style={styles.currentChip}>
          <CategoryBadge kind={shownKind} />
          <Icon name={editingField === 'kind' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
      {editingField === 'kind' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
          {(Object.keys(KIND_LABELS) as SnagKind[]).map((k) => (
            <TouchableOpacity
              key={k}
              onPress={() => stageUpdate({ kind: k })}
              style={[styles.optionChip, shownKind === k && styles.optionChipActive]}
            >
              <Text style={[styles.optionChipText, shownKind === k && styles.optionChipTextActive]}>
                {KIND_LABELS[k]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Severity — serious lane only. The server silently discards severity
          on niggles (recategorise_snag always nulls it unless kind is hazard/
          incident), so the editor is hidden here rather than offering an
          edit that looks like it saved but never persists. */}
      {shownIsSerious && (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Severity</Text>
            <TouchableOpacity onPress={() => toggleField('severity')} style={styles.currentChip}>
              {shownSeverity ? <PriorityBadge severity={shownSeverity} /> : <Text style={styles.currentText}>Not assessed</Text>}
              <Icon name={editingField === 'severity' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          {editingField === 'severity' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
              <TouchableOpacity
                onPress={() => stageUpdate({ severity: null })}
                style={[styles.optionChip, shownSeverity === null && styles.optionChipActive]}
              >
                <Text style={[styles.optionChipText, shownSeverity === null && styles.optionChipTextActive]}>
                  Not assessed
                </Text>
              </TouchableOpacity>
              {(Object.keys(SEVERITY_LABELS) as SnagSeverity[]).map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => stageUpdate({ severity: s })}
                  style={[styles.optionChip, shownSeverity === s && styles.optionChipActive]}
                >
                  <Text style={[styles.optionChipText, shownSeverity === s && styles.optionChipTextActive]}>
                    {SEVERITY_LABELS[s]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </>
      )}

      {/* Owner (assignee) */}
      <View style={styles.row}>
        <Text style={styles.label}>Owner</Text>
        <TouchableOpacity onPress={() => toggleField('assignee')} style={styles.currentChip}>
          <Text style={styles.currentText}>
            {shownOwner ? shownOwner.name : 'Unassigned'}
          </Text>
          <Icon name={editingField === 'assignee' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
      {editingField === 'assignee' && (
        <OwnerPicker
          assignees={assignees}
          currentOwnerId={shownOwner?.id ?? null}
          onSelect={(id) => stageUpdate({ owner_id: id })}
          searchable
        />
      )}

      {/* Investigation mode — asked here, while someone is already deciding who
          deals with this. Behind its own "Assign investigation" button it was a
          second decision in a second place, which is how a snag ends up with an
          owner and nobody running the investigation. */}
      {shownIsSerious && isOpen && (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Investigation</Text>
            {modeFrozen ? (
              // Not a disabled control: a chevron that does nothing is worse
              // than no chevron. The reason sits under it.
              <View style={styles.currentChip}>
                <Text style={styles.currentText}>
                  {shownMode === 'document' ? 'Our own process' : 'SNAG guided'}
                </Text>
                <Icon name="lock-closed-outline" size="sm" color={Colors.textMuted} />
              </View>
            ) : (
              <TouchableOpacity onPress={() => toggleField('mode')} style={styles.currentChip}>
                <Text style={styles.currentText}>
                  {shownMode === 'document' ? 'Our own process' : 'SNAG guided'}
                </Text>
                <Icon name={editingField === 'mode' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {modeFrozen && (
            <Text style={styles.modeWarning}>
              The investigation is under way and has work recorded against it. Changing how it
              runs now would strand that work.
            </Text>
          )}

          {/* An officer admin can still overturn it. Said plainly, because the
              cost lands on someone else's completed work. */}
          {modeLocked && canOverrideMode && (
            <Text style={styles.modeWarning}>
              This investigation is already under way. Changing it now leaves the work already
              recorded counting for nothing, and is recorded against your name.
            </Text>
          )}

          {!modeFrozen && editingField === 'mode' && (
            <View style={styles.modeList}>
              {MODE_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.modeOption, shownMode === option.value && styles.modeOptionActive]}
                  onPress={() => stageUpdate({ mode: option.value })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: shownMode === option.value }}
                >
                  <Icon
                    name={shownMode === option.value ? 'radio-button-on' : 'radio-button-off'}
                    size="sm"
                    color={shownMode === option.value ? Colors.primary : Colors.textMuted}
                  />
                  <View style={styles.modeOptionText}>
                    <Text style={styles.modeOptionTitle}>{option.title}</Text>
                    <Text style={styles.modeOptionDetail}>{option.detail}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {/* assign_investigation needs somebody to assign it to, so the mode
              can't be saved on an unassigned snag. Said here rather than
              surfaced later as a server error. */}
          {pendingUpdates.mode !== undefined && !shownOwner && (
            <Text style={styles.modeWarning}>
              Choose an owner too — they&apos;re the one running the investigation.
            </Text>
          )}
        </>
      )}

      {hasPendingChanges && (
        <Button
          label="Update Snag"
          onPress={handleSave}
          loading={saving}
          fullWidth
        />
      )}

      {/* Resolve — the single terminal action for both lanes. Disabled with a
          reason on serious snags until the investigation gate is satisfied. */}
      {isOpen && (
        <View style={styles.resolveSection}>
          <Button
            label="Resolve Snag"
            icon="checkmark-circle-outline"
            onPress={() => { setResolveNote(''); setResolveModalOpen(true); }}
            disabled={resolveBlocked}
            fullWidth
          />
          {resolveBlocked && (
            <Text style={styles.resolveBlockedText}>{resolveBlockReason}</Text>
          )}
        </View>
      )}

      {justResolved && <ResolvedCheckmark />}

      {isPublicSubmission && (
        <Button
          label="Block Reporter"
          variant="dangerOutline"
          icon="hand-left-outline"
          onPress={() => setConfirmBlock(true)}
          loading={blocking}
          fullWidth
        />
      )}

      <Modal visible={resolveModalOpen} transparent animationType="fade" onRequestClose={() => setResolveModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Resolve snag</Text>
            <Text style={styles.modalHint}>
              {isSerious
                ? 'Add an optional closing note for the record.'
                : 'Add a note describing what was done to fix this.'}
            </Text>
            <TextInput
              style={styles.noteInput}
              placeholder="What was done?"
              placeholderTextColor={Colors.textMuted}
              value={resolveNote}
              onChangeText={setResolveNote}
              multiline
              textAlignVertical="top"
            />
            <View style={styles.modalButtons}>
              <Button label="Cancel" variant="outline" onPress={() => setResolveModalOpen(false)} style={styles.modalButton} />
              <Button label="Resolve" onPress={handleResolve} loading={resolving} style={styles.modalButton} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmDialog
        visible={confirmBlock}
        title="Block this reporter?"
        message="They will no longer be able to submit public reports to your organisation. Their existing reports stay on record."
        confirmLabel="Block"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleBlockReporter}
        onCancel={() => setConfirmBlock(false)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm, marginTop: Spacing.sm },
  panelLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 40,
  },
  label: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.medium,
    width: 72,
  },
  currentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
    justifyContent: 'flex-end',
  },
  currentText: {
    fontSize: Typography.sm,
    color: Colors.textPrimary,
    fontWeight: Typography.medium,
  },
  optionRow: { gap: Spacing.sm, paddingVertical: Spacing.xs },
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
  optionChipTextActive: {
    color: Colors.primary,
  },
  optionChipText: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.medium,
  },

  // Full-width rows rather than chips: each option carries a sentence of
  // consequence, which a horizontal chip strip has nowhere to put.
  modeList: {
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  modeOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    padding: Spacing.md,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  modeOptionActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  modeOptionText: { flex: 1 },
  modeOptionTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  modeOptionDetail: {
    fontSize: Typography.xs,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: 2,
  },
  modeWarning: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginBottom: Spacing.sm,
  },

  resolveSection: {
    gap: Spacing.xs,
  },
  resolveBlockedText: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    textAlign: 'center',
  },

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
  modalTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  modalHint: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
  },
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
  modalButtons: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  modalButton: {
    flex: 1,
  },
});
