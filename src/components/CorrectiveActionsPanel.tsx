import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

import { CorrectiveAction, EvidenceItem, ROLE_LABELS } from '../types';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import {
  getCorrectiveActions, createCorrectiveAction, completeCorrectiveAction, verifyCorrectiveAction,
  addCorrectiveActionEvidence, getCorrectiveActionEvidence, getEvidencePhotoUrl, SiteAssignee,
} from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import Button from './Button';
import Icon from './Icon';
import PhotoPicker, { PhotoPickerHandle } from './PhotoPicker';
import { StepStatus } from './StepCard';

interface Props {
  issueId: string;
  /** Org id of the snag — evidence uploads reuse the org-folder-scoped
   *  snag-evidence bucket, same as InvestigationPanel. */
  orgId: string;
  /** Supervisor/admin of this site — can create actions and verify them
   *  (verification excludes the action's own owner; see
   *  verify_corrective_action). */
  canEdit: boolean;
  currentUserId: string | null;
  assignees: SiteAssignee[];
  /** Called after any change so the parent can refetch investigation state
   *  (the resolve gate reads the same "done and verified" definition). */
  onChanged: () => void;
  /** Reports a coarse status/summary up whenever actions are (re)fetched —
   *  this panel self-fetches independently of the parent's investigation
   *  state (which is editor-only), so every org member gets an accurate
   *  StepCard summary, not just editors. Same idea as RcaPanel's. */
  onStatusChange?: (status: StepStatus, summary: string) => void;
}

// YYYY-MM-DD only — no native date-picker dependency in this project yet;
// a plain validated text field is the smallest reliable option today and
// upgrading to a native picker later doesn't touch the data model.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isOverdue(action: CorrectiveAction): boolean {
  return action.status === 'open' && action.due_date < new Date().toISOString().slice(0, 10);
}

export default function CorrectiveActionsPanel({ issueId, orgId, canEdit, currentUserId, assignees, onChanged, onStatusChange }: Props) {
  const { showToast } = useToast();

  const [actions, setActions] = useState<CorrectiveAction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [evidenceByAction, setEvidenceByAction] = useState<Record<string, EvidenceItem[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [description, setDescription] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);

  const evidencePickerRef = useRef<PhotoPickerHandle>(null);
  const [evidenceCaption, setEvidenceCaption] = useState('');
  const [evidenceBlocked, setEvidenceBlocked] = useState(false);
  const [addingEvidence, setAddingEvidence] = useState(false);

  const fetchActions = useCallback(async () => {
    const data = await getCorrectiveActions(issueId);
    setActions(data);
    setLoaded(true);

    const openCount = data.filter((a) => !(a.status === 'done' && a.verified_by)).length;
    if (data.length === 0) onStatusChange?.('pending', 'None yet');
    else if (openCount > 0) onStatusChange?.('in_progress', `${openCount} open`);
    else onStatusChange?.('done', 'All verified');
    // onStatusChange deliberately excluded — see RcaPanel for the same note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

  useEffect(() => { fetchActions(); }, [fetchActions]);

  async function toggleExpand(action: CorrectiveAction) {
    if (expandedId === action.id) { setExpandedId(null); return; }
    setExpandedId(action.id);
    if (!evidenceByAction[action.id]) {
      const items = await getCorrectiveActionEvidence(action.id);
      setEvidenceByAction((prev) => ({ ...prev, [action.id]: items }));
    }
  }

  async function handleCreate() {
    if (!description.trim() || !ownerId || !DATE_RE.test(dueDate)) {
      showToast('Add a description, an owner, and a due date (YYYY-MM-DD)');
      return;
    }
    setCreating(true);
    const { error } = await createCorrectiveAction(issueId, description.trim(), ownerId, dueDate);
    setCreating(false);
    if (error) {
      showToast(error.message ?? 'Could not create corrective action');
      return;
    }
    setShowCreateForm(false);
    setDescription('');
    setOwnerId(null);
    setDueDate('');
    showToast('Corrective action added');
    fetchActions();
    onChanged();
  }

  async function handleComplete(actionId: string) {
    setBusyId(actionId);
    const { error } = await completeCorrectiveAction(actionId);
    setBusyId(null);
    if (error) { showToast(error.message ?? 'Could not mark this done'); return; }
    showToast('Marked done — awaiting verification');
    fetchActions();
    onChanged();
  }

  async function handleVerify(actionId: string) {
    setBusyId(actionId);
    const { error } = await verifyCorrectiveAction(actionId);
    setBusyId(null);
    if (error) { showToast(error.message ?? 'Could not verify this action'); return; }
    showToast('Verified');
    fetchActions();
    onChanged();
  }

  async function handleAddEvidence(actionId: string) {
    if (evidenceBlocked) {
      showToast('A photo is still uploading or failed to upload — retry or remove it first');
      return;
    }
    const paths = (await evidencePickerRef.current?.getPhotoUrls()) ?? [];
    if (paths.length === 0 && !evidenceCaption.trim()) {
      showToast('Add a photo or a caption for the evidence');
      return;
    }
    setAddingEvidence(true);
    const { error } = await addCorrectiveActionEvidence(actionId, paths[0] ?? '', evidenceCaption.trim() || null);
    setAddingEvidence(false);
    if (error) {
      showToast(error.message ?? 'Could not add evidence');
      return;
    }
    setEvidenceCaption('');
    evidencePickerRef.current?.reset();
    const items = await getCorrectiveActionEvidence(actionId);
    setEvidenceByAction((prev) => ({ ...prev, [actionId]: items }));
  }

  if (!loaded) return null;

  return (
    <>
      {actions.length === 0 && !showCreateForm && (
        <Text style={styles.hint}>No corrective actions yet.</Text>
      )}

      {actions.map((action) => {
        const expanded = expandedId === action.id;
        const overdue = isOverdue(action);
        const verified = Boolean(action.verified_by);
        const canVerify = canEdit && action.status === 'done' && !verified && currentUserId !== action.owner_id;
        const canComplete = action.status === 'open' && (canEdit || currentUserId === action.owner_id);
        const canAddEvidence = canEdit || currentUserId === action.owner_id;

        return (
          <View key={action.id} style={styles.actionBlock}>
            <TouchableOpacity style={styles.actionRow} onPress={() => toggleExpand(action)} activeOpacity={0.7}>
              <View style={styles.actionMain}>
                <Text style={styles.actionDescription} numberOfLines={expanded ? undefined : 2}>
                  {action.description}
                </Text>
                <Text style={styles.actionMeta}>
                  {action.owner_name ?? 'Unassigned'} · due {action.due_date}
                  {overdue ? ' · overdue' : ''}
                </Text>
              </View>
              <StatusPill verified={verified} status={action.status} overdue={overdue} />
            </TouchableOpacity>

            {expanded && (
              <View style={styles.expandedBlock}>
                {verified && action.verifier_name && (
                  <Text style={styles.hint}>
                    Verified by {action.verifier_name}
                    {action.verified_at ? ` · ${new Date(action.verified_at).toLocaleDateString()}` : ''}
                  </Text>
                )}

                {(evidenceByAction[action.id] ?? []).map((e) => (
                  <EvidenceRow key={e.id} item={e} />
                ))}

                {canAddEvidence && (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder="Evidence caption (optional)"
                      placeholderTextColor={Colors.textMuted}
                      value={evidenceCaption}
                      onChangeText={setEvidenceCaption}
                    />
                    <PhotoPicker ref={evidencePickerRef} pathPrefix={orgId} bucket="snag-evidence" onBlockingChange={setEvidenceBlocked} />
                    <Button
                      label="Add evidence"
                      variant="outline"
                      onPress={() => handleAddEvidence(action.id)}
                      loading={addingEvidence}
                      disabled={evidenceBlocked}
                      fullWidth
                    />
                  </>
                )}

                {canComplete && (
                  <Button label="Mark Done" onPress={() => handleComplete(action.id)} loading={busyId === action.id} fullWidth />
                )}
                {canVerify && (
                  <Button label="Verify" onPress={() => handleVerify(action.id)} loading={busyId === action.id} fullWidth />
                )}
                {action.status === 'done' && !verified && currentUserId === action.owner_id && (
                  <Text style={styles.hint}>Marked done — waiting on a supervisor to verify.</Text>
                )}
              </View>
            )}
          </View>
        );
      })}

      {canEdit && !showCreateForm && (
        <Button label="New Corrective Action" variant="outline" icon="add-circle-outline" onPress={() => setShowCreateForm(true)} fullWidth />
      )}

      {canEdit && showCreateForm && (
        <View style={styles.createForm}>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="What needs to happen?"
            placeholderTextColor={Colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            textAlignVertical="top"
          />
          <Text style={styles.sectionTitle}>Owner</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
            {assignees.map((a) => (
              <TouchableOpacity
                key={a.id}
                onPress={() => setOwnerId(a.id)}
                style={[styles.optionChip, ownerId === a.id && styles.optionChipActive]}
              >
                <Text style={[styles.optionChipText, ownerId === a.id && styles.optionChipTextActive]}>
                  {a.name} · {ROLE_LABELS[a.role]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TextInput
            style={styles.input}
            placeholder="Due date (YYYY-MM-DD)"
            placeholderTextColor={Colors.textMuted}
            value={dueDate}
            onChangeText={setDueDate}
            keyboardType="numbers-and-punctuation"
          />
          <View style={styles.rowButtons}>
            <Button
              label="Cancel"
              variant="outline"
              onPress={() => { setShowCreateForm(false); setDescription(''); setOwnerId(null); setDueDate(''); }}
              style={styles.flex1}
            />
            <Button label="Create" onPress={handleCreate} loading={creating} style={styles.flex1} />
          </View>
        </View>
      )}
    </>
  );
}

function StatusPill({ verified, status, overdue }: { verified: boolean; status: string; overdue: boolean }) {
  const label = verified ? 'Verified' : status === 'done' ? 'Done' : overdue ? 'Overdue' : 'Open';
  const tone = verified ? 'done' : status === 'done' ? 'pending' : overdue ? 'overdue' : 'open';
  return (
    <View style={[styles.pill, styles[`pill_${tone}` as const]]}>
      <Text style={[styles.pillText, styles[`pillText_${tone}` as const]]}>{label}</Text>
    </View>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (item.media_path) getEvidencePhotoUrl(item.media_path).then(setUrl);
  }, [item.media_path]);
  return (
    <View style={styles.evidenceRow}>
      {url ? (
        <Icon name="image-outline" size="sm" color={Colors.textSecondary} />
      ) : (
        <Icon name="document-text-outline" size="sm" color={Colors.textMuted} />
      )}
      <Text style={styles.evidenceCaption} numberOfLines={1}>{item.caption || 'Evidence'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },
  sectionTitle: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary, marginTop: Spacing.sm },

  actionBlock: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm, marginTop: Spacing.xs },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  actionMain: { flex: 1, gap: 2 },
  actionDescription: { fontSize: Typography.base, color: Colors.textPrimary, fontWeight: Typography.medium },
  actionMeta: { fontSize: Typography.xs, color: Colors.textMuted },

  expandedBlock: { gap: Spacing.sm, marginTop: Spacing.sm },

  pill: { borderRadius: Radius.chip, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  pill_open: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  pill_overdue: { backgroundColor: Colors.priority.highBg },
  pill_pending: { backgroundColor: Colors.status.inProgressBg },
  pill_done: { backgroundColor: Colors.successBg },
  pillText: { fontSize: Typography.xs, fontWeight: Typography.semibold },
  pillText_open: { color: Colors.textSecondary },
  pillText_overdue: { color: Colors.danger },
  pillText_pending: { color: Colors.status.inProgress },
  pillText_done: { color: Colors.success },

  evidenceRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.background, borderRadius: Radius.button, padding: Spacing.xs,
  },
  evidenceCaption: { flex: 1, fontSize: Typography.sm, color: Colors.textSecondary },

  input: {
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
  inputMultiline: { minHeight: 64 },

  optionRow: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  optionChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.chip,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  optionChipActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  optionChipText: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
  optionChipTextActive: { color: Colors.primary },

  createForm: { gap: Spacing.sm, marginTop: Spacing.sm },
  rowButtons: { flexDirection: 'row', gap: Spacing.sm },
  flex1: { flex: 1 },
});
