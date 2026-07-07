import React, { useState } from 'react';
import * as Haptics from 'expo-haptics';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

import {
  Profile, SnagStatus, SnagKind, SnagSeverity,
  STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS,
} from '../types';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { updateSnagStatus, recategoriseSnag, assignSnagOwner } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import Card from './Card';
import Button from './Button';
import Icon from './Icon';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';
import CategoryBadge from './CategoryBadge';

type EditingField = 'status' | 'severity' | 'kind' | 'assignee' | null;

interface PendingUpdates {
  status?: SnagStatus;
  kind?: SnagKind;
  severity?: SnagSeverity | null;
  owner_id?: string | null;
}

interface Props {
  issueId: string;
  status: SnagStatus;
  kind: SnagKind;
  severity: SnagSeverity | null;
  owner: { id: string; name: string } | null;
  orgMembers: Profile[];
  /** Called after a successful save so the parent can re-fetch the issue. */
  onUpdated: () => void;
}

export default function ManageIssuePanel({
  issueId, status, kind, severity, owner, orgMembers, onUpdated,
}: Props) {
  const { showToast } = useToast();

  const [editingField, setEditingField] = useState<EditingField>(null);
  const [saving, setSaving] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdates>({});

  // Staged (displayed) values: pending edit wins over the current issue value.
  const shownStatus = pendingUpdates.status ?? status;
  const shownKind = pendingUpdates.kind ?? kind;
  const shownSeverity = pendingUpdates.severity !== undefined ? pendingUpdates.severity : severity;
  const shownOwner = pendingUpdates.owner_id !== undefined
    ? (pendingUpdates.owner_id ? orgMembers.find((m) => m.id === pendingUpdates.owner_id) ?? null : null)
    : owner;

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

    if (pendingUpdates.status !== undefined) {
      calls.push(updateSnagStatus(issueId, pendingUpdates.status));
    }
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

      {/* Status */}
      <View style={styles.row}>
        <Text style={styles.label}>Status</Text>
        <TouchableOpacity onPress={() => toggleField('status')} style={styles.currentChip}>
          <StatusBadge status={shownStatus} />
          <Icon name={editingField === 'status' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
      {editingField === 'status' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
          {(Object.keys(STATUS_LABELS) as SnagStatus[]).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => stageUpdate({ status: s })}
              style={[styles.optionChip, shownStatus === s && styles.optionChipActive]}
            >
              <Text style={[styles.optionChipText, shownStatus === s && styles.optionChipTextActive]}>
                {STATUS_LABELS[s]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

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

      {/* Severity */}
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
          <TouchableOpacity
            onPress={() => stageUpdate({ owner_id: null })}
            style={[styles.optionChip, !shownOwner && styles.optionChipActive]}
          >
            <Text style={[styles.optionChipText, !shownOwner && styles.optionChipTextActive]}>
              Unassigned
            </Text>
          </TouchableOpacity>
          {orgMembers.map((member) => (
            <TouchableOpacity
              key={member.id}
              onPress={() => stageUpdate({ owner_id: member.id })}
              style={[styles.optionChip, shownOwner?.id === member.id && styles.optionChipActive]}
            >
              <Text style={[styles.optionChipText, shownOwner?.id === member.id && styles.optionChipTextActive]}>
                {member.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {hasPendingChanges && (
        <Button
          label="Update Snag"
          onPress={handleSave}
          loading={saving}
          fullWidth
        />
      )}
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
});
