import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

import { ChecklistStep, CHECKLIST_STEPS, CHECKLIST_STEP_LABELS, EvidenceItem } from '../types';
import {
  InvestigationState,
  completeChecklistStep,
  addWitnessStatement,
  addEvidenceItem,
  setRootCause,
  getEvidencePhotoUrl,
} from '../lib/supabase';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useToast } from '../hooks/useToast';
import Button from './Button';
import Icon from './Icon';
import PhotoPicker, { PhotoPickerHandle } from './PhotoPicker';

interface Props {
  issueId: string;
  /** Org id of the snag — the evidence bucket is org-folder scoped. */
  orgId: string;
  state: InvestigationState;
  /** Called after any change so the parent re-fetches investigation state + issue. */
  onChanged: () => void;
}

// Minimal serious-lane investigation surface: enough to clear the resolve gate
// (checklist + witness + evidence + root cause) without leaving the app. The
// delegated RCA (5 Whys), corrective actions, and debriefs are separate
// panels on IssueDetailScreen (RcaPanel, CorrectiveActionsPanel, DebriefPanel).
export default function InvestigationPanel({ issueId, orgId, state, onChanged }: Props) {
  const { showToast } = useToast();

  const [busyStep, setBusyStep] = useState<ChecklistStep | null>(null);

  const [witnessName, setWitnessName] = useState('');
  const [witnessText, setWitnessText] = useState('');
  const [addingWitness, setAddingWitness] = useState(false);

  const evidencePickerRef = useRef<PhotoPickerHandle>(null);
  const [evidenceCaption, setEvidenceCaption] = useState('');
  const [evidenceBlocked, setEvidenceBlocked] = useState(false);
  const [addingEvidence, setAddingEvidence] = useState(false);

  const [rootCause, setRootCauseText] = useState(state.rootCause ?? '');
  const [savingRootCause, setSavingRootCause] = useState(false);

  // Keep the root-cause field in sync if the parent refetches with a new value
  // (e.g. after another device recorded one).
  useEffect(() => { setRootCauseText(state.rootCause ?? ''); }, [state.rootCause]);

  const checklistDone = state.completedSteps.length;

  async function handleStep(step: ChecklistStep) {
    if (state.completedSteps.includes(step) || busyStep) return;
    setBusyStep(step);
    const { error } = await completeChecklistStep(issueId, step);
    setBusyStep(null);
    if (error) showToast(error.message ?? 'Could not update checklist');
    else onChanged();
  }

  async function handleAddWitness() {
    if (!witnessName.trim() || !witnessText.trim()) {
      showToast('Add the witness name and their statement');
      return;
    }
    setAddingWitness(true);
    const { error } = await addWitnessStatement(issueId, witnessName.trim(), witnessText.trim());
    setAddingWitness(false);
    if (error) {
      showToast(error.message ?? 'Could not add witness statement');
    } else {
      setWitnessName('');
      setWitnessText('');
      onChanged();
    }
  }

  async function handleAddEvidence() {
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
    // add_evidence_item takes a single media_path; use the first photo (empty
    // string when it's a caption-only note).
    const { error } = await addEvidenceItem(issueId, paths[0] ?? '', evidenceCaption.trim() || null);
    setAddingEvidence(false);
    if (error) {
      showToast(error.message ?? 'Could not add evidence');
    } else {
      setEvidenceCaption('');
      evidencePickerRef.current?.reset();
      onChanged();
    }
  }

  async function handleSaveRootCause() {
    if (!rootCause.trim()) {
      showToast('Enter the root cause');
      return;
    }
    setSavingRootCause(true);
    const { error } = await setRootCause(issueId, rootCause.trim());
    setSavingRootCause(false);
    if (error) showToast(error.message ?? 'Could not save root cause');
    else { showToast('Root cause recorded'); onChanged(); }
  }

  const hasRootCause = Boolean(state.rootCause && state.rootCause.trim());

  return (
    <>
      {/* Progress against the five resolve conditions */}
      <View style={styles.progressRow}>
        <ProgressPill label="Checklist" value={`${checklistDone}/5`} done={checklistDone >= 5} />
        <ProgressPill label="Witnesses" value={`${state.witnesses.length}`} done={state.witnesses.length >= 1} />
        <ProgressPill label="Evidence" value={`${state.evidence.length}`} done={state.evidence.length >= 1} />
        <ProgressPill label="Root cause" value={hasRootCause ? 'Yes' : 'No'} done={hasRootCause} />
        {state.openCorrectiveActions > 0 && (
          <ProgressPill label="Open actions" value={`${state.openCorrectiveActions}`} done={false} />
        )}
      </View>

      {/* First-response checklist */}
      <Text style={styles.sectionTitle}>First-response checklist</Text>
      {CHECKLIST_STEPS.map((step) => {
        const done = state.completedSteps.includes(step);
        return (
          <TouchableOpacity
            key={step}
            style={styles.checkRow}
            onPress={() => handleStep(step)}
            disabled={done || busyStep !== null}
            activeOpacity={0.7}
          >
            <Icon
              name={done ? 'checkmark-circle' : 'ellipse-outline'}
              size="md"
              color={done ? Colors.success : Colors.textMuted}
            />
            <Text style={[styles.checkLabel, done && styles.checkLabelDone]}>
              {CHECKLIST_STEP_LABELS[step]}
            </Text>
          </TouchableOpacity>
        );
      })}

      {/* Witnesses */}
      <Text style={styles.sectionTitle}>Witness statements</Text>
      {state.witnesses.map((w) => (
        <View key={w.id} style={styles.listItem}>
          <Text style={styles.listItemTitle}>{w.witness_name}</Text>
          <Text style={styles.listItemBody}>{w.statement_text}</Text>
        </View>
      ))}
      <TextInput
        style={styles.input}
        placeholder="Witness name"
        placeholderTextColor={Colors.textMuted}
        value={witnessName}
        onChangeText={setWitnessName}
      />
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        placeholder="What did they see?"
        placeholderTextColor={Colors.textMuted}
        value={witnessText}
        onChangeText={setWitnessText}
        multiline
        textAlignVertical="top"
      />
      <Button label="Add witness statement" variant="outline" onPress={handleAddWitness} loading={addingWitness} fullWidth />

      {/* Evidence */}
      <Text style={styles.sectionTitle}>Evidence</Text>
      {state.evidence.map((e) => (
        <EvidenceRow key={e.id} item={e} />
      ))}
      <TextInput
        style={styles.input}
        placeholder="Caption (optional)"
        placeholderTextColor={Colors.textMuted}
        value={evidenceCaption}
        onChangeText={setEvidenceCaption}
      />
      <PhotoPicker
        ref={evidencePickerRef}
        pathPrefix={orgId}
        bucket="snag-evidence"
        onBlockingChange={setEvidenceBlocked}
      />
      <Button
        label="Add evidence"
        variant="outline"
        onPress={handleAddEvidence}
        loading={addingEvidence}
        disabled={evidenceBlocked}
        fullWidth
      />

      {/* Root cause */}
      <Text style={styles.sectionTitle}>Root cause</Text>
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        placeholder="What was the underlying cause?"
        placeholderTextColor={Colors.textMuted}
        value={rootCause}
        onChangeText={setRootCauseText}
        multiline
        textAlignVertical="top"
      />
      <Button label="Save root cause" variant="outline" onPress={handleSaveRootCause} loading={savingRootCause} fullWidth />
    </>
  );
}

function ProgressPill({ label, value, done }: { label: string; value: string; done: boolean }) {
  return (
    <View style={[styles.pill, done ? styles.pillDone : styles.pillPending]}>
      <Text style={[styles.pillText, done ? styles.pillTextDone : styles.pillTextPending]}>
        {label} {value}
      </Text>
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
        <Image source={{ uri: url }} style={styles.evidenceThumb} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.evidenceThumb, styles.evidenceThumbEmpty]}>
          <Icon name="document-text-outline" size="md" color={Colors.textMuted} />
        </View>
      )}
      <Text style={styles.evidenceCaption} numberOfLines={2}>
        {item.caption || 'Evidence'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  pillDone: { backgroundColor: Colors.successBg },
  pillPending: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  pillText: { fontSize: Typography.xs, fontWeight: Typography.semibold },
  pillTextDone: { color: Colors.success },
  pillTextPending: { color: Colors.textSecondary },

  sectionTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    marginTop: Spacing.sm,
  },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET - 8,
  },
  checkLabel: { fontSize: Typography.base, color: Colors.textPrimary },
  checkLabelDone: { color: Colors.textMuted, textDecorationLine: 'line-through' },

  listItem: {
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    padding: Spacing.sm,
    gap: 2,
  },
  listItemTitle: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.textPrimary },
  listItemBody: { fontSize: Typography.sm, color: Colors.textSecondary },

  input: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.background,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  inputMultiline: { minHeight: 72 },

  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    padding: Spacing.xs,
  },
  evidenceThumb: { width: 44, height: 44, borderRadius: Radius.button },
  evidenceThumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface },
  evidenceCaption: { flex: 1, fontSize: Typography.sm, color: Colors.textSecondary },
});
