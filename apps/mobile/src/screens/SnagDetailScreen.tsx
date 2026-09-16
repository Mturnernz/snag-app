import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import PhotoViewer from '../components/PhotoViewer';
import AdviceCard from '../components/AdviceCard';
import DoneDialog from '../components/DoneDialog';
import EditSnagSheet from '../components/EditSnagSheet';
import LinkThingSheet from '../components/LinkThingSheet';
import LinkProjectSheet from '../components/LinkProjectSheet';
import { CalendarSheet } from '../components/DateField';
import AddThingSheet from '../components/AddThingSheet';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import {
  getSnag, getComments, addComment, updateSnag, setSnagStatus, deleteSnag, getFileUrls,
  deleteStoredFiles, getSnagAdvice, deleteSnagAdvice, setPartBought,
  getThingNotes, getThings, createThing, createLocation,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { dayKey, describeCycle, snagHeadline } from '@snag/supabase-queries';
import {
  Comment, RootStackParamList, Snag, SnagAdvice, Thing, ThingNote,
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
  const {
    members, profile, locations, refresh: refreshHousehold, reloadLocations,
  } = useHousehold();
  const { showToast } = useToast();

  const [snag, setSnag] = useState<Snag | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [advice, setAdvice] = useState<SnagAdvice | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  // Which photo is open full screen, or null. An index rather than a URL, so
  // the viewer's own next/previous walk the same strip.
  const [viewing, setViewing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [partDraft, setPartDraft] = useState('');
  // Whether the repeat walk-through is open. Seeded from the snag, but kept
  // separately so answering "Yes" can reveal the cycle questions before any
  // interval has been chosen — there is nothing to save at that point.
  const [repeating, setRepeating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * What the walkthrough opens on, held stable.
   *
   * `AddThingSheet` resets itself from `start` in an effect that depends on the
   * object, so a fresh literal per render is an infinite loop — the effect sets
   * state, the render makes a new object, the effect fires again. It hangs the
   * screen rather than failing, which is the worst shape of bug this codebase
   * keeps finding: `SnagDetailScreen.test.tsx` caught it as a timeout.
   */
  const createStart = useMemo(() => ({ room: snag?.room ?? null }), [snag?.room]);

  /** Whether the congratulations dialog is up. Only a real finish sets it. */
  const [celebrating, setCelebrating] = useState(false);
  /** Editing what the job says — its words and its room, together. */
  const [editing, setEditing] = useState(false);
  /** Which renovation this job belongs to. Read only when the sheet opens. */
  const [projectOpen, setProjectOpen] = useState(false);
  /** The day the first one lands, when none of the three presets is the answer. */
  const [dueOpen, setDueOpen] = useState(false);
  /** Choosing what it is about, and the record that choice reads from. */
  const [linking, setLinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [things, setThings] = useState<Thing[]>([]);
  const [thingsLoading, setThingsLoading] = useState(false);
  /** What has been written about the same asset, on its other jobs. */
  const [thingNotes, setThingNotes] = useState<ThingNote[]>([]);

  const load = useCallback(async () => {
    try {
      const [next, nextComments, nextAdvice] = await Promise.all([
        getSnag(params.snagId),
        getComments(params.snagId),
        // Never fatal: a job with no assessment is the resting state, and a
        // read that fails must not take the page down with it.
        getSnagAdvice(params.snagId).catch(() => null),
      ]);
      setSnag(next);
      setRepeating((open) => open || next.repeatDays !== null);
      setComments(nextComments);
      setAdvice(nextAdvice);

      // What has been said on the asset's *other* jobs. Read after the snag
      // rather than beside it, because it needs the snag's `thingId` — and
      // never fatal: history nobody can fetch must not take the page down.
      setThingNotes(next.thingId
        ? await getThingNotes(next.thingId, next.id).catch(() => [])
        : []);
      setPhotoUrls(await getFileUrls(next.photoPaths));
    } catch (err: any) {
      showAlert("Couldn't load that", err?.message ?? 'It may have been deleted.');
      navigation.goBack();
    }
  }, [params.snagId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The record this place holds, for choosing what the job is about.
   *
   * Read when the picker is opened rather than when the page loads: this is a
   * once-in-a-snag's-life decision and the page is opened constantly, so
   * spending a request on every visit to answer a question nobody asked is the
   * same waste the list already refuses. Keyed by the snag's own property, so
   * it can never offer the bach's appliances for a job at the house.
   */
  async function openLink() {
    if (!snag) return;
    setLinking(true);
    setThingsLoading(true);
    try {
      setThings(await getThings(snag.propertyId));
    } catch {
      // The picker still opens, with its own words for an empty list. A failed
      // read here must not be a dead modal.
    } finally {
      setThingsLoading(false);
    }
  }

  /** Recording something that was never in the house record, and linking it. */
  async function handleCreateThing(input: Parameters<typeof createThing>[0]) {
    if (!snag) return;
    const thing = await createThing(input);
    setCreating(false);
    await patch({ thingId: thing.id });
    showToast(`${thing.name ?? 'Recorded'} — and this job is about it`);
  }

    /**
   * Off the list, or back onto it.
   *
   * Not through `patch`, because `update_snag` starts a job when its parts
   * change and buying one of them is not adding one — see
   * `20260915150000_a_shopping_list_you_can_tick.sql`.
   */
  async function tick(item: string, bought: boolean) {
    if (!snag) return;
    setBusy(true);
    try {
      await setPartBought(snag.id, item, bought);
      setSnag(await getSnag(snag.id));
    } catch (err: any) {
      showAlert("Couldn't tick that off", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

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
      //
      // Which is also why only one of these two branches congratulates
      // anybody: the job that rolled forward is back on the list before the
      // phone is down, and a dialog saying well done over a snag that is still
      // there would be the app claiming something the list contradicts. It
      // dims and sinks to the foot of the list instead (`isDoneForNow`), and
      // keeps the toast that says so.
      if (next === 'done' && updated.status === 'open') {
        showToast(`Done — back on the list ${updated.dueAt ? 'when it’s next due' : 'again'}`);
      } else if (next === 'done') {
        setCelebrating(true);
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
      const photos = snag.photoPaths;
      await deleteSnag(snag.id);
      // The row and its files are two writes. Only the first one used to
      // happen, which left the JPEGs in the bucket with nothing pointing at
      // them. Ordered after the delete, and never allowed to fail the delete:
      // see deleteStoredFiles.
      await deleteStoredFiles(photos);
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
            {snag.photoPaths.map((path, i) => (
              // The photo is the snag — there is no title column because a
              // picture of the broken seat says what a title would. At 220×165
              // it says roughly that and no more, so it opens.
              <Pressable
                key={path}
                onPress={() => setViewing(i)}
                disabled={!photoUrls[path]}
                accessibilityRole="imagebutton"
                accessibilityLabel="Open this photo"
              >
                <Image
                  source={{ uri: photoUrls[path] }}
                  style={styles.photo}
                  resizeMode="cover"
                />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {/* The words and the room were answerable for ten seconds after the
            photo and never again. A pencil on the headline is the way back to
            both — see EditSnagSheet. */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>{snagHeadline(snag)}</Text>
          <Pressable
            onPress={() => setEditing(true)}
            disabled={busy}
            style={styles.titleEdit}
            accessibilityRole="button"
            accessibilityLabel="Edit this job"
          >
            <Icon name="create-outline" size="sm" color={Colors.textMuted} />
          </Pressable>
        </View>

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

        {/* ── Part of ──
            The punch list, in the app's own word: the defects list at the end
            of a renovation is literally a snag list, which is where the word
            comes from. So a project does not get a to-do list of its own — it
            gets these, and they sit on the List tab in their rooms with
            everything else.

            **Saying so does not start the job.** `project_id` is excluded from
            `v_started` in `update_snag`, exactly as `thing_id` is: naming which
            renovation a dripping cistern belongs to is the tail of capture, the
            same gesture as tagging the room. A link that marked twelve jobs
            'doing' at once would empty the status from the other end than the
            retired *Start it* button did.

            Above *What it's about* because it is the broader fact — which job
            this belongs to, then which appliance it is about. */}
        {snag.projectId && snag.projectName ? (
          <View style={styles.aboutRow}>
            <Pressable
              onPress={() => navigation.navigate('ProjectDetail', { projectId: snag.projectId! })}
              style={styles.about}
              accessibilityRole="button"
              accessibilityLabel={`Part of ${snag.projectName}`}
            >
              <Icon name="construct-outline" size="sm" color={Colors.textMuted} />
              <Text style={styles.aboutName} numberOfLines={1}>{snag.projectName}</Text>
            </Pressable>
            <Pressable
              onPress={() => setProjectOpen(true)}
              disabled={busy}
              style={styles.aboutClear}
              accessibilityRole="button"
              accessibilityLabel="Change which job it is part of"
            >
              <Icon name="swap-horizontal-outline" size="sm" color={Colors.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => patch({ projectId: null })}
              disabled={busy}
              style={styles.aboutClear}
              accessibilityRole="button"
              accessibilityLabel="Not part of that"
            >
              <Icon name="close" size="sm" color={Colors.textMuted} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setProjectOpen(true)}
            disabled={busy}
            style={styles.aboutAdd}
            accessibilityRole="button"
            accessibilityLabel="Part of a bigger job?"
          >
            <Icon name="construct-outline" size="sm" color={Colors.primary} />
            <Text style={styles.aboutAddLabel}>Part of a bigger job?</Text>
          </Pressable>
        )}

        {/* ── What it's about ──
            The payoff for the one question the capture sheet asks that has no
            effect on the list: a snag that knows it is about the heat pump
            carries the heat pump's make and model with it, so the answer
            somebody is standing in a shop needing is on the snag rather than
            two tabs away. `Fonts.mono` on the number, as everywhere data is
            read aloud or copied.

            The row is the door to the full record and the × is its sibling
            rather than its child, for the same reason the photo tile's is: a
            Pressable inside a Pressable is a coin toss about which one gets
            the tap. */}
        {snag.thingId && snag.thingName ? (
          <View style={styles.aboutRow}>
            <Pressable
              onPress={() => navigation.navigate('ThingDetail', { thingId: snag.thingId! })}
              style={styles.about}
              accessibilityRole="button"
              accessibilityLabel={`About ${snag.thingName}`}
            >
              <Icon name="cube-outline" size="sm" color={Colors.textMuted} />
              <Text style={styles.aboutName} numberOfLines={1}>{snag.thingName}</Text>
              {snag.thingMake || snag.thingModel ? (
                <Text style={styles.aboutSpec} numberOfLines={1}>
                  {[snag.thingMake, snag.thingModel].filter(Boolean).join(' ')}
                </Text>
              ) : null}
            </Pressable>
            {/* Change and remove are siblings of the door rather than children
                of it — a Pressable inside a Pressable is a coin toss about
                which one gets the tap. */}
            <Pressable
              onPress={openLink}
              disabled={busy}
              style={styles.aboutClear}
              accessibilityRole="button"
              accessibilityLabel="Change what it is about"
            >
              <Icon name="swap-horizontal-outline" size="sm" color={Colors.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => patch({ thingId: null })}
              disabled={busy}
              style={styles.aboutClear}
              accessibilityRole="button"
              accessibilityLabel="Not about that"
            >
              <Icon name="close" size="sm" color={Colors.textMuted} />
            </Pressable>
          </View>
        ) : (
          /* Capture's fourth step is the *fast* way to answer this and it only
             offers the room's things; it is also skipped entirely for a room
             with nothing recorded in it. So the answer has to be reachable
             afterwards, from the job itself — and "not recorded yet" has to be
             answerable here too, or the offer is a dead end for exactly the
             appliance nobody has written down. */
          <Pressable
            onPress={openLink}
            disabled={busy}
            style={styles.aboutAdd}
            accessibilityRole="button"
            accessibilityLabel="Say what it's about"
          >
            <Icon name="cube-outline" size="sm" color={Colors.primary} />
            <Text style={styles.aboutAddLabel}>Say what it's about</Text>
          </Pressable>
        )}

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

        {/* ── Notes ──
            Above triage, not below it. What the other person wrote is the
            reason this screen was opened — "ordered the part, arriving
            Tuesday" is the whole answer, and a rail of controls standing
            between the photo and it made the news the last thing read. */}
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

        {/* ── What has been said about the asset ──
            The payoff for linking, arriving where it is useful. The heat pump
            has been serviced twice and had a fault once; what somebody wrote
            the last time is the most useful paragraph in the app when the same
            appliance plays up again, and until now it was buried in a job
            nobody would think to open.

            Under this job's own notes rather than above them: what the other
            person wrote *here* is still why the screen was opened, and the
            history is the second read, not the first. This job's own comments
            are excluded by id — showing them again would read as duplicates
            rather than as history. */}
        {snag.thingId && thingNotes.length > 0 ? (
          <Card elevation="md" style={styles.section}>
            <Text style={styles.sectionTitle}>
              Also said about {snag.thingName ?? 'it'}
            </Text>
            {thingNotes.map((note) => (
              <Pressable
                key={note.id}
                onPress={() => navigation.push('SnagDetail', { snagId: note.snagId })}
                style={styles.comment}
                accessibilityRole="button"
                accessibilityLabel={`Open ${note.snagReference}`}
              >
                <Text style={styles.commentAuthor}>
                  {note.authorName}
                  <Text style={styles.commentDate}>
                    {'  '}
                    {new Date(note.createdAt).toLocaleDateString()} · {note.snagReference}
                  </Text>
                </Text>
                <Text style={styles.commentBody}>{note.body}</Text>
              </Pressable>
            ))}
          </Card>
        ) : null}

        {/* ── What came back ──
            Below the notes and above triage: the note the other person left is
            still the most common reason this screen is open, and this is the
            thing that answers the controls underneath it. A suggested part is
            an offer with a + beside it — accepting one is what puts it on the
            shopping list, and that tap is what starts the job. */}
        {advice ? (
          <AdviceCard
            advice={advice}
            parts={snag.parts}
            busy={busy}
            onAccept={(item) => patch({ parts: [...snag.parts, item] })}
            onRemove={async () => {
              setBusy(true);
              try {
                await deleteSnagAdvice(snag.id);
                setAdvice(null);
              } catch (err: any) {
                showAlert("Couldn't remove that", err?.message ?? 'Please try again.');
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}

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
              {snag.parts.map((item, index) => {
                const got = snag.bought.includes(item);
                return (
                  <View key={`${item}-${index}`} style={styles.partRow}>
                    {/* Ticking is its own write and deliberately not a `patch`:
                        changing the list starts the job, and buying something
                        off it is not starting anything. It is also where a
                        mis-tap in an aisle gets undone, which is why the row
                        stays on the trip sheet rather than vanishing. */}
                    <Pressable
                      onPress={() => tick(item, !got)}
                      disabled={busy}
                      style={styles.partTick}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: got }}
                      accessibilityLabel={got ? `${item}, got it` : `${item}, tick off`}
                    >
                      <Icon
                        name={got ? 'checkmark-circle' : 'ellipse-outline'}
                        size="sm"
                        color={got ? Colors.primary : Colors.textMuted}
                      />
                    </Pressable>
                    <Text style={[styles.partText, got && styles.partTextGot]}>{item}</Text>
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
                );
              })}
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
            default it is.

            The heading says what the section *does* rather than asking
            whether it applies: "Does it come round again?" made somebody
            hunting for a way to schedule the filter read past the one card
            that does it. The question it used to be is now the field label
            over the two chips, where a question belongs. */}
        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule a recurring job</Text>
          <Text style={styles.sectionHint}>
            Filters, gutters, smoke alarms. Marking a repeating job done schedules the next one
            instead of closing it.
          </Text>

          <Text style={styles.fieldLabel}>Does it come round again?</Text>
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
                    {/* The three presets cover the common answers and cannot
                        say "the Saturday we're back", which is the answer often
                        enough that having no way to give it made this rail read
                        as the only dates on offer. Lit whenever the date set is
                        not one the presets would have produced. */}
                    <Option
                      label="Pick a date…"
                      active={
                        !!snag.dueAt &&
                        ![0, 7, snag.repeatDays].some((at) => isDueIn(snag.dueAt, at ?? -1))
                      }
                      onPress={() => setDueOpen(true)}
                      disabled={busy}
                    />
                  </View>
                  <Text style={styles.sectionHint}>
                    {describeRepeat(snag)}
                  </Text>
                </>
              ) : null}
            </>
          ) : null}
        </Card>
      </ScrollView>

      <PhotoViewer
        visible={viewing !== null}
        photos={snag.photoPaths.map((path) => photoUrls[path]).filter(Boolean)}
        startIndex={viewing ?? 0}
        onClose={() => setViewing(null)}
      />

      <EditSnagSheet
        visible={editing}
        snag={snag}
        locations={locations}
        busy={busy}
        onSave={async (update) => {
          setEditing(false);
          await patch(update);
        }}
        onCancel={() => setEditing(false)}
      />

      {/* A day tapped on a calendar is a *local* day: built at local midnight
          and stored as the instant that is, so `dayKey` reads it back as the
          same square somebody pressed. `toISOString().slice(0, 10)` would file
          a September evening in Auckland under the next day for half the year,
          which is the bug `dayKey` exists for. */}
      <CalendarSheet
        visible={dueOpen}
        selected={snag.dueAt ? dayKey(snag.dueAt) : null}
        title="When's the first one due?"
        onPick={(iso) => {
          setDueOpen(false);
          patch({ dueAt: new Date(`${iso}T00:00:00`).toISOString() });
        }}
        onClose={() => setDueOpen(false)}
      />

      <LinkProjectSheet
        visible={projectOpen}
        propertyId={snag.propertyId}
        linkedId={snag.projectId}
        onClose={() => setProjectOpen(false)}
        onPick={async (projectId) => {
          setProjectOpen(false);
          // A second press on the one it already belongs to unlinks it — the
          // same gesture the thing link uses, so the two rows behave alike.
          await patch({ projectId: projectId === snag.projectId ? null : projectId });
        }}
      />

      <LinkThingSheet
        visible={linking}
        things={things}
        loading={thingsLoading}
        linkedId={snag.thingId}
        onPick={async (thingId) => {
          setLinking(false);
          // The second press on the one it is already about unlinks it, the
          // same gesture the capture sheet uses.
          await patch({ thingId: thingId === snag.thingId ? null : thingId });
        }}
        onCreate={() => {
          setLinking(false);
          setCreating(true);
        }}
        onCancel={() => setLinking(false)}
      />

      {/* The walkthrough itself, not a second shorter form — a record created
          from here has to be as strong as one created from the House tab, or
          this is the back door that fills the house record with rows nobody
          can read in a shop. The room is pre-filled from the job. */}
      <AddThingSheet
        visible={creating}
        locations={locations}
        pathPrefix={snag.householdId}
        start={createStart}
        onAddRoom={async (name) => {
          try {
            await createLocation(snag.propertyId, name);
            await reloadLocations();
            return true;
          } catch {
            return false;
          }
        }}
        onAdd={(input) => handleCreateThing({ ...input, propertyId: snag.propertyId })}
        onCancel={() => setCreating(false)}
      />

      {/* One button, and it goes back to the list — which is where the reward
          actually is, because the snag has just left it. */}
      <DoneDialog
        visible={celebrating}
        headline={snagHeadline(snag)}
        onClose={() => {
          setCelebrating(false);
          navigation.goBack();
        }}
      />

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
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
  },
  // Muted and small: editing the wording is rare next to reading it, and the
  // pencil must not compete with the headline it sits beside.
  titleEdit: {
    width: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  aboutAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  aboutAddLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  metaText: { fontSize: Typography.sm, color: Colors.textMuted },
  reportedBy: { fontSize: Typography.sm, color: Colors.textMuted },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  about: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  aboutName: { fontSize: Typography.sm, color: Colors.textSecondary, flexShrink: 1 },
  // The answer somebody came for, in the face this app spends only on data.
  aboutSpec: { fontSize: Typography.sm, color: Colors.textMuted, fontFamily: Fonts.mono, flexShrink: 1 },
  aboutClear: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  partTick: { minWidth: 28, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  partTextGot: { color: Colors.textMuted, textDecorationLine: 'line-through' },
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
