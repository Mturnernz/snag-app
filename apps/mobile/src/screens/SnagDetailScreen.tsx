import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Image, TextInput, Pressable, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ScreenHeader from '../components/ScreenHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Icon from '../components/Icon';
import StatusBadge from '../components/StatusBadge';
import DueBadge from '../components/DueBadge';
import ConfirmDialog from '../components/ConfirmDialog';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import {
  getSnag, getComments, addComment, updateSnag, setSnagStatus, deleteSnag, getSnagPhotoUrls,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { snagHeadline } from '@snag/supabase-queries';
import {
  Comment, RootStackParamList, Snag,
  EFFORT_ORDER, EFFORT_SHORT_LABELS, PRIORITY_ORDER, PRIORITY_LABELS, REPEAT_PRESETS,
} from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'SnagDetail'>;

/**
 * The detail screen is where triage happens — everything capture deliberately
 * didn't ask for.
 *
 * Each control writes immediately rather than collecting into a form with a
 * Save button. Triage is a series of small independent decisions ("this is a
 * quick one", "this needs a part"), and making someone confirm each one turns
 * sorting a pile of twelve into forty taps.
 */
export default function SnagDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { members, profile, refresh: refreshHousehold } = useHousehold();
  const { showToast } = useToast();

  const [snag, setSnag] = useState<Snag | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const [next, nextComments] = await Promise.all([
        getSnag(params.snagId),
        getComments(params.snagId),
      ]);
      setSnag(next);
      setComments(nextComments);
      setPhotoUrls(await getSnagPhotoUrls(next.photoPaths));
    } catch (err: any) {
      showAlert("Couldn't load that", err?.message ?? 'It may have been deleted.');
      navigation.goBack();
    }
  }, [params.snagId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  /** Every triage control goes through here: write, then re-read. */
  async function patch(update: Parameters<typeof updateSnag>[1]) {
    if (!snag) return;
    setBusy(true);
    try {
      setSnag(await updateSnag(snag.id, update));
      if ('room' in update) refreshHousehold();
    } catch (err: any) {
      showAlert("Couldn't save that", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(next: Snag['status']) {
    if (!snag) return;
    setBusy(true);
    try {
      const updated = await setSnagStatus(snag.id, next);
      setSnag(updated);
      // A repeating snag doesn't close — the RPC rolls it forward instead, so
      // say what actually happened rather than what was asked for.
      if (next === 'done' && updated.status === 'open') {
        showToast(`Done — back on the list ${updated.dueAt ? 'when it’s next due' : 'again'}`);
      } else if (next === 'done') {
        showToast('Done');
      }
    } catch (err: any) {
      showAlert("Couldn't update that", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleComment() {
    if (!snag || !draft.trim()) return;
    setBusy(true);
    try {
      await addComment(snag.id, draft.trim());
      setDraft('');
      setComments(await getComments(snag.id));
    } catch (err: any) {
      showAlert("Couldn't add that", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!snag) return;
    setConfirmDelete(false);
    try {
      await deleteSnag(snag.id);
      showToast('Deleted');
      navigation.goBack();
    } catch (err: any) {
      showAlert("Couldn't delete that", err?.message ?? 'Please try again.');
    }
  }

  if (!snag) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ paddingTop: insets.top }}>
        <ScreenHeader
          title={snag.reference}
          onBack={() => navigation.goBack()}
          rightSlot={
            <Pressable
              onPress={() => setConfirmDelete(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Delete"
            >
              <Icon name="trash-outline" size="md" color={Colors.textMuted} />
            </Pressable>
          }
        />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {snag.photoPaths.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
            {snag.photoPaths.map((path) => (
              <Image
                key={path}
                source={{ uri: photoUrls[path] }}
                style={styles.photo}
                resizeMode="cover"
              />
            ))}
          </ScrollView>
        ) : null}

        <Text style={styles.title}>{snagHeadline(snag)}</Text>

        <View style={styles.metaRow}>
          <StatusBadge status={snag.status} />
          <DueBadge snag={snag} />
          {snag.room ? (
            <View style={styles.metaItem}>
              <Icon name="location-outline" size="sm" color={Colors.textMuted} />
              <Text style={styles.metaText}>{snag.room}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.reportedBy}>
          Added by {snag.reporterId === profile.id ? 'you' : snag.reporterName}
          {snag.lastDoneAt ? ` · last done ${new Date(snag.lastDoneAt).toLocaleDateString()}` : ''}
        </Text>



        {/* ── Status ── */}
        <View style={styles.statusRow}>
          {snag.status !== 'doing' ? (
            <Button
              label="Start it"
              variant="outline"
              onPress={() => handleStatus('doing')}
              disabled={busy}
              style={styles.statusButton}
            />
          ) : null}
          {snag.status !== 'done' ? (
            <Button
              label="Mark done"
              onPress={() => handleStatus('done')}
              disabled={busy}
              icon="checkmark-circle-outline"
              style={styles.statusButton}
            />
          ) : (
            <Button
              label="Reopen"
              variant="outline"
              onPress={() => handleStatus('open')}
              disabled={busy}
              style={styles.statusButton}
            />
          )}
        </View>

        {/* ── Triage ── */}
        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>Sort it out</Text>

          <Text style={styles.fieldLabel}>How urgent?</Text>
          <View style={styles.optionRow}>
            {PRIORITY_ORDER.map((value) => (
              <Option
                key={value}
                label={PRIORITY_LABELS[value]}
                active={snag.priority === value}
                onPress={() => patch({ priority: snag.priority === value ? null : value })}
                disabled={busy}
              />
            ))}
          </View>

          <Text style={styles.fieldLabel}>How long will it take?</Text>
          <View style={styles.optionRow}>
            {EFFORT_ORDER.map((value) => (
              <Option
                key={value}
                label={EFFORT_SHORT_LABELS[value]}
                active={snag.effort === value}
                onPress={() => patch({ effort: snag.effort === value ? null : value })}
                disabled={busy}
              />
            ))}
          </View>

          <Pressable
            onPress={() => patch({ needsParts: !snag.needsParts })}
            disabled={busy}
            style={styles.toggleRow}
            accessibilityRole="switch"
            accessibilityState={{ checked: snag.needsParts }}
          >
            <Icon
              name={snag.needsParts ? 'checkbox' : 'square-outline'}
              size="md"
              color={snag.needsParts ? Colors.primary : Colors.textMuted}
            />
            <View style={styles.toggleBody}>
              <Text style={styles.toggleLabel}>Needs something from the shop</Text>
              <Text style={styles.toggleHint}>Collected into one list on the Weekend tab</Text>
            </View>
          </Pressable>

          <Text style={styles.fieldLabel}>Who's doing it?</Text>
          <View style={styles.optionRow}>
            {members.map((member) => (
              <Option
                key={member.profileId}
                label={member.profileId === profile.id ? 'Me' : member.displayName}
                active={snag.assigneeId === member.profileId}
                onPress={() =>
                  patch({
                    assigneeId: snag.assigneeId === member.profileId ? null : member.profileId,
                  })
                }
                disabled={busy}
              />
            ))}
          </View>
        </Card>

        {/* ── Repeat ── */}
        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>Does it come round again?</Text>
          <Text style={styles.sectionHint}>
            Filters, gutters, smoke alarms. Marking a repeating job done schedules the next one
            instead of closing it.
          </Text>
          <View style={styles.optionRow}>
            <Option
              label="One-off"
              active={!snag.repeatDays}
              onPress={() => patch({ repeatDays: null })}
              disabled={busy}
            />
            {REPEAT_PRESETS.map(({ days, label }) => (
              <Option
                key={days}
                label={label}
                active={snag.repeatDays === days}
                onPress={() =>
                  patch({
                    repeatDays: days,
                    // A repeat with no start date would never surface. Start
                    // the clock now unless one is already set.
                    dueAt: snag.dueAt ?? new Date(Date.now() + days * 86_400_000).toISOString(),
                  })
                }
                disabled={busy}
              />
            ))}
          </View>
        </Card>

        {/* ── Comments ── */}
        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>
            Notes {comments.length > 0 ? `(${comments.length})` : ''}
          </Text>
          {comments.map((comment) => (
            <View key={comment.id} style={styles.comment}>
              <Text style={styles.commentAuthor}>
                {comment.authorId === profile.id ? 'You' : comment.authorName}
                <Text style={styles.commentDate}>
                  {'  '}
                  {new Date(comment.createdAt).toLocaleDateString()}
                </Text>
              </Text>
              <Text style={styles.commentBody}>{comment.body}</Text>
            </View>
          ))}
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="Ordered the part, arriving Tuesday"
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={4000}
            />
            <Pressable
              onPress={handleComment}
              disabled={!draft.trim() || busy}
              style={[styles.commentSend, (!draft.trim() || busy) && styles.commentSendDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Add note"
            >
              <Icon name="arrow-up" size="md" color={Colors.white} />
            </Pressable>
          </View>
        </Card>
      </ScrollView>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete this?"
        message="It'll be gone for good, along with its notes and photos."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </KeyboardAvoidingView>
  );
}

function Option({
  label, active, onPress, disabled,
}: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.option, active && styles.optionActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  photoStrip: { marginBottom: Spacing.sm },
  photo: {
    width: 220,
    height: 165,
    borderRadius: Radius.card,
    marginRight: Spacing.sm,
    backgroundColor: Colors.border,
  },
  title: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  metaText: { fontSize: Typography.sm, color: Colors.textMuted },
  reportedBy: { fontSize: Typography.sm, color: Colors.textMuted },
  description: {
    fontSize: Typography.base,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginTop: Spacing.xs,
  },
  statusRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  statusButton: { flex: 1 },
  section: { marginTop: Spacing.lg, gap: Spacing.sm },
  sectionTitle: {
    fontSize: Typography.lg,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  sectionHint: { fontSize: Typography.sm, color: Colors.textMuted },
  fieldLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  option: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  optionActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionLabel: { fontSize: Typography.sm, color: Colors.textSecondary },
  optionLabelActive: { color: Colors.white, fontWeight: Typography.semibold },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  toggleBody: { flex: 1 },
  toggleLabel: {
    fontSize: Typography.base,
    color: Colors.textPrimary,
    fontWeight: Typography.medium,
  },
  toggleHint: { fontSize: Typography.sm, color: Colors.textMuted },
  comment: {
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.xs / 2,
  },
  commentAuthor: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  commentDate: { fontWeight: Typography.regular, color: Colors.textMuted },
  commentBody: { fontSize: Typography.base, color: Colors.textPrimary },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, marginTop: Spacing.sm },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    maxHeight: 120,
    minHeight: MIN_TOUCH_TARGET,
  },
  commentSend: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentSendDisabled: { opacity: 0.4 },
});
