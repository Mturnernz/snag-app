import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Image, TextInput, Pressable, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

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
import SupportCard from '../components/SupportCard';
import AskSnagHQSheet from '../components/AskSnagHQSheet';
import DoneDialog from '../components/DoneDialog';
import EditSnagSheet from '../components/EditSnagSheet';
import LinkAssetsSheet from '../components/LinkAssetsSheet';
import { Group, Row, SectionTitle } from '../components/Grouped';
import RepeatSheet from '../components/RepeatSheet';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import {
  getSnag, getComments, addComment, updateSnag, setSnagStatus, deleteSnag, getFileUrls,
  deleteStoredFiles, getSnagAdvice, deleteSnagAdvice, setPartBought,
  getThingNotes, getThings, setSnagThings,
  getSupportRequestForSnag, createSupportRequest, addSupportMessage, closeSupportRequest,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { addPhotos, PhotoSource } from '../lib/addPhotos';
import LinkedText from '../components/LinkedText';
import {
  dayKey, describeCycle, dueState, formatDayFirst, snagHeadline,
  thingHeadline, thingsInArea,
} from '@snag/supabase-queries';
import {
  Comment, LinkedThing, RootStackParamList, Snag, SnagAdvice, SupportRequest, Thing, ThingNote,
  REPEAT_PRESETS,
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

/**
 * `thingHeadline`'s rule, against the trimmed row the view hands over.
 *
 * `LinkedThing` is deliberately not a `Thing` — the card needs a name, a model
 * and a room, and a job carrying whole spec sheets would pay for one per link
 * on a page people open constantly — so the shared helper cannot take it.
 */
function linkedHeadline(thing: LinkedThing): string {
  if (thing.name) return thing.name;
  const spec = [thing.make, thing.model].filter(Boolean).join(' ');
  if (spec) return spec;
  return thing.room ? `Something in the ${thing.room.toLowerCase()}` : 'Something in the house';
}

/**
 * The line under the facts: who filed it when that was somebody else, and when
 * a repeat was last done. Empty when there is nothing to say — your own job
 * filed by you tells you nothing.
 */
function byline(snag: Snag, me: string): string {
  const parts: string[] = [];
  if (snag.reporterId !== me) parts.push(`Added by ${snag.reporterName}`);
  if (snag.lastDoneAt) parts.push(`last done ${new Date(snag.lastDoneAt).toLocaleDateString()}`);
  const line = parts.join(' · ');
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : '';
}

/** The thing page's words for the same fact, so two screens do not invent two. */
function unsavedHint(count: number): string {
  return count === 1 ? '1 unsaved change' : `${count} unsaved changes`;
}

/**
 * The *Repeats* row's value: a preset's own word when the cycle is one
 * (*Monthly*, *Yearly*), otherwise `describeCycle`'s — *Every 8 weeks* — or
 * *Never*.
 */
function repeatLabel(snag: Snag): string {
  if (!snag.repeatDays) return 'Never';
  return REPEAT_PRESETS.find((preset) => preset.days === snag.repeatDays)?.label
    ?? `Every ${describeCycle(snag.repeatDays)}`;
}

/**
 * The row's own line under it — a fact, never commentary, as every V2 row's
 * is: the day it next comes round, because nothing else on the page says it
 * now the due-date box is gone. `dayKey` is the one place an instant becomes a
 * local calendar day, and `formatDayFirst` writes it the way people here do.
 *
 * A repeat with no date never comes up, and choosing a cycle always dates one,
 * so *No date yet* only happens to a row from before; pressing *Every* in the
 * sheet dates it.
 */
function repeatFact(snag: Snag): string | null {
  if (!snag.repeatDays) return null;
  return snag.dueAt ? `Next due ${formatDayFirst(dayKey(snag.dueAt))}` : 'No date yet';
}

export default function SnagDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
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
  /** The latest question asked of SnagHQ about this job, open or not. */
  const [support, setSupport] = useState<SupportRequest | null>(null);
  const [asking, setAsking] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  // Which photo is open full screen, or null. An index rather than a URL, so
  // the viewer's own next/previous walk the same strip.
  const [viewing, setViewing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  /** Whether the note box has the cursor. It opens to four lines while it
   *  does, or while it holds words. */
  const [noteFocused, setNoteFocused] = useState(false);
  const noteOpen = noteFocused || draft.length > 0;
  const [partDraft, setPartDraftState] = useState('');
  const partRef = useRef('');
  const setPartDraft = useCallback((next: string) => {
    partRef.current = next;
    setPartDraftState(next);
  }, []);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Whether the congratulations dialog is up. Only a real finish sets it. */
  const [celebrating, setCelebrating] = useState(false);
  /** Editing what the job says — its words and its room, together. */
  const [editing, setEditing] = useState(false);
  /** Whether the Repeats sheet is up. */
  const [repeating, setRepeating] = useState(false);
  /** The place's record, read when the picker opens rather than on page load. */
  const [things, setThings] = useState<Thing[]>([]);
  const [thingsLoading, setThingsLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const thingsFor = useRef<string | null>(null);
  /** What has been written about the same asset, on its other jobs. */
  const [thingNotes, setThingNotes] = useState<ThingNote[]>([]);

  const load = useCallback(async () => {
    try {
      const [next, nextComments, nextAdvice, nextSupport] = await Promise.all([
        getSnag(params.snagId),
        getComments(params.snagId),
        // Never fatal: a job with no assessment is the resting state, and a
        // read that fails must not take the page down with it.
        getSnagAdvice(params.snagId).catch(() => null),
        // Never fatal either, for the same reason: most jobs were never asked
        // about, and a question nobody can fetch must not hide the job.
        getSupportRequestForSnag(params.snagId).catch(() => null),
      ]);
      setSnag(next);
      setComments(nextComments);
      setAdvice(nextAdvice);
      setSupport(nextSupport);

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
   * What this job says it is about, straight off the row.
   *
   * It used to be `thingsInArea(things, snag.room)` — the room's whole record,
   * printed inline. That answered a question nobody asked and read as things
   * already attached. `snags_with_details.linked_things` is the answer itself,
   * so the card needs no second read to draw itself and cannot drift from what
   * the database holds.
   */
  const linked = snag?.linkedThings ?? [];

  /**
   * The picker reads the place's record, and only when it is opened.
   *
   * A once-in-a-job's-life decision on a page people open constantly: spending
   * a request on every visit to answer a question nobody asked is the waste the
   * inline list already charged. Keyed by the snag's own property, so it can
   * never offer the bach's appliances for a job at the house.
   */
  async function openAssets() {
    if (!snag || busy) return;
    setPicking(true);
    if (thingsFor.current === snag.propertyId) return;
    setThingsLoading(true);
    try {
      setThings(await getThings(snag.propertyId));
      thingsFor.current = snag.propertyId;
    } catch {
      // The sheet still opens, with its own words for an empty record. A failed
      // read here must not be a dead modal.
    } finally {
      setThingsLoading(false);
    }
  }

  /**
   * The room's record, read once the job is known to have a room — for the
   * suggestions on the card. One request, never fatal: a card that cannot
   * suggest anything is still a card, and the picker still opens.
   */
  const roomOf = snag?.room ?? null;
  const placeOf = snag?.propertyId ?? null;
  useEffect(() => {
    if (!roomOf || !placeOf || thingsFor.current === placeOf) return;
    let cancelled = false;
    getThings(placeOf)
      .then((found) => {
        if (cancelled) return;
        thingsFor.current = placeOf;
        setThings(found);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [roomOf, placeOf]);

  /**
   * Up to three things recorded in the job's room and not already linked —
   * offered as one tap each rather than behind the picker. Saying what a job is
   * about was four taps and a sheet; the room is already on the job, so the
   * shortlist a person would pick from is already known.
   */
  const suggested = useMemo(() => {
    if (!roomOf) return [];
    const linkedIds = new Set(linked.map((one) => one.id));
    return thingsInArea(things, roomOf).filter((t) => !linkedIds.has(t.id)).slice(0, 3);
  }, [things, roomOf, linked]);

  /** Replacing the whole set, which is the one call the server offers. */
  async function saveAssets(ids: string[]) {
    if (!snag) return;
    setBusy(true);
    try {
      await setSnagThings(snag.id, ids);
      setSnag(await getSnag(snag.id));
      setPicking(false);
    } catch (err: any) {
      showAlert("Couldn't save that", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  /** The × on a row: the same call, one short. */
  async function unlink(id: string) {
    await saveAssets(linked.filter((one) => one.id !== id).map((one) => one.id));
  }

  /**
   * How much is typed into a box and not yet on the row.
   *
   * One box can be: the item being added to the shopping list. Everything else
   * here wrote when it was pressed, so it is the only thing leaving could still
   * be waiting on — and the only branch in which "All changes saved" would be a
   * lie. (The due-date box was the other, and it is gone.)
   */
  const unsaved = partDraft.trim() ? 1 : 0;

  /**
   * Whatever is sitting in the box, onto the row. **Leaving saves.**
   *
   * There was a Save button for this, and it mostly read *Close*: every
   * control here writes when it is pressed, so the only thing a Save could be
   * waiting on was the item half-typed into the shopping box, which waits on its
   * own *Add* — and on native, pressing a Pressable does not reliably blur a
   * `TextInput`. So the page commits it itself, on the way out and before
   * *Mark done*, and the footer is free for the one action with a consequence.
   */
  async function commitPending(): Promise<boolean> {
    if (!snag) return true;

    // Adding an item is one of the four things that start a job, which is
    // right: deciding what to buy is deciding to do the work. Leaving with a
    // word in the box is adding it.
    const item = partRef.current.trim();
    if (!item) return true;
    const ok = await patch({ parts: [...snag.parts, item] });
    if (ok) setPartDraft('');
    return ok;
  }

  /*
   * Every way off the page goes through `beforeRemove` — the header's back,
   * Android's, a swipe — so none of them can be the one that drops a typed
   * item. Refs rather than state, because the listener is registered once.
   */
  const commitRef = useRef(commitPending);
  commitRef.current = commitPending;
  const unsavedRef = useRef(0);
  unsavedRef.current = unsaved;
  useEffect(() => {
    if (!navigation.addListener) return undefined;
    return navigation.addListener('beforeRemove', (e: any) => {
      if (unsavedRef.current === 0) return;
      e.preventDefault();
      commitRef.current().then((ok) => {
        if (!ok) return;
        unsavedRef.current = 0;
        navigation.dispatch(e.data.action);
      });
    });
  }, [navigation]);

  /** Another angle, or the plate you went back for. */
  async function handleAddPhotos(source: PhotoSource) {
    if (!snag || busy) return;
    setBusy(true);
    try {
      await addPhotos(snag.householdId, async (added) => {
        setSnag(await updateSnag(snag.id, { photoPaths: [...snag.photoPaths, ...added] }));
        showToast(added.length === 1 ? 'Photo added' : `${added.length} photos added`);
      }, source);
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

  /**
   * The checklist's last row, onto the list — on Return and when the box is
   * left. Read through the ref and emptied before the write, because Return
   * and the blur that follows it land in one gesture, before React has
   * re-rendered: reading the state both would see the same word and add it
   * twice.
   */
  /**
   * A choice in the Repeats sheet, onto the row — the rules the chips had,
   * unchanged. A cycle dates an undated job a cycle out and leaves a set date
   * alone; the lit cycle on a repeat with no date dates it; *Never* clears the
   * date with the repeat. A press that would change nothing writes nothing.
   *
   * Not through `patch`, which says a failure in an alert: this throws, so the
   * sheet stays open and says it under the choices, where the press was.
   */
  async function pickRepeat(days: number | null) {
    if (!snag) return;
    let update: Parameters<typeof updateSnag>[1];
    if (days === null) {
      if (!snag.repeatDays && !snag.dueAt) return;
      update = { repeatDays: null, dueAt: null };
    } else {
      if (snag.repeatDays === days && snag.dueAt) return;
      update = {
        repeatDays: days,
        dueAt: snag.dueAt ?? new Date(Date.now() + days * DAY_MS).toISOString(),
      };
    }
    setBusy(true);
    try {
      setSnag(await updateSnag(snag.id, update));
    } finally {
      setBusy(false);
    }
  }

  async function addPart() {
    const item = partRef.current.trim();
    if (!snag || !item || busy) return;
    setPartDraft('');
    await patch({ parts: [...snag.parts, item] });
  }

  async function handleStatus(next: Snag['status']) {
    if (!snag) return;
    // A date or an item still in a box is part of the job being finished.
    if (!(await commitPending())) return;
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

  /**
   * Asking SnagHQ, replying and closing. Each re-reads the question rather
   * than patching it: the status and "seen" line are the server's to decide,
   * and none of the three touches the job itself.
   */
  async function refreshSupport(snagId: string) {
    setSupport(await getSupportRequestForSnag(snagId).catch(() => support));
  }

  async function handleAsk(question: string) {
    if (!snag) return;
    setBusy(true);
    try {
      await createSupportRequest(snag.id, question);
      setAsking(false);
      await refreshSupport(snag.id);
      showToast('Sent to SnagHQ');
    } catch (err: any) {
      showAlert("Couldn't send that", err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSupportReply(body: string): Promise<boolean> {
    if (!snag || !support) return false;
    setBusy(true);
    try {
      await addSupportMessage(support.id, body);
      await refreshSupport(snag.id);
      return true;
    } catch (err: any) {
      showAlert("Couldn't send that", err?.message ?? 'Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSupportClose() {
    if (!snag || !support) return;
    setBusy(true);
    try {
      await closeSupportRequest(support.id);
      await refreshSupport(snag.id);
      showToast('Closed — SnagHQ can no longer see this job');
    } catch (err: any) {
      showAlert("Couldn't close that", err?.message ?? 'Please try again.');
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
      // Nothing to save on a job that no longer exists.
      unsavedRef.current = 0;
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
      {/* ScreenHeader pads the top inset itself; padding here too doubled it. */}
      <View>
        <ScreenHeader
          title={snag.reference}
          onBack={() => navigation.goBack()}
          rightSlot={
            // A 48pt box, not a glyph with `hitSlop`: react-native-web ignores
            // hitSlop, so on the build people install the tap area was the
            // 24pt icon itself, in the screen's top-right corner.
            <Pressable
              onPress={() => setConfirmDelete(true)}
              style={styles.headerAction}
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
            job about the same thing. It inherits every upload rule the thing
            page paid for (see `lib/addPhotos.ts`).

            **Both ways in sit on the first photo**, the camera first. One
            control opened the library and trusted the phone to offer a camera
            from there — Android Chrome does not once several files are
            allowed, so photographing the crack you had just noticed meant
            leaving the app. Then they were photo-sized tiles at the end of the
            strip, which read as empty photo slots and took half the width of a
            phone. Now they are two small buttons on a scrim in the photo's
            corner — **siblings** of the photo's own Pressable, laid over it,
            never inside it, because a Pressable inside a Pressable is a coin
            toss about which one gets the tap. A job with no photo has nothing
            to lay them on, so it gets them as two pills instead.

            Adding one deliberately does not start the job: `v_started` reads
            assignee, due date, repeat and parts, and photographing something is
            not deciding to do it. */}
        {snag.photoPaths.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
            {snag.photoPaths.map((path, i) => (
              <View key={path} style={styles.photoCell}>
                <Pressable
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
                {i === 0 ? (
                  <View style={[styles.photoActions, busy && styles.photoAddOff]}>
                    <Pressable
                      onPress={() => handleAddPhotos('camera')}
                      disabled={busy}
                      style={styles.photoAction}
                      accessibilityRole="button"
                      accessibilityLabel="Take a photo"
                    >
                      <Icon name="camera-outline" size="md" color={Colors.white} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleAddPhotos('library')}
                      disabled={busy}
                      style={styles.photoAction}
                      accessibilityRole="button"
                      accessibilityLabel="Choose photos"
                    >
                      <Icon name="images-outline" size="md" color={Colors.white} />
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.photoPills}>
            <Pressable
              onPress={() => handleAddPhotos('camera')}
              disabled={busy}
              style={styles.suggestTap}
              accessibilityRole="button"
              accessibilityLabel="Take a photo"
            >
              <View style={[styles.suggestChip, busy && styles.photoAddOff]}>
                <Icon name="camera-outline" size="sm" color={Colors.primary} />
                <Text style={styles.suggestText}>Take photo</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => handleAddPhotos('library')}
              disabled={busy}
              style={styles.suggestTap}
              accessibilityRole="button"
              accessibilityLabel="Choose photos"
            >
              <View style={[styles.suggestChip, busy && styles.photoAddOff]}>
                <Icon name="images-outline" size="sm" color={Colors.primary} />
                <Text style={styles.suggestText}>Choose photos</Text>
              </View>
            </Pressable>
          </View>
        )}

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

        {/* ── The facts at the top ──
            What state it is in, which room, and — for a repeat — when it next
            comes round. The room is a pill with a ▾, because it is the one of
            the three that opens something: the same sheet the pencil does,
            never a second way to write. One writer per fact. It was grey words
            beside a pin, which read as a caption rather than a control.

            **The due date is stated, never offered.** A one-off job does not
            get a date any more; only a repeat carries one, set a cycle out by
            the Repeats chips at the foot of the page. So the badge appears when
            there is a date and is not a control, and there is no *No date* chip
            — asking for a date nothing on the page can set would be a door to
            nowhere.

            Status is deliberately not a control either. It is derived — a job
            starts when somebody decides what to buy or sets a repeat — and the
            one state change made by hand is *Mark done*, at the foot. Each
            badge sits in the same 48pt centred box, because `StatusBadge`
            aligns itself to the top of whatever row it is in and read higher
            than its neighbours. */}
        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <StatusBadge status={snag.status} />
          </View>

          {dueState(snag) !== 'none' ? (
            <View style={styles.metaChip}>
              <DueBadge snag={snag} />
            </View>
          ) : null}

          <Pressable
            onPress={() => setEditing(true)}
            disabled={busy}
            style={styles.metaChip}
            accessibilityRole="button"
            accessibilityLabel={snag.room ? `In the ${snag.room} — change it` : 'Say which room'}
          >
            <View style={styles.roomPill}>
              <Icon name="location-outline" size="sm" color={Colors.textSecondary} />
              <Text style={styles.roomPillText}>{snag.room || 'No room'}</Text>
              <Icon name="chevron-down" size="sm" color={Colors.textMuted} />
            </View>
          </Pressable>
        </View>

        {/* Who filed it is news only when it was somebody else — with no
            notifications, "Added by Sam" is how you learn the other person put
            it here; "Added by you" told you what you already knew. The last
            finish of a repeat is kept either way. */}
        {byline(snag, profile.id) ? (
          <Text style={styles.reportedBy}>{byline(snag, profile.id)}</Text>
        ) : null}

        {/* ── Notes ──
            The first thing under the facts, above every control. What the
            other person wrote is the reason this screen was opened — "ordered
            the part, arriving Tuesday" is the whole answer — so the notes and
            Ask SnagHQ sit above *Items and shopping*, by the owner's decision
            after the September 2026 design review. */}
        <View style={styles.block}>
          <SectionTitle title={comments.length > 0 ? `Notes (${comments.length})` : 'Notes'} />
          <Card elevation="md" style={styles.card}>
            {comments.map((comment, index) => (
              <View key={comment.id} style={[styles.comment, index === 0 && styles.commentFirst]}>
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
            {/* One line until it is used, then four. It was a four-line box
                with *Add note* under it on every job, which is a card of mostly
                empty space on a page that is mostly read — so it rests as one
                line and opens to four lines the moment somebody taps it, which
                is the moment the room is needed: this is the only channel by
                which one person tells the other anything, and a slot showing
                eight words of itself gets a message written shorter than it
                needed to be. It stays open while it holds words.

                *Add note* appears with it, and stays a word under the box
                rather than a send arrow beside it: this is not a chat. A note is
                never sent on blur — it is a message to somebody, and a
                half-written one posted because a thumb touched the photo would
                also start the job (`add_comment` moves it to doing).

                The placeholder names what the box is for rather than showing a
                message somebody might have sent. An example reads as something
                already entered — which on the one box holding what the other
                person said is the worst place for it. */}
            <View style={styles.commentBox}>
              <TextInput
                style={[styles.commentInput, !noteOpen && styles.commentInputShut]}
                value={draft}
                onChangeText={setDraft}
                onFocus={() => setNoteFocused(true)}
                onBlur={() => setNoteFocused(false)}
                placeholder="Add a note, or what you did"
                placeholderTextColor={Colors.textMuted}
                multiline
                numberOfLines={noteOpen ? 4 : 1}
                maxLength={4000}
                accessibilityLabel="Add a note"
              />
              {noteOpen ? (
                <View style={styles.commentActions}>
                  <Pressable
                    onPress={handleComment}
                    disabled={!draft.trim() || busy}
                    style={[styles.commentSend, (!draft.trim() || busy) && styles.commentSendOff]}
                    accessibilityRole="button"
                    accessibilityLabel="Add note"
                  >
                    <Text
                      style={[
                        styles.commentSendLabel,
                        (!draft.trim() || busy) && styles.commentSendLabelOff,
                      ]}
                    >
                      Add note
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </Card>
        </View>

        {/* ── Asked SnagHQ ──
            One button, directly under the notes. Asking somebody at SnagHQ is
            the same kind of act as leaving a note — words about this job, for
            somebody else to read — so it sits with the conversation rather
            than between the shopping list and it.

            **A button, full width and outlined**, never a card of suggested
            questions. SnagHQ is a person who reads the job, not a model, and a
            panel of prompts on every job would be the page advertising a
            service rather than showing the job. Outlined because *Mark done*
            is the one filled button here. Once a question exists, its thread
            takes this slot. */}
        {support ? (
          <SupportCard
            request={support}
            busy={busy}
            onReply={handleSupportReply}
            onClose={handleSupportClose}
            onAskAgain={() => setAsking(true)}
          />
        ) : (
          <Button
            label="Ask SnagHQ about this"
            variant="outline"
            icon="chatbubbles-outline"
            onPress={() => setAsking(true)}
            fullWidth
            style={styles.askButton}
          />
        )}

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
          <View style={styles.block}>
            <SectionTitle title={`Also said about ${snag.thingName ?? 'it'}`} />
            <Card elevation="md" style={styles.card}>
              {thingNotes.map((note, index) => (
                <Pressable
                  key={note.id}
                  onPress={() => navigation.push('SnagDetail', { snagId: note.snagId })}
                  style={[styles.comment, index === 0 && styles.commentFirst]}
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
          </View>
        ) : null}

        {/* ── Items and shopping ──
            One card, two halves: what the job is about, and what to get for
            it. They were two cards, each with its own heading and its own
            bulky add control, on a page that is mostly read. They stay two
            *facts* — each half keeps its own heading, split by a rule — because
            they behave differently: linking an item never starts the job
            (`set_snag_things` touches neither `status` nor `updated_at`), and
            adding something to pick up does (`v_started`), and puts it on the
            trip sheet. The shopping half comes first and the linked items last,
            by the owner's decision.

            **Add to shopping list** is a checklist: a row per item, ticked when
            bought, and one more row at the foot to add to it. That row is a box
            with a + rather than a box and an *Add* button: it adds on Return,
            when it is left, and when the page is — the saving rule everywhere
            outside Projects. Ticking is not adding: `set_part_bought` touches
            neither the status nor `updated_at`, and is a separate function
            precisely so it cannot. The trip to the shop is the single most
            common reason a small job sits for weeks, which is why this is the
            part of the page that moves work.

            **Linked items is what the job is about, not what the room holds.**
            A list of what is *selected* belongs on the page; a list of what
            *could be* belongs behind a control (`LinkAssetsSheet`). It holds
            many rather than one: a leak under the sink is about the mixer *and*
            the waste trap. The room's own things are offered as pills on a line
            of their own under the words saying where they came from — inline
            after the words they wrapped half under them. */}
        <View style={styles.block}>
          <SectionTitle title="Items and shopping" />
          <Card elevation="md" style={styles.card}>
            <Text style={styles.halfTitle}>Add to shopping list</Text>
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
            {/* The last row of the checklist is how it grows. The words in it
                say what it does, because there is no button beside it to. */}
            <View style={styles.partAddRow}>
              <View style={styles.partTick}>
                <Icon name="add" size="sm" color={Colors.primary} />
              </View>
              <TextInput
                style={styles.partInput}
                value={partDraft}
                onChangeText={setPartDraft}
                placeholder="Add something to pick up"
                placeholderTextColor={Colors.textMuted}
                maxLength={60}
                returnKeyType="done"
                onSubmitEditing={addPart}
                onBlur={addPart}
                blurOnSubmit={false}
                accessibilityLabel="Something to pick up"
              />
            </View>

            <View style={styles.halfRule} />

            <View style={styles.halfHead}>
              <Text style={styles.halfTitle}>
                {linked.length > 0 ? `Linked items (${linked.length})` : 'Linked items'}
              </Text>
              <Pressable
                onPress={openAssets}
                disabled={busy}
                style={styles.assetAdd}
                accessibilityRole="button"
                accessibilityLabel={linked.length > 0 ? 'Add item' : 'Link an item from the house'}
              >
                <Icon name="add" size="sm" color={Colors.primary} />
                <Text style={styles.assetAddLabel}>
                  {linked.length > 0 ? 'Add item' : 'Link an item'}
                </Text>
              </Pressable>
            </View>

            {linked.map((item) => (
              <View key={item.id} style={styles.assetRow}>
                <Pressable
                  onPress={() => navigation.navigate('ThingDetail', { thingId: item.id })}
                  style={styles.assetOpen}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${linkedHeadline(item)}`}
                >
                  <Icon name="cube-outline" size="sm" color={Colors.textMuted} />
                  <View style={styles.assetBody}>
                    <Text style={styles.assetName} numberOfLines={1}>
                      {linkedHeadline(item)}
                    </Text>
                    {item.make || item.model ? (
                      <Text style={styles.assetSpec} numberOfLines={1}>
                        {[item.make, item.model].filter(Boolean).join(' ')}
                      </Text>
                    ) : null}
                  </View>
                  {item.room ? <Text style={styles.assetRoom}>{item.room}</Text> : null}
                  <Icon name="chevron-forward" size="sm" color={Colors.textMuted} />
                </Pressable>
                {/* A sibling of the door rather than a child of it — a
                    Pressable inside a Pressable is a coin toss about which one
                    gets the tap, the rule the photo already pays. */}
                <Pressable
                  onPress={() => unlink(item.id)}
                  disabled={busy}
                  style={styles.assetClear}
                  accessibilityRole="button"
                  accessibilityLabel={`Unlink ${linkedHeadline(item)}`}
                >
                  <Icon name="close" size="sm" color={Colors.textMuted} />
                </Pressable>
              </View>
            ))}

            {/* Offers, so they look like offers: the sunken chip, a +, and the
                words above saying where they came from. Tapping one links it —
                the same `set_snag_things` the picker writes through. */}
            {suggested.length > 0 ? (
              <View>
                <Text style={styles.suggestLabel}>{`In the ${roomOf!.toLowerCase()}:`}</Text>
                <View style={styles.suggestRow}>
                  {suggested.map((thing) => (
                    <Pressable
                      key={thing.id}
                      onPress={() => saveAssets([...linked.map((one) => one.id), thing.id])}
                      disabled={busy}
                      style={styles.suggestTap}
                      accessibilityRole="button"
                      accessibilityLabel={`Link ${thingHeadline(thing)}`}
                    >
                      <View style={styles.suggestChip}>
                        <Icon name="add" size="sm" color={Colors.primary} />
                        <Text style={styles.suggestText} numberOfLines={1}>{thingHeadline(thing)}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </Card>
        </View>

        {/* ── What came back ──
            Directly under the items card, whose first half is the shopping
            list, because a suggested part is an offer with a + beside it —
            accepting one is what puts it on that list, and that tap is what
            starts the job. A card whose suggestions land two cards away is one
            nobody connects to anything. */}
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

        {/* ── Repeats ──
            The last section, and the only date control left on the page.

            **A one-off job has no due date any more.** There was a date box
            here with *This weekend* and *Next week* beside it; it came off by
            the owner's decision after the September 2026 design review. The job
            that comes round — the filter, the gutters — still has a date, and
            that date is the repeat's to set.

            **It is one row that opens a sheet** — *Repeats … Never ›* — by the
            owner's decision, where it was a rail of five chips taking three
            lines. The row states the answer and the day it next comes round;
            `RepeatSheet` holds the choice — *Never*, or *Every n days, weeks,
            months or years*. Taps write when pressed and the number when it is
            left, and opening the sheet and closing it again writes nothing:
            the trap the old modal behind a *Yes* set does not come back.

            What a write does is unchanged. A cycle dates an undated job a
            cycle out and leaves a date already set alone (a heat pump's service
            arrives from the thing page already dated). **Never clears the date
            as well as the repeat**: with no box to clear it from, a date a
            stopped repeat left behind would sit under *Due soon* and go overdue
            for ever. Pressing *Every* on a repeat with no date dates it — the
            only way such a row, from before, can come round.

            A repeat is one of the four things that start a job, which is right:
            deciding it comes round is deciding to do it. */}
        <Group style={styles.repeatGroup}>
          <Row
            title="Repeats"
            value={repeatLabel(snag)}
            tone={snag.repeatDays ? 'default' : 'muted'}
            subtitle={repeatFact(snag)}
            onPress={() => setRepeating(true)}
            accessibilityLabel={`Repeats: ${repeatLabel(snag)}`}
          />
        </Group>
      </ScrollView>

      {/* ── Mark done ──
          The one state change a person still makes by hand, in the footer where
          a thumb finds it without scrolling past every card. It used to sit at
          the foot of the scroll with a Save/Close in this bar — and that Save
          mostly read *Close*, beside a back arrow that already did the same.
          Leaving saves now (see `commitPending`), so the bar holds the action
          with a consequence, and the hint says whether a box is still holding
          something that will be kept on the way out. */}
      <View style={{ marginBottom: keyboard }}>
        <StickyActionBar
          hint={unsaved > 0 ? `${unsavedHint(unsaved)} — kept when you leave` : 'All changes saved'}
          hintTone={unsaved > 0 ? 'warn' : 'muted'}
        >
          {snag.status !== 'done' ? (
            <Button
              label="Mark done"
              onPress={() => handleStatus('done')}
              loading={busy}
              icon="checkmark-circle-outline"
              fullWidth
            />
          ) : (
            <Button
              label="Reopen"
              variant="outline"
              onPress={() => handleStatus('open')}
              loading={busy}
              fullWidth
            />
          )}
        </StickyActionBar>
      </View>

      <PhotoViewer
        visible={viewing !== null}
        photos={snag.photoPaths.map((path) => photoUrls[path]).filter(Boolean)}
        startIndex={viewing ?? 0}
        onClose={() => setViewing(null)}
      />

      <RepeatSheet
        visible={repeating}
        current={snag.repeatDays}
        onPick={pickRepeat}
        onClose={() => setRepeating(false)}
      />

      <AskSnagHQSheet
        visible={asking}
        busy={busy}
        onSend={handleAsk}
        onCancel={() => setAsking(false)}
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

      <LinkAssetsSheet
        visible={picking}
        things={things}
        loading={thingsLoading}
        linkedIds={linked.map((one) => one.id)}
        room={snag.room}
        locations={locations}
        busy={busy}
        onSave={saveAssets}
        onCancel={() => setPicking(false)}
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

const styles = StyleSheet.create({
  askButton: { marginTop: Spacing.lg },
  flex: { flex: 1, backgroundColor: Colors.background },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  photoStrip: { marginBottom: Spacing.sm },
  photoAddOff: { opacity: 0.6 },
  assetAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingLeft: Spacing.sm,
  },
  assetAddLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
  },
  assetOpen: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: Spacing.xs,
  },
  assetClear: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assetRoom: { fontSize: Typography.xs, color: Colors.textMuted },
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
  headerAction: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  suggestLabel: { fontSize: Typography.sm, color: Colors.textMuted, marginTop: Spacing.xs },
  suggestTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', maxWidth: '100%' },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    minHeight: 34,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  suggestText: { fontSize: Typography.sm, color: Colors.textSecondary, flexShrink: 1 },
  photo: {
    width: 220,
    height: 165,
    borderRadius: Radius.card,
    backgroundColor: Colors.border,
  },
  photoCell: { marginRight: Spacing.sm },
  // Two buttons on a scrim in the first photo's corner. The scrim is the
  // palette's `photoOverlay` for the reason every chip laid over a photograph
  // takes it: a photo is not a background anybody can pick a colour against.
  // Each button is the full 48pt target; the pill is exactly the two of them.
  photoActions: {
    position: 'absolute',
    right: Spacing.sm,
    bottom: Spacing.sm,
    flexDirection: 'row',
    borderRadius: Radius.pill,
    backgroundColor: Colors.photoOverlay,
    overflow: 'hidden',
  },
  photoAction: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPills: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.sm },
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
  // The pill and its tap area are different sizes on purpose, as everywhere
  // else a chip row appears in this app: the visible thing stays a badge so it
  // does not outweigh the headline above it, and the Pressable around it
  // carries the minimum target.
  metaChip: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  // The app's one chip: a sunken well, no border, ~30pt inside the 48pt
  // Pressable around it. The ▾ says it opens something.
  roomPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 30,
    paddingHorizontal: Spacing.sm + 2,
    borderRadius: Radius.button,
    backgroundColor: Colors.sunken,
  },
  roomPillText: { fontSize: Typography.sm, color: Colors.textSecondary },
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
  // A section: the V2 title on the plaster, then its white card. The gap
  // between sections is the V2 screens' 28 (20 here plus the content's 8).
  block: { marginTop: Spacing.xl, gap: Spacing.sm + 2 },
  card: { gap: Spacing.sm },
  // The two halves of the items card: each keeps its own heading, a rule
  // between them, because they are two facts that behave differently.
  halfHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  halfTitle: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
  },
  halfRule: {
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: Colors.separator,
    marginVertical: Spacing.xs,
  },
  // The Repeats row: a V2 group of one, the page's last thing. 28 under the
  // items card, as between every other section.
  repeatGroup: { marginTop: Spacing.xl },
  // The shopping list. Rows read like a list you'd scan in an aisle; the field
  // below is how you add to it, and is the only text input on this screen
  // besides a note.
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
  // The checklist's last row: no well and no border, the words of an item
  // where the next item's words will go. `minWidth: 0` because on web a
  // TextInput is an <input> that will not shrink below ~20 characters.
  partInput: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  // Neutral rather than faded when there is nothing to add: fern at half
  // strength is a pale sage that reads as broken rather than as not-ready.
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
  // The first note sits at the top of its card now that the heading is above
  // the card rather than in it, so a rule over it would divide it from nothing.
  commentFirst: { borderTopWidth: 0, paddingTop: 0 },
  commentAuthor: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
  },
  commentDate: { fontWeight: Typography.regular, color: Colors.textMuted },
  commentBody: { fontSize: Typography.base, color: Colors.textPrimary },
  commentBox: { gap: Spacing.sm },
  // One line at rest: the box's own padding plus a line of `Typography.base`,
  // at the 48pt a control needs to be tapped.
  commentInputShut: { minHeight: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET },
  commentActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  commentInput: {
    // Full width, with the control underneath rather than beside it. Nothing
    // is flexed around it any more, so the `minWidth: 0` that a flexed
    // TextInput needs on web is no longer load-bearing here — it is kept
    // because an <input>'s intrinsic ~20-character width is still what a
    // narrow phone would otherwise measure against.
    //
    // A sunken well with no border, like the shopping box above it. It was the
    // one box on the page drawn plaster-with-a-border, so the page had two
    // styles of box and this one read as a different kind of control.
    minWidth: 0,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    backgroundColor: Colors.sunken,
    // Four lines. `numberOfLines` is an Android-only hint on a multiline
    // TextInput and does nothing on the build people install, so the height is
    // stated: four lines of `Typography.base` plus the vertical padding.
    minHeight: 112,
    maxHeight: 200,
    textAlignVertical: 'top',
  },
  commentSend: {
    minWidth: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.input,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Neutral, not a faded fern — see the note on Button's disabled state. Half
  // strength on this ground is a pale sage that reads as broken.
  commentSendOff: { backgroundColor: Colors.sunken },
  commentSendLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
  commentSendLabelOff: { color: Colors.textMuted },
});
