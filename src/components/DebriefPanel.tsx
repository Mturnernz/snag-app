import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

import { Profile } from '../types';
import { Colors, Radius, Spacing, Typography } from '../constants/theme';
import {
  getSnagDebriefs, startDebrief, addDebriefFinding, addDebriefAttendee, addDebriefLesson,
  completeDebrief, SnagDebrief,
} from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import Card from './Card';
import Button from './Button';

interface Props {
  issueId: string;
  /** Supervisor/admin — same gate as RcaPanel/InvestigationPanel. */
  canEdit: boolean;
  /** For resolving attendee/author names and offering an attendee picker —
   *  reuses the same org members list already fetched for the comment
   *  @mention composer, no new query needed. */
  orgMembers: Profile[];
  onChanged: () => void;
}

export default function DebriefPanel({ issueId, canEdit, orgMembers, onChanged }: Props) {
  const { showToast } = useToast();
  const [debriefs, setDebriefs] = useState<SnagDebrief[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [starting, setStarting] = useState<'hot' | 'formal' | null>(null);

  // Per-in-progress-debrief input state, keyed by debrief id so several
  // debriefs' forms don't collide (any number of debriefs are allowed).
  const [findingDraft, setFindingDraft] = useState<Record<string, string>>({});
  const [lessonDraft, setLessonDraft] = useState<Record<string, string>>({});
  const [busyDebriefId, setBusyDebriefId] = useState<string | null>(null);
  const [attendeePickerFor, setAttendeePickerFor] = useState<string | null>(null);

  const fetchDebriefs = useCallback(async () => {
    setDebriefs(await getSnagDebriefs(issueId));
    setLoaded(true);
  }, [issueId]);

  useEffect(() => { fetchDebriefs(); }, [fetchDebriefs]);

  function nameOf(profileId: string): string {
    return orgMembers.find((m) => m.id === profileId)?.name ?? 'Unknown';
  }

  async function handleStart(format: 'hot' | 'formal') {
    setStarting(format);
    const { error } = await startDebrief(issueId, format);
    setStarting(null);
    if (error) showToast(error.message ?? 'Could not start the debrief');
    else { showToast(`${format === 'hot' ? 'Hot' : 'Formal'} debrief started`); fetchDebriefs(); onChanged(); }
  }

  async function handleAddFinding(debriefId: string) {
    const text = (findingDraft[debriefId] ?? '').trim();
    if (!text) return;
    setBusyDebriefId(debriefId);
    const { error } = await addDebriefFinding(debriefId, text);
    setBusyDebriefId(null);
    if (error) showToast(error.message ?? 'Could not add finding');
    else { setFindingDraft((prev) => ({ ...prev, [debriefId]: '' })); fetchDebriefs(); }
  }

  async function handleAddLesson(debriefId: string) {
    const text = (lessonDraft[debriefId] ?? '').trim();
    if (!text) return;
    setBusyDebriefId(debriefId);
    const { error } = await addDebriefLesson(debriefId, text);
    setBusyDebriefId(null);
    if (error) showToast(error.message ?? 'Could not add lesson');
    else { setLessonDraft((prev) => ({ ...prev, [debriefId]: '' })); fetchDebriefs(); }
  }

  async function handleAddAttendee(debriefId: string, profileId: string) {
    setBusyDebriefId(debriefId);
    const { error } = await addDebriefAttendee(debriefId, profileId);
    setBusyDebriefId(null);
    if (error) showToast(error.message ?? 'Could not add attendee');
    else fetchDebriefs();
  }

  async function handleComplete(debriefId: string) {
    setBusyDebriefId(debriefId);
    const { error } = await completeDebrief(debriefId);
    setBusyDebriefId(null);
    if (error) showToast(error.message ?? 'Could not complete the debrief');
    else { showToast('Debrief completed'); setAttendeePickerFor(null); fetchDebriefs(); }
  }

  if (!loaded) return null;
  if (!canEdit && debriefs.length === 0) return null;

  return (
    <Card variant="elevated" style={styles.card}>
      <Text style={styles.panelLabel}>DEBRIEFS</Text>

      {canEdit && (
        <View style={styles.startRow}>
          <Button
            label="Start hot debrief"
            variant="outline"
            onPress={() => handleStart('hot')}
            loading={starting === 'hot'}
            style={styles.flex1}
          />
          <Button
            label="Start formal debrief"
            variant="outline"
            onPress={() => handleStart('formal')}
            loading={starting === 'formal'}
            style={styles.flex1}
          />
        </View>
      )}

      {debriefs.length === 0 ? (
        <Text style={styles.hint}>No debriefs yet.</Text>
      ) : (
        debriefs.map((d) => {
          const busy = busyDebriefId === d.id;
          const inProgress = d.status === 'in_progress';
          return (
            <View key={d.id} style={styles.debriefBlock}>
              <View style={styles.debriefHeaderRow}>
                <Text style={styles.debriefFormat}>{d.format === 'hot' ? 'Hot debrief' : 'Formal debrief'}</Text>
                <Text style={styles.debriefMeta}>
                  {inProgress ? 'In progress' : 'Completed'} · started by {nameOf(d.startedBy)}
                </Text>
              </View>

              <Text style={styles.sectionTitle}>Findings</Text>
              {d.findings.length === 0 ? (
                <Text style={styles.emptyText}>None yet.</Text>
              ) : (
                d.findings.map((f) => (
                  <Text key={f.id} style={styles.listItemBody}>- {f.finding_text}</Text>
                ))
              )}
              {canEdit && inProgress && (
                <View style={styles.addRow}>
                  <TextInput
                    style={[styles.input, styles.flex1]}
                    placeholder="Add a finding"
                    placeholderTextColor={Colors.textMuted}
                    value={findingDraft[d.id] ?? ''}
                    onChangeText={(t) => setFindingDraft((prev) => ({ ...prev, [d.id]: t }))}
                  />
                  <Button label="Add" variant="outline" onPress={() => handleAddFinding(d.id)} loading={busy} />
                </View>
              )}

              <Text style={styles.sectionTitle}>Attendees</Text>
              {d.attendeeIds.length === 0 ? (
                <Text style={styles.emptyText}>None recorded.</Text>
              ) : (
                <Text style={styles.listItemBody}>{d.attendeeIds.map(nameOf).join(', ')}</Text>
              )}
              {canEdit && inProgress && (
                attendeePickerFor === d.id ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionRow}>
                    {orgMembers.filter((m) => !d.attendeeIds.includes(m.id)).map((m) => (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => handleAddAttendee(d.id, m.id)}
                        style={styles.optionChip}
                      >
                        <Text style={styles.optionChipText}>{m.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <Button label="Add attendee" variant="ghost" onPress={() => setAttendeePickerFor(d.id)} />
                )
              )}

              <Text style={styles.sectionTitle}>Lessons learned</Text>
              {d.lessons.length === 0 ? (
                <Text style={styles.emptyText}>None yet.</Text>
              ) : (
                d.lessons.map((l) => (
                  <Text key={l.id} style={styles.listItemBody}>- {l.lesson_text}</Text>
                ))
              )}
              {canEdit && inProgress && (
                <View style={styles.addRow}>
                  <TextInput
                    style={[styles.input, styles.flex1]}
                    placeholder="Add a lesson learned"
                    placeholderTextColor={Colors.textMuted}
                    value={lessonDraft[d.id] ?? ''}
                    onChangeText={(t) => setLessonDraft((prev) => ({ ...prev, [d.id]: t }))}
                  />
                  <Button label="Add" variant="outline" onPress={() => handleAddLesson(d.id)} loading={busy} />
                </View>
              )}

              {canEdit && inProgress && (
                <Button
                  label="Complete debrief"
                  onPress={() => handleComplete(d.id)}
                  loading={busy}
                  fullWidth
                />
              )}
            </View>
          );
        })
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
  hint: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 18 },

  startRow: { flexDirection: 'row', gap: Spacing.sm },
  flex1: { flex: 1 },

  debriefBlock: {
    backgroundColor: Colors.background,
    borderRadius: Radius.button,
    padding: Spacing.sm,
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  debriefHeaderRow: { gap: 2 },
  debriefFormat: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.textPrimary },
  debriefMeta: { fontSize: Typography.xs, color: Colors.textMuted },

  sectionTitle: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    marginTop: Spacing.xs,
  },
  emptyText: { fontSize: Typography.sm, color: Colors.textMuted },
  listItemBody: { fontSize: Typography.sm, color: Colors.textSecondary, lineHeight: 19 },

  addRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  input: {
    minHeight: 44,
    backgroundColor: Colors.surface,
    borderRadius: Radius.input,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },

  optionRow: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  optionChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  optionChipText: { fontSize: Typography.sm, color: Colors.textSecondary, fontWeight: Typography.medium },
});
