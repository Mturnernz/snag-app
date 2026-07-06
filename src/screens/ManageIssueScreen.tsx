import React, { useState, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';

import {
  Profile, RootStackParamList,
  SnagStatus, SnagKind, SnagSeverity,
  STATUS_LABELS, KIND_LABELS, SEVERITY_LABELS,
} from '../types';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { supabase, getOrgMembers, updateSnagStatus, recategoriseSnag, assignSnagOwner } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import StatusBadge from '../components/StatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import CategoryBadge from '../components/CategoryBadge';

type Route = RouteProp<RootStackParamList, 'ManageIssue'>;
type EditingField = 'status' | 'severity' | 'kind' | 'assignee' | null;

interface ManagedIssue {
  id: string;
  status: SnagStatus;
  kind: SnagKind;
  severity: SnagSeverity | null;
  owner_id: string | null;
  owner: { id: string; name: string } | null;
  org_id: string;
}

interface PendingUpdates {
  status?: SnagStatus;
  kind?: SnagKind;
  severity?: SnagSeverity | null;
  owner_id?: string | null;
}

export default function ManageIssueScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<Route>();
  const { issueId } = route.params;
  const { showToast } = useToast();

  const [issue, setIssue] = useState<ManagedIssue | null>(null);
  const [orgMembers, setOrgMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingField, setEditingField] = useState<EditingField>(null);
  const [saving, setSaving] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<PendingUpdates>({});

  useEffect(() => {
    load();
  }, [issueId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('snags_with_details')
      .select('id, status, kind, severity, owner_id, owner_name, org_id')
      .eq('id', issueId)
      .single();

    if (data) {
      setIssue({
        id: data.id,
        status: data.status,
        kind: data.kind,
        severity: data.severity,
        owner_id: data.owner_id,
        owner: data.owner_id ? { id: data.owner_id, name: data.owner_name } : null,
        org_id: data.org_id,
      });
      if (data.org_id) {
        getOrgMembers(data.org_id).then(setOrgMembers);
      }
    }
    setLoading(false);
  }

  function stageUpdate(updates: PendingUpdates) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIssue((prev) => prev ? {
      ...prev,
      ...updates,
      owner: updates.owner_id !== undefined
        ? (updates.owner_id ? orgMembers.find((m) => m.id === updates.owner_id) ?? prev.owner : null)
        : prev.owner,
    } : prev);
    setPendingUpdates((prev) => ({ ...prev, ...updates }));
    setEditingField(null);
  }

  async function handleSave() {
    if (!issue || saving || Object.keys(pendingUpdates).length === 0) return;
    setSaving(true);

    const calls: Promise<{ error: any }>[] = [];

    if (pendingUpdates.status !== undefined) {
      calls.push(updateSnagStatus(issue.id, pendingUpdates.status));
    }
    if (pendingUpdates.kind !== undefined || pendingUpdates.severity !== undefined) {
      calls.push(recategoriseSnag(
        issue.id,
        pendingUpdates.kind ?? issue.kind,
        pendingUpdates.severity !== undefined ? pendingUpdates.severity : issue.severity
      ));
    }
    if (pendingUpdates.owner_id !== undefined) {
      calls.push(assignSnagOwner(issue.id, pendingUpdates.owner_id));
    }

    const results = await Promise.all(calls);
    const error = results.find((r) => r.error)?.error ?? null;
    setSaving(false);

    if (!error) {
      showToast('Snag updated');
      navigation.goBack();
    }
  }

  function toggleField(field: EditingField) {
    setEditingField((prev) => (prev === field ? null : field));
  }

  if (loading || !issue) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const hasPendingChanges = Object.keys(pendingUpdates).length > 0;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Manage Issue" />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <Card variant="elevated" style={styles.card}>
          {/* Status */}
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <TouchableOpacity onPress={() => toggleField('status')} style={styles.currentChip}>
              <StatusBadge status={issue.status} />
              <Icon name={editingField === 'status' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          {editingField === 'status' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
              {(Object.keys(STATUS_LABELS) as SnagStatus[]).map((s) => (
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

          {/* Type (kind) */}
          <View style={styles.row}>
            <Text style={styles.label}>Type</Text>
            <TouchableOpacity onPress={() => toggleField('kind')} style={styles.currentChip}>
              <CategoryBadge kind={issue.kind} />
              <Icon name={editingField === 'kind' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          {editingField === 'kind' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
              {(Object.keys(KIND_LABELS) as SnagKind[]).map((k) => (
                <TouchableOpacity
                  key={k}
                  onPress={() => stageUpdate({ kind: k })}
                  style={[styles.optionChip, issue.kind === k && styles.optionChipActive]}
                >
                  <Text style={[styles.optionChipText, issue.kind === k && styles.optionChipTextActive]}>
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
              {issue.severity ? <PriorityBadge severity={issue.severity} /> : <Text style={styles.currentText}>Not assessed</Text>}
              <Icon name={editingField === 'severity' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          {editingField === 'severity' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
              <TouchableOpacity
                onPress={() => stageUpdate({ severity: null })}
                style={[styles.optionChip, issue.severity === null && styles.optionChipActive]}
              >
                <Text style={[styles.optionChipText, issue.severity === null && styles.optionChipTextActive]}>
                  Not assessed
                </Text>
              </TouchableOpacity>
              {(Object.keys(SEVERITY_LABELS) as SnagSeverity[]).map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => stageUpdate({ severity: s })}
                  style={[styles.optionChip, issue.severity === s && styles.optionChipActive]}
                >
                  <Text style={[styles.optionChipText, issue.severity === s && styles.optionChipTextActive]}>
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
                {issue.owner ? issue.owner.name : 'Unassigned'}
              </Text>
              <Icon name={editingField === 'assignee' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          {editingField === 'assignee' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
              <TouchableOpacity
                onPress={() => stageUpdate({ owner_id: null })}
                style={[styles.optionChip, issue.owner_id === null && styles.optionChipActive]}
              >
                <Text style={[styles.optionChipText, issue.owner_id === null && styles.optionChipTextActive]}>
                  Unassigned
                </Text>
              </TouchableOpacity>
              {orgMembers.map((member) => (
                <TouchableOpacity
                  key={member.id}
                  onPress={() => stageUpdate({ owner_id: member.id })}
                  style={[styles.optionChip, issue.owner_id === member.id && styles.optionChipActive]}
                >
                  <Text style={[styles.optionChipText, issue.owner_id === member.id && styles.optionChipTextActive]}>
                    {member.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </Card>

        <Button
          label="Update Snag"
          onPress={handleSave}
          loading={saving}
          disabled={!hasPendingChanges}
          fullWidth
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.lg },
  card: { gap: Spacing.sm },
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
  optionChipText: {
    fontSize: Typography.sm,
    color: Colors.textSecondary,
    fontWeight: Typography.medium,
  },
  optionChipTextActive: {
    color: Colors.primary,
  },
});
