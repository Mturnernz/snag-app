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
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import {
  getSnag, getComments, addComment, updateSnag, setSnagStatus, deleteSnag, getFileUrls,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { describeCycle, snagHeadline } from '@snag/supabase-queries';
import {
  Comment, RootStackParamList, Snag,
  PRIORITY_ORDER, PRIORITY_LABELS, REPEAT_PRESETS,
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
const DAY_MS = 86_400_000;

/** "month", "3 months" — for the sentence about when the first one lands. */
/** Within a day either side — these are buttons, not a calendar. */
function isDueIn(dueAt: string | null, days: number): boolean {
  if (!dueAt) return false;
  const wanted = Date.now() + days * DAY_MS;
  return Math.abs(new Date(dueAt).getTime() - wanted) < DAY_MS / 2;
}

/** The whole arrangement, in one sentence, so nobody has to infer it. */
function describeRepeat(snag: Snag): string {
  if (!snag.repeatDays) return '';
  const every = describeCycle(snag.repeatDays);
  const when = snag.dueAt ? new Date(snag.dueAt).toLocaleDateString() : 'once you set a date';
  return `Due ${when}, then every ${every} after it's marked done.`;
}

export default function SnagDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const insets = useSafeAreaInsets();
  // The comment box is the last thing in a long scroll, so on web the keyboard
  // opens over the thing being typed into. The KeyboardAvoidingView wrapped
  // around this screen does nothing in a browser — see lib/keyboardInset.ts.
  const keyboard = useKeyboardInset();
  const { members, profile, refresh: refreshHousehold } = useHousehold();
  const { showToast } = useToast();

  const [snag, setSnag] = useState<Snag | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [partDraft, setPartDraft] = useState('');
  // Whether the repeat walk-through is open. Seeded from the snag, but kept
  // separately so answering "Yes" can reveal the cycle questions before any
  // interval has been chosen — there is nothing to save at that point.
  const [repeating, setRepeating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const [next, nextComments] = await Promise.all([
        getSnag(params.snagId),
        getComments(params.snagId),
      ]);
      setSnag(next);
      setRepeating((open) => open || next.repeatDays !== null);
      setComments(nextComments);
      setPhotoUrls(await getFileUrls(next.photoPaths));
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

  async function addPart() {
    const item = partDraft.trim();
    if (!snag || !item || busy) return;
    setPartDraft('');
    await patch({ parts: [...snag.parts, item] });
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

      <ScrollView
        contentContainerStyle={[styles.content, keyboard > 0 && { paddingBottom: keyboard + Spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
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



        {/* ── Status ──
            No "Start it". Nobody pressed it: people commented on things and
            assigned them to each other while the list went on claiming nothing
            had been touched. Doing something about a snag is the evidence that
            it has been started, so the server moves it — see
            20260912140000_work_starts_itself.sql. Finishing is the one state
            change that still needs saying out loud. */}
        <View style={styles.statusRow}>
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

          {/* A tick told you a trip was needed and not what for, which is the
              half that actually blocks a small job for weeks. Optional: most
              jobs need nothing, and an empty list is the resting state. */}
          <Text style={styles.fieldLabel}>Anything to pick up?</Text>
          {snag.parts.length > 0 ? (
            <View style={styles.partsList}>
              {snag.parts.map((item, index) => (
                <View key={`${item}-${index}`} style={styles.partRow}>
                  <Icon name="ellipse-outline" size="sm" color={Colors.textMuted} />
                  <Text style={styles.partText}>{item}</Text>
                  <Pressable
                    onPress={() => patch({ parts: snag.parts.filter((_, i) => i !== index) })}
                    disabled={busy}
                    style={styles.partRemove}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item}`}
                  >
                    <Icon name="close" size="sm" color={Colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.partAddRow}>
            <TextInput
              style={styles.partInput}
              value={partDraft}
              onChangeText={setPartDraft}
              placeholder="Hinge, wall plugs, a filter…"
              placeholderTextColor={Colors.textMuted}
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={addPart}
              blurOnSubmit={false}
              accessibilityLabel="Something to pick up"
            />
            <Pressable
              onPress={addPart}
              disabled={busy || !partDraft.trim()}
              style={[styles.partAdd, (busy || !partDraft.trim()) && styles.partAddOff]}
              accessibilityRole="button"
              accessibilityLabel="Add to the shopping list"
            >
              <Icon
                name="add"
                size="md"
                color={busy || !partDraft.trim() ? Colors.textMuted : Colors.white}
              />
            </Pressable>
          </View>

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

        {/* ── Repeat ──
            A yes/no first, then the cycle. The old version was a row of
            presets where "One-off" was one of the options, so the common
            answer — no, it doesn't — looked like a setting rather than the
            default it is. */}
        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>Does it come round again?</Text>
          <Text style={styles.sectionHint}>
            Filters, gutters, smoke alarms. Marking a repeating job done schedules the next one
            instead of closing it.
          </Text>

          <View style={styles.optionRow}>
            <Option
              label="No"
              active={!repeating}
              onPress={() => {
                setRepeating(false);
                if (snag.repeatDays) patch({ repeatDays: null });
              }}
              disabled={busy}
            />
            <Option label="Yes" active={repeating} onPress={() => setRepeating(true)} disabled={busy} />
          </View>

          {repeating ? (
            <>
              <Text style={styles.fieldLabel}>How often?</Text>
              <View style={styles.optionRow}>
                {REPEAT_PRESETS.map(({ days, label }) => (
                  <Option
                    key={days}
                    label={label}
                    active={snag.repeatDays === days}
                    onPress={() =>
                      patch({
                        repeatDays: days,
                        // A repeat with no date on it would never surface. Set
                        // one on the first choice, and leave an existing one be.
                        dueAt: snag.dueAt ?? new Date(Date.now() + days * DAY_MS).toISOString(),
                      })
                    }
                    disabled={busy}
                  />
                ))}
              </View>

              {snag.repeatDays ? (
                <>
                  <Text style={styles.fieldLabel}>When's the first one due?</Text>
                  <View style={styles.optionRow}>
                    {[
                      { label: 'Today', at: 0 },
                      { label: 'In a week', at: 7 },
                      { label: `A full ${describeCycle(snag.repeatDays)} away`, at: snag.repeatDays },
                    ].map(({ label, at }) => (
                      <Option
                        key={label}
                        label={label}
                        active={isDueIn(snag.dueAt, at)}
                        onPress={() => patch({ dueAt: new Date(Date.now() + at * DAY_MS).toISOString() })}
                        disabled={busy}
                      />
                    ))}
                  </View>
                  <Text style={styles.sectionHint}>
                    {describeRepeat(snag)}
                  </Text>
                </>
              ) : null}
            </>
          ) : null}
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
              <Icon
                name="arrow-up"
                size="md"
                color={!draft.trim() || busy ? Colors.textMuted : Colors.white}
              />
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
  // The same chip as everywhere else: a sunken well when off, solid fern when
  // on, no border either way. It sat on the ground colour with a border, which
  // inside a white card is a box drawn around a box.
  option: {
    minHeight: MIN_TOUCH_TARGET - Spacing.md,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  optionActive: { backgroundColor: Colors.primary },
  optionLabel: { fontSize: Typography.sm, color: Colors.textSecondary },
  optionLabelActive: { color: Colors.white, fontWeight: Typography.semibold },
  // The shopping list. Rows read like a list you'd scan in an aisle; the field
  // below is how you add to it, and is the only text input on this screen
  // besides a note.
  partsList: { gap: Spacing.xs, marginTop: Spacing.xs },
  partRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32 },
  partText: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary },
  partRemove: {
    width: MIN_TOUCH_TARGET - Spacing.md,
    height: MIN_TOUCH_TARGET - Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partAddRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  partInput: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  partAdd: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: Radius.input,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partAddOff: { backgroundColor: Colors.sunken },
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
  // Neutral, not a faded fern — see the note on Button's disabled state. Half
  // strength on this ground is a pale sage that reads as broken.
  commentSendDisabled: { backgroundColor: Colors.sunken },
});
