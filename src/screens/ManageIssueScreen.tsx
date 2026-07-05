import React, { useState, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';

import {
  Profile, RootStackParamList,
  IssueStatus, IssuePriority, IssueCategory,
  STATUS_LABELS, PRIORITY_LABELS, CATEGORY_LABELS,
} from '../types';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import { supabase, getOrgMembers, updateIssue } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import StatusBadge from '../components/StatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import CategoryBadge from '../components/CategoryBadge';

type Route = RouteProp<RootStackParamList, 'ManageIssue'>;
type EditingField = 'status' | 'priority' | 'category' | 'assignee' | null;

interface ManagedIssue {
  id: string;
  status: IssueStatus;
  priority: IssuePriority;
  category: IssueCategory;
  assignee_id: string | null;
  assignee: { id: string; name: string } | null;
  organisation_id: string;
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
  const [pendingUpdates, setPendingUpdates] = useState<Parameters<typeof updateIssue>[1]>({});

  useEffect(() => {
    load();
  }, [issueId]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('issues_with_details')
      .select('id, status, priority, category, assignee_id, assignee_name, organisation_id')
      .eq('id', issueId)
      .single();

    if (data) {
      setIssue({
        id: data.id,
        status: data.status,
        priority: data.priority,
        category: data.category,
        assignee_id: data.assignee_id,
        assignee: data.assignee_id ? { id: data.assignee_id, name: data.assignee_name } : null,
        organisation_id: data.organisation_id,
      });
      if (data.organisation_id) {
        getOrgMembers(data.organisation_id).then(setOrgMembers);
      }
    }
    setLoading(false);
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
          <View style={styles.row}>
            <Text style={styles.label}>Priority</Text>
            <TouchableOpacity onPress={() => toggleField('priority')} style={styles.currentChip}>
              <PriorityBadge priority={issue.priority} />
              <Icon name={editingField === 'priority' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          {editingField === 'priority' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
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
          <View style={styles.row}>
            <Text style={styles.label}>Category</Text>
            <TouchableOpacity onPress={() => toggleField('category')} style={styles.currentChip}>
              <CategoryBadge category={issue.category} />
              <Icon name={editingField === 'category' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          {editingField === 'category' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
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
          <View style={styles.row}>
            <Text style={styles.label}>Assignee</Text>
            <TouchableOpacity onPress={() => toggleField('assignee')} style={styles.currentChip}>
              <Text style={styles.currentText}>
                {issue.assignee ? issue.assignee.name : 'Unassigned'}
              </Text>
              <Icon name={editingField === 'assignee' ? 'chevron-up' : 'chevron-down'} size="sm" color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
          {editingField === 'assignee' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
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
