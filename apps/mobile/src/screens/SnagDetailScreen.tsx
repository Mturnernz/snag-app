import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Image, TextInput, Pressable, Modal, StyleSheet,
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
import StickyActionBar from '../components/StickyActionBar';
import PhotoViewer from '../components/PhotoViewer';
import AdviceCard from '../components/AdviceCard';
import DoneDialog from '../components/DoneDialog';
import EditSnagSheet from '../components/EditSnagSheet';
import DateField, { CalendarSheet } from '../components/DateField';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import {
  getSnag, getComments, addComment, updateSnag, setSnagStatus, deleteSnag, getFileUrls,
  deleteStoredFiles, getSnagAdvice, deleteSnagAdvice, setPartBought,
  getThingNotes, getThings,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { addPhotos } from '../lib/addPhotos';
import LinkedText from '../components/LinkedText';
import {
  dayKey, describeCycle, formatLooseDate, parseLooseDate, snagHeadline, thingsInArea, thingHeadline,
} from '@snag/supabase-queries';
import {
  Comment, RootStackParamList, Snag, SnagAdvice, Thing, ThingNote, REPEAT_PRESETS,
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

/** The thing page's words for the same fact, so two screens do not invent two. */
function unsavedHint(count: number): string {
  return count === 1 ? '1 unsaved change' : `${count} unsaved changes`;
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
  /**
   * What is in the due-date box, as typed.
   *
   * A string rather than the snag's own `dueAt`, because a half-typed date is
   * not a date yet: `8/1` on the way to `8/11/2019` parses to the eighth of
   * January, and a field that wrote on every keystroke would file the job under
   * it. It is committed on blur and re-seeded whenever the row changes.
   */
  const [dueDraft, setDueDraft] = useState('');
  /** Whether the recurring arrangement is open. */
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Whether the congratulations dialog is up. Only a real finish sets it. */
  const [celebrating, setCelebrating] = useState(false);
  /** Editing what the job says — its words and its room, together. */
  const [editing, setEditing] = useState(false);
  /** The day the first one lands, when none of the three presets is the answer. */
  const [dueOpen, setDueOpen] = useState(false);
  /** The place's record, for the read-only list of what is in this room. */
  const [things, setThings] = useState<Thing[]>([]);
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
      setDueDraft(formatLooseDate(next.dueAt));
      setComments(nextComments);
      setAdvice(nextAdvice);

      // What has been said on the asset's *other* jobs. Read after the snag
      // rather than beside it, because it needs the snag's `thingId` — and
      // never fatal: history nobody can fetch must not take the page down.
      setThingNotes(next.thingId
        ? await getThingNotes(next.thingId, next.id).catch(() => [])
        : []);
      setPhotoUrls(await getFileUrls(next.photoPaths));

      // What is recorded in this place, for the read-only list of what is in
      // this room. Never fatal and never awaited by anything that renders the
      // job itself: a list of the room's appliances is the least important
      // thing on this page and must not be what stops the notes appearing.
      getThings(next.propertyId).then(setThings).catch(() => setThings([]));
    } catch (err: any) {
      showAlert("Couldn't load that", err?.message ?? 'It may have been deleted.');
      navigation.goBack();
    }
  }, [params.snagId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * What is recorded in this job's room.
   *
   * `thingsInArea` takes `Thing[]`, which is what keeps a ghost out of here:
   * a suggestion is a `RoomSuggestion` with no id, so the kitchen's dashed
   * "Rangehood" prompt can never be listed as something the house has.
   */
  const linked = useMemo(
    () => (snag ? thingsInArea(things, snag.room) : []),
    [things, snag?.room]
  );

  /**
   * The typed date, committed once somebody leaves the box.
   *
   * `parseLooseDate` returns `undefined` for anything it cannot read against a
   * real calendar — `31/02/2026`, a two-digit year — and that is refused here
   * in words rather than reaching Postgres as a `22008` raised from inside an
   * RPC. An emptied box clears the date, which is somebody saying there is no
   * longer a day for this.
   */
  async function commitDue() {
    if (!snag) return;
    const pending = pendingDue();
    if (!pending) return;
    if (pending.unreadable) {
      showAlert("Couldn't read that date", 'Try 8/11/2019, Nov 2019, or tap the calendar.');
      setDueDraft(formatLooseDate(snag.dueAt));
      return;
    }
    await patch({ dueAt: pending.dueAt });
  }

  /**
   * What the date box holds that the row does not, read rather than written.
   *
   * Shared by the blur commit and by Save, so the two cannot disagree about
   * what counts as a change or about which strings are readable. `undefined`
   * means the box matches the row; `unreadable` means somebody typed something
   * no calendar has, which `parseLooseDate` refuses rather than letting it
   * reach Postgres as a `22008` from inside an RPC.
   */
  function pendingDue(): { dueAt: string | null; unreadable?: true } | undefined {
    if (!snag) return undefined;
    const typed = dueDraft.trim();
    if (typed === formatLooseDate(snag.dueAt)) return undefined;
    if (!typed) return { dueAt: null };
    const parsed = parseLooseDate(typed);
    if (!parsed) return { dueAt: null, unreadable: true };
    return { dueAt: new Date(`${parsed}T00:00:00`).toISOString() };
  }

  /**
   * How much is typed into a box and not yet on the row.
   *
   * Two boxes can be: the date, and the item being added to the shopping list.
   * Everything else here wrote when it was pressed, so these are the only
   * things a Save could still be waiting on — and the only branches in which
   * "All changes saved" would be a lie.
   */
  const unsaved = (pendingDue() ? 1 : 0) + (partDraft.trim() ? 1 : 0);

  /**
   * Finishing with the page.
   *
   * **It commits what is sitting in a box, and that is the whole reason it is
   * not merely a Close.** `onBlur` is not guaranteed to have fired — on native,
   * pressing a Pressable does not reliably blur a `TextInput` — and the item
   * half-typed into the shopping box has no blur commit at all: it waits on the
   * `+` beside it. Without this, Save would be the one button on the page that
   * silently discards what somebody typed, which is precisely the failure a
   * button called Save exists to prevent.
   *
   * **One write, not two.** A date and an item both pending are one
   * `update_snag` rather than two round trips and two re-reads.
   *
   * A date it cannot read holds the page open rather than closing over it: the
   * words stay in the box so they can be fixed, unlike the blur path, which has
   * somewhere to put them back to.
   */
  async function saveAndClose() {
    if (busy || !snag) return;

    const update: Parameters<typeof updateSnag>[1] = {};
    const due = pendingDue();
    if (due?.unreadable) {
      showAlert("Couldn't read that date", 'Try 8/11/2019, Nov 2019, or tap the calendar.');
      return;
    }
    if (due) update.dueAt = due.dueAt;

    // Adding an item is one of the four things that start a job, which is
    // right: deciding what to buy is deciding to do the work. Pressing Save
    // with a word in the box is adding it.
    const item = partDraft.trim();
    if (item) update.parts = [...snag.parts, item];

    if (Object.keys(update).length > 0) {
      const ok = await patch(update);
      if (!ok) return;
      setPartDraft('');
    }
    navigation.goBack();
  }

  /** Another angle, or the plate you went back for. */
  async function handleAddPhotos() {
    if (!snag || busy) return;
    setBusy(true);
    try {
      await addPhotos(snag.householdId, async (added) => {
        setSnag(await updateSnag(snag.id, { photoPaths: [...snag.photoPaths, ...added] }));
        showToast(added.length === 1 ? 'Photo added' : `${added.length} photos added`);
      });
    } finally {
      setBusy(false);
    }
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

  /**
   * Every triage control goes through here: write, then re-read.
   *
   * Returns whether the write landed. Every control that fires and forgets
   * ignores it — the alert is the report — but Save must not navigate away
   * from a page whose last write failed, which would read as having saved.
   */
  async function patch(update: Parameters<typeof updateSnag>[1]): Promise<boolean> {
    if (!snag) return false;
    setBusy(true);
    try {
      setSnag(await updateSnag(snag.id, update));
      if ('room' in update) refreshHousehold();
      return true;
    } catch (err: any) {
      showAlert("Couldn't save that", err?.message ?? 'Please try again.');
      return false;
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
        {/* ── The photographs ──
            The photo *is* the snag: there is no title column because a picture
            of the broken seat says what a title would. At 220×165 a tile says
            roughly that and no more, so it opens.

            **A second angle is answerable now.** One photograph was all a job
            could ever hold, because the only camera that reached a snag was the
            compose bar's and that files a *new* one — so the crack you noticed
            afterwards, or the model plate you went back for, became a second
            job about the same thing. The + is at the end of the strip rather
            than under it, where a control that grows a row belongs, and it
            inherits every upload rule the thing page paid for (see
            `lib/addPhotos.ts`).

            Adding one deliberately does not start the job: `v_started` reads
            assignee, due date, repeat and parts, and photographing something is
            not deciding to do it. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
          {snag.photoPaths.map((path, i) => (
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

          <Pressable
            onPress={handleAddPhotos}
            disabled={busy}
            style={[styles.photoAdd, busy && styles.photoAddOff]}
            accessibilityRole="button"
            accessibilityLabel={
              snag.photoPaths.length > 0 ? 'Add another photo' : 'Add a photo'
            }
          >
            <Icon name="camera-outline" size="md" color={Colors.primary} />
            <Text style={styles.photoAddLabel}>
              {snag.photoPaths.length > 0 ? 'Add another' : 'Add a photo'}
            </Text>
          </Pressable>
        </ScrollView>

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
              <LinkedText style={styles.commentBody}>{comment.body}</LinkedText>
            </View>
          ))}
          <View style={styles.commentInputRow}>
            {/* Four lines, not one. This is the only channel by which one
                person tells the other anything — there are no notifications and
                never will be — and a single-line box says "a few words" to
                somebody whose actual message is which part was ordered, from
                where, arriving when, and what it cost. A note that has to be
                composed in a slot showing eight words of itself gets written
                shorter than it needed to be. */}
            <TextInput
              style={styles.commentInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="Ordered the part, arriving Tuesday"
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={4}
              maxLength={4000}
              accessibilityLabel="Add a note"
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
                <LinkedText style={styles.commentBody}>{note.body}</LinkedText>
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

        {/* ── Anything to pick up ──
            Its own card, under the notes, where a card of three unrelated
            triage controls used to stand.

            *Sort it out* held urgency, this list, and who was doing it. Two of
            those are gone — priority because a household list is a dozen small
            jobs none of which is an emergency, and an assignee because two
            people in one house tell each other out loud — and a card holding
            one thing is not a card, it is a heading pretending to be a
            category.

            **It belongs under the notes and nowhere else.** The trip to the
            shop is the single most common reason a small job sits for weeks, so
            this is the part of triage that actually moves work; the note above
            it is why the screen was opened. Everything else on the page reads
            in that order now.

            Changing the list is one of the four things that start a job
            (`v_started`), because deciding what to buy is deciding to do the
            work. Ticking one off is not — that is `set_part_bought`, which
            touches neither the status nor `updated_at`, and is a separate
            function precisely so it cannot. */}
        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>Anything to pick up?</Text>
          {/* A tick told you a trip was needed and not what for, which is the
              half that actually blocks a small job for weeks. Optional: most
              jobs need nothing, and an empty list is the resting state. */}
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
        </Card>

        {/* ── Linked assets ──
            What is recorded in this room, as a list to read.

            It replaced two controls that both *wrote*: *Part of a bigger job*,
            which set `project_id`, and *Say what it's about*, which set
            `thing_id` through a picker over the whole house record. Neither
            question was one somebody standing on this page arrives wanting to
            answer — they were tagging, and tagging is capture's job — and both
            put a chooser on a page that is otherwise read far more often than
            it is edited.

            **The payoff was never the tag, it was the model number.** A snag
            about the heat pump was worth linking because eight months later
            somebody is in a shop wanting `MSZ-AP50VGK`. This gives them that
            without asking for anything: the room is already on the job, and the
            things in that room are the shortlist a human would have picked
            from. One line each, tapping through to the full record.

            Three rules:

            - **It writes nothing.** No tag, no link, no status — the same rule
              the Schedule tab holds to, and for the same reason: the moment
              there are two ways to say what a job is about, neither is
              trustworthy.
            - **Ghosts cannot appear here, and that is the type rather than a
              filter.** `thingsInArea` takes `Thing[]`; a suggestion is a
              `RoomSuggestion` with no id, so a dashed prompt for a rangehood
              nobody has recorded can never be offered as an answer.
            - **It is absent entirely when the room holds nothing**, rather than
              an empty heading. A section with nothing in it is the app asking
              somebody to read a question it cannot answer.

            The read is not fatal and is not awaited by anything on the page: a
            list of what is in the room is the least important thing here, and
            it must never be what stops a job's notes rendering. */}
        {linked.length > 0 ? (
          <Card elevation="md" style={styles.section}>
            <Text style={styles.sectionTitle}>Linked assets</Text>
            {linked.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => navigation.navigate('ThingDetail', { thingId: item.id })}
                style={styles.assetRow}
                accessibilityRole="button"
                accessibilityLabel={`Open ${thingHeadline(item)}`}
              >
                <Icon name="cube-outline" size="sm" color={Colors.textMuted} />
                {/* Stacked, not laid across. Side by side, the mono spec took
                    its intrinsic width and the name — flexed, `minWidth: 0` —
                    shrank to fit whatever was left: "Microwave" came out as
                    **M** beside `Samsung MS32J5133B/MS40J5133B`, and the
                    rangehood as **Ra…**. That is the two-column row having
                    nowhere to put a long answer, which is the same failure the
                    thing page's spec sheet and a project's totals both fixed by
                    un-columning themselves.
                    Both lines matter here and neither can be the one that
                    gives way: the noun is how you find the row, the model is
                    what you came to read. So each gets a line of its own. */}
                <View style={styles.assetBody}>
                  <Text style={styles.assetName} numberOfLines={1}>{thingHeadline(item)}</Text>
                  {item.make || item.model ? (
                    <Text style={styles.assetSpec} numberOfLines={1}>
                      {[item.make, item.model].filter(Boolean).join(' ')}
                    </Text>
                  ) : null}
                </View>
                <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
              </Pressable>
            ))}
          </Card>
        ) : null}

        {/* ── When it's due ──
            Its own field, and it was not reachable at all except through the
            repeat card — so a one-off job could never be given a date. That
            made the Schedule tab's *Due* marks and the overdue badge features
            only repeating jobs had, which is precisely backwards: a filter that
            comes round every six months looks after itself, and the gutters
            before the weekend away are the ones somebody needs reminding of.

            Typed or tapped, through the one `DateField` every date in this app
            uses — `8/11/2019` is the eighth of November, and a calendar sits in
            the box because it says what it wants better than grey example text
            does. Setting a date starts the job, which is right: putting a day
            on something is deciding to do it. */}
        <Card elevation="md" style={styles.section}>
          {/* The label belongs to `DateField` rather than being a card title
              above it, so the box has an accessible name of its own — a screen
              reader on a card whose only content is one input should not have
              to infer what the input is for from a heading it has already
              passed. Same stacked shape the thing page's spec sheet uses:
              name above, box below, full width. */}
          <DateField
            label="When's it due?"
            value={dueDraft}
            onChangeValue={setDueDraft}
            onBlur={commitDue}
            placeholder="No date — that's fine"
            pickerTitle="When's it due?"
          />
        </Card>

        {/* ── Repeat ──
            A yes/no, and nothing else on the card until the answer is yes.

            It used to carry a paragraph under the heading explaining filters
            and gutters and what marking a repeating job done does, then a
            question, then two rails of presets — a card that had to be read
            before the one-word answer it actually wanted could be given. The
            common answer is no. So the card asks, and the arrangement moves
            into a modal that only somebody who said yes ever sees.

            The heading still says what the section *does* rather than asking
            whether it applies: "Does it come round again?" made somebody
            hunting for a way to schedule the filter read straight past the one
            card that does it. */}
        <Card elevation="md" style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule a recurring job</Text>
          <View style={styles.optionRow}>
            <Option
              label="No"
              active={!snag.repeatDays}
              onPress={() => {
                if (snag.repeatDays) patch({ repeatDays: null });
              }}
              disabled={busy}
            />
            <Option
              label="Yes"
              active={!!snag.repeatDays}
              onPress={() => setRepeatOpen(true)}
              disabled={busy}
            />
          </View>

          {/* The arrangement, in a sentence, on the card rather than behind the
              modal — somebody arriving at this page wants to know what it
              already does, not to re-open the thing that set it. */}
          {snag.repeatDays ? (
            <Pressable
              onPress={() => setRepeatOpen(true)}
              disabled={busy}
              style={styles.repeatSummary}
              accessibilityRole="button"
              accessibilityLabel="Change how often it comes round"
            >
              <Text style={styles.sectionHint}>{describeRepeat(snag)}</Text>
              <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
            </Pressable>
          ) : null}
        </Card>
      </ScrollView>

      {/* ── Save ──
          **It closes; it does not collect.** Every control on this page still
          writes when it is pressed, because triage is a series of small
          independent decisions and a Save button that held them would turn
          sorting twelve jobs into forty taps — and would put the tick you make
          standing in a shop aisle behind a second press.

          So what is it for? Two things this page could not do before. It is a
          **way out that reads as finished**: a back chevron in the header is
          navigation, and somebody who has just set a date and added two parts
          wants somewhere to press that means "done here". And the hint above it
          is the page finally **saying that the taps landed** — nothing ever
          confirmed a write, which is the exact failure the thing page's spec
          sheet was reversed to fix ("the rows called `patch` without the toast
          it takes, so edits saved in silence").

          The hint is honest in both branches rather than always reassuring: the
          due-date box is the one control that holds typed text, and until it is
          committed there *is* something unsaved. Pressing Save commits it
          first — `commitDue` is a no-op when the box matches the row — because
          Save must not be the one button on this page that loses a typed value.

          Last flex child rather than absolutely positioned, so it can never
          overlap the content it belongs to. The keyboard inset is applied here
          because StickyActionBar's own handling is `Keyboard`-based and
          iOS-only, and `Keyboard` is an empty stub in react-native-web — which
          is the build people install. */}
      <View style={{ marginBottom: keyboard }}>
        <StickyActionBar
          hint={unsaved > 0 ? unsavedHint(unsaved) : 'All changes saved'}
          hintTone={unsaved > 0 ? 'warn' : 'muted'}
        >
          <Button label="Save" onPress={saveAndClose} loading={busy} fullWidth />
        </StickyActionBar>
      </View>

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
        title="When's the next one due?"
        onPick={(iso) => {
          setDueOpen(false);
          patch({ dueAt: new Date(`${iso}T00:00:00`).toISOString() });
        }}
        onClose={() => setDueOpen(false)}
      />

      {/* ── How often, and when the next one lands ──
          Behind the Yes rather than on the card, because the card's job is to
          collect a one-word answer and the common answer is no. Two rails and
          a paragraph of explanation used to stand permanently under a heading
          on a page people open constantly, to serve the minority of jobs that
          come round.

          **The date it asks for is the *next* one, not the first.** The rail
          said "When's the first one due?" whatever the job's history, which on
          a filter changed twice already is the app asking a question that was
          answered a year ago. `describeCycle` supplies the words on the third
          preset so the modal and every other screen say "every 6 months" the
          same way — `cycles.test.ts` pins that every interval either list
          offers is a whole number of months or years, precisely so this never
          reads back "every 26 weeks" at somebody who pressed a chip saying
          six months. */}
      <Modal
        visible={repeatOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setRepeatOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setRepeatOpen(false)}
          accessibilityLabel="Close"
        />
        <View style={styles.sheet}>
          <View style={styles.grab} />
          <Text style={styles.sectionTitle}>How often does it come round?</Text>

          <View style={styles.optionRow}>
            {REPEAT_PRESETS.map(({ days, label }) => (
              <Option
                key={days}
                label={label}
                active={snag.repeatDays === days}
                onPress={() =>
                  patch({
                    repeatDays: days,
                    // A repeat with no date on it would never surface. Set one
                    // on the first choice, and leave an existing one alone.
                    dueAt: snag.dueAt ?? new Date(Date.now() + days * DAY_MS).toISOString(),
                  })
                }
                disabled={busy}
              />
            ))}
          </View>

          {snag.repeatDays ? (
            <>
              <Text style={styles.fieldLabel}>When's the next one due?</Text>
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
                {/* The three presets cover the common answers and cannot say
                    "the Saturday we're back", which is the answer often enough
                    that having no way to give it made this rail read as the
                    only dates on offer. Lit whenever the date set is not one
                    the presets would have produced. */}
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

              <Text style={styles.sectionHint}>{describeRepeat(snag)}</Text>

              {/* No cron, no second table, no notifications — and the modal
                  says so, because a thing called "Schedule a recurring job" is
                  exactly what somebody would expect to remind them. */}
              <Text style={styles.sectionHint}>
                Snag doesn't remind anybody. Marking it done schedules the next one instead of
                closing it.
              </Text>
            </>
          ) : null}

          <View style={styles.repeatDone}>
            <Button label="Done" onPress={() => setRepeatOpen(false)} disabled={busy} />
          </View>
        </View>
      </Modal>

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
  // The control that grows the strip lives at the end of it. Sunken and
  // dashed rather than filled: it is an offer, and a solid fern tile among
  // photographs would be the loudest thing on a page whose whole job is the
  // picture.
  photoAdd: {
    width: 130,
    height: 165,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    backgroundColor: Colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  photoAddOff: { opacity: 0.6 },
  photoAddLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.medium,
    color: Colors.primary,
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: Spacing.xs,
  },
  // `minWidth: 0` so a long model number wraps its own line rather than
  // pushing the chevron off the card — the same trap anything flexed beside
  // mono text or a TextInput falls into on web.
  assetBody: { flex: 1, minWidth: 0 },
  // The name is what somebody recognises; the model number is what they came
  // for, so it takes the mono face `Fonts.mono` is spent on — data only, never
  // prose — and sits under the noun rather than competing with it for width.
  assetName: { fontSize: Typography.base, color: Colors.textPrimary },
  assetSpec: {
    fontFamily: Fonts.mono,
    fontSize: Typography.sm,
    color: Colors.textMuted,
  },
  repeatSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  repeatDone: { marginTop: Spacing.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(43, 39, 36, 0.4)' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  grab: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.xs,
  },
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
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.sm },
  commentInput: {
    flex: 1,
    // Anything flexed around a TextInput needs this: on web it is an <input>
    // with an intrinsic ~20-character width that `min-width: auto` will not
    // shrink below, so the box grows past the card and off the screen edge.
    minWidth: 0,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
    // Four lines. `numberOfLines` is an Android-only hint on a multiline
    // TextInput and does nothing on the build people install, so the height is
    // stated: four lines of `Typography.base` plus the vertical padding.
    minHeight: 112,
    maxHeight: 200,
    textAlignVertical: 'top',
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
