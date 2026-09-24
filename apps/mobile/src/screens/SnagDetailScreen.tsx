import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import StickyActionBar from '../components/StickyActionBar';
import PhotoViewer from '../components/PhotoViewer';
import AdviceCard from '../components/AdviceCard';
import DoneDialog from '../components/DoneDialog';
import EditSnagSheet from '../components/EditSnagSheet';
import DateField from '../components/DateField';
import LinkAssetsSheet from '../components/LinkAssetsSheet';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import {
  getSnag, getComments, addComment, updateSnag, setSnagStatus, deleteSnag, getFileUrls,
  deleteStoredFiles, getSnagAdvice, deleteSnagAdvice, setPartBought,
  getThingNotes, getThings, setSnagThings,
} from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { addPhotos, PhotoSource } from '../lib/addPhotos';
import LinkedText from '../components/LinkedText';
import {
  dayKey, describeCycle, dueState, formatDayFirst, parseLooseDate, snagHeadline,
  thingHeadline, thingsInArea,
} from '@snag/supabase-queries';
import {
  Comment, LinkedThing, RootStackParamList, Snag, SnagAdvice, Thing, ThingNote, REPEAT_PRESETS,
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
 * The due date as the box shows it: the local day, day first.
 *
 * It was `formatLooseDate`, which is built for date columns and reads a
 * timestamp's day as nothing — so a job due on the 8th showed back as
 * "Nov 2026", a precision the person who picked the 8th never asked to lose.
 * `dayKey` is the one place an instant becomes a local calendar day.
 */
function dueText(dueAt: string | null): string {
  return dueAt ? formatDayFirst(dayKey(dueAt)) : '';
}

/** Local midnight, `days` from today. */
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

/** The coming Saturday — today, if today is one. */
function thisWeekend(): Date {
  const today = new Date().getDay();
  return daysFromNow((6 - today + 7) % 7);
}

/**
 * The two dates people give a household job most often, a tap away. Anything
 * else is typed, or picked from the calendar in the box.
 */
const QUICK_DATES: { label: string; at: () => Date }[] = [
  { label: 'This weekend', at: thisWeekend },
  { label: 'Next week', at: () => daysFromNow(7) },
];

/**
 * The repeat chips: the presets, plus whatever the job already carries when it
 * is not one of them — a heat pump serviced every two years arrives from the
 * thing page with 730 days, and a row that could not show it would read as
 * *Never*.
 */
function repeatChoices(current: number | null): { days: number; label: string }[] {
  const presets = REPEAT_PRESETS.map(({ days, label }) => ({ days, label }));
  if (current && !presets.some((p) => p.days === current)) {
    presets.push({ days: current, label: `Every ${describeCycle(current)}` });
  }
  return presets;
}

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

/** The thing page's words for the same fact, so two screens do not invent two. */
function unsavedHint(count: number): string {
  return count === 1 ? '1 unsaved change' : `${count} unsaved changes`;
}

/**
 * The arrangement, in one sentence.
 *
 * **It no longer repeats the date.** The due-date field sits directly above
 * this card, so "Due 8/10/2026, then every 6 months" put the same day on
 * screen twice, a card apart — which read as two date controls stacked and had
 * somebody asking which one was real. The date is stated once, where it can be
 * changed; this says only the part that field cannot: what happens next.
 */
function describeRepeat(snag: Snag): string {
  if (!snag.repeatDays) return '';
  const every = describeCycle(snag.repeatDays);
  if (!snag.dueAt) return `Set a date, then marking it done brings it back every ${every}.`;
  return `Marking it done brings it back every ${every}.`;
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
  const [partDraft, setPartDraftState] = useState('');
  const partRef = useRef('');
  const setPartDraft = useCallback((next: string) => {
    partRef.current = next;
    setPartDraftState(next);
  }, []);
  /**
   * What is in the due-date box, as typed.
   *
   * A string rather than the snag's own `dueAt`, because a half-typed date is
   * not a date yet: `8/1` on the way to `8/11/2019` parses to the eighth of
   * January, and a field that wrote on every keystroke would file the job under
   * it. It is committed on blur and re-seeded whenever the row changes.
   */
  const [dueDraft, setDueDraftState] = useState('');
  /**
   * The same string, readable synchronously. The calendar writes the box and
   * commits in one gesture, before React has re-rendered with the new value —
   * so a commit reading the state it closed over saw the old date and wrote
   * nothing.
   */
  const dueRef = useRef('');
  const setDueDraft = useCallback((next: string) => {
    dueRef.current = next;
    setDueDraftState(next);
  }, []);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Whether the congratulations dialog is up. Only a real finish sets it. */
  const [celebrating, setCelebrating] = useState(false);
  /** Editing what the job says — its words and its room, together. */
  const [editing, setEditing] = useState(false);
  /** The place's record, read when the picker opens rather than on page load. */
  const [things, setThings] = useState<Thing[]>([]);
  const [thingsLoading, setThingsLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const thingsFor = useRef<string | null>(null);

  /* The due chip up in the meta row is a way in, not a second control, so it
     has to reach the one field that writes the date. `onLayout` on a direct
     child of the content container reports y against that container, which is
     exactly what `scrollTo` wants — no `measureLayout`, which needs a node
     handle react-native-web would rather not give. */
  const scrollRef = useRef<ScrollView>(null);
  const dueY = useRef(0);
  const goToDue = useCallback(() => {
    scrollRef.current?.scrollTo({ y: Math.max(0, dueY.current - Spacing.lg), animated: true });
  }, []);
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
      setDueDraft(dueText(next.dueAt));
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
      setDueDraft(dueText(snag.dueAt));
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
    const typed = dueRef.current.trim();
    if (typed === dueText(snag.dueAt)) return undefined;
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
  void dueDraft; // read through dueRef; the state is what re-renders the count

  /**
   * Whatever is sitting in a box, onto the row. **Leaving saves.**
   *
   * There was a Save button for this, and it mostly read *Close*: every
   * control here writes when it is pressed, so the only things a Save could be
   * waiting on were the two boxes — the date, whose `onBlur` is not guaranteed
   * to fire (on native, pressing a Pressable does not reliably blur a
   * `TextInput`), and the item half-typed into the shopping box, which waits on
   * its own `+`. So the page commits them itself, on the way out and before
   * *Mark done*, and the footer is free for the one action with a consequence.
   *
   * **One write, not two.** A date and an item both pending are one
   * `update_snag`. A date no calendar has holds the page open with the words
   * still in the box, rather than leaving over something it did not take.
   */
  async function commitPending(): Promise<boolean> {
    if (!snag) return true;
    const update: Parameters<typeof updateSnag>[1] = {};
    const due = pendingDue();
    if (due?.unreadable) {
      showAlert("Couldn't read that date", 'Try 8/11/2019, Nov 2019, or tap the calendar.');
      return false;
    }
    if (due) update.dueAt = due.dueAt;

    // Adding an item is one of the four things that start a job, which is
    // right: deciding what to buy is deciding to do the work. Leaving with a
    // word in the box is adding it.
    const item = partRef.current.trim();
    if (item) update.parts = [...snag.parts, item];

    if (Object.keys(update).length === 0) return true;
    const ok = await patch(update);
    if (ok) setPartDraft('');
    return ok;
  }

  /*
   * Every way off the page goes through `beforeRemove` — the header's back,
   * Android's, a swipe — so none of them can be the one that drops a typed
   * date. Refs rather than state, because the listener is registered once.
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

  async function addPart() {
    const item = partDraft.trim();
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
        ref={scrollRef}
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

          {/* Two tiles, the camera first. One tile opened the library and
              trusted the phone to offer a camera from there — Android Chrome
              does not once several files are allowed, so photographing the
              crack you had just noticed meant leaving the app. */}
          <Pressable
            onPress={() => handleAddPhotos('camera')}
            disabled={busy}
            style={[styles.photoAdd, busy && styles.photoAddOff]}
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
          >
            <Icon name="camera-outline" size="md" color={Colors.primary} />
            <Text style={styles.photoAddLabel}>Take photo</Text>
          </Pressable>
          <Pressable
            onPress={() => handleAddPhotos('library')}
            disabled={busy}
            style={[styles.photoAdd, busy && styles.photoAddOff]}
            accessibilityRole="button"
            accessibilityLabel="Choose photos"
          >
            <Icon name="images-outline" size="md" color={Colors.primary} />
            <Text style={styles.photoAddLabel}>Choose photos</Text>
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

        {/* ── The three facts, and a way in to each ──
            What it is, when it is due and which room it is in are what
            somebody wants off the top of this page — and two of the three had
            their one control most of a screen further down. So the row states
            all three, and the two a person actually sets are a **way in**
            rather than a second way to write: the due chip scrolls to the date
            field, the room chip opens the same sheet the pencil does. One
            writer per fact. A chip that set the date itself would be the
            duplicate date control this page has already been through once.

            Status is deliberately not one of them. It is derived — a job
            starts when somebody dates it or decides what to buy — and the one
            state change made by hand is *Mark done*, which sits at the foot
            because finishing is the last thing that happens. A tappable status
            chip up here would be that button arriving at the top by another
            door.

            Both chips say what they are for when the fact is missing rather
            than rendering nothing: a snag with no date and no room is the
            weakest thing this app can hold, and an empty row says so where a
            row of two badges quietly doesn't. */}
        <View style={styles.metaRow}>
          <StatusBadge status={snag.status} />

          <Pressable
            onPress={goToDue}
            style={styles.metaChip}
            accessibilityRole="button"
            accessibilityLabel={
              dueState(snag) === 'none' ? 'Give it a date' : "Change when it's due"
            }
          >
            {dueState(snag) === 'none' ? (
              <View style={styles.metaItem}>
                <Icon name="calendar-outline" size="sm" color={Colors.textMuted} />
                <Text style={styles.metaText}>No date</Text>
              </View>
            ) : (
              <DueBadge snag={snag} />
            )}
          </Pressable>

          <Pressable
            onPress={() => setEditing(true)}
            disabled={busy}
            style={styles.metaChip}
            accessibilityRole="button"
            accessibilityLabel={snag.room ? `In the ${snag.room} — change it` : 'Say which room'}
          >
            <View style={styles.metaItem}>
              <Icon name="location-outline" size="sm" color={Colors.textMuted} />
              <Text style={styles.metaText}>{snag.room || 'No room'}</Text>
            </View>
          </Pressable>
        </View>

        <Text style={styles.reportedBy}>
          Added by {snag.reporterId === profile.id ? 'you' : snag.reporterName}
          {snag.lastDoneAt ? ` · last done ${new Date(snag.lastDoneAt).toLocaleDateString()}` : ''}
        </Text>



        {/* ── Linked assets ──
            **What the job is about, not what the room holds.** This card
            printed the whole room's record inline — nine appliances, a screen
            of vertical rent on a page people open constantly — which read as
            nine things already attached to this snag when it was really the
            inventory answering a question nobody had asked. A list of what is
            *selected* belongs on the page; a list of what *could be* belongs
            behind a control. See `LinkAssetsSheet`.

            It holds many now rather than one: a leak under the sink is about
            the mixer *and* the waste trap. `home.snag_things` carries it, and
            saying so still does not start the job — that is the tail of
            capture, and `set_snag_things` touches neither `status` nor
            `updated_at`.

            The room chip on each row is what makes the card legible without
            opening anything: the noun, the model somebody came to read, and
            where it is. */}
        <Card elevation="md" style={styles.section}>
          <View style={styles.assetHead}>
            <Text style={styles.sectionTitle}>
              {linked.length > 0 ? `Linked items (${linked.length})` : 'Linked items'}
            </Text>
            {linked.length > 0 ? (
              <Pressable
                onPress={openAssets}
                disabled={busy}
                style={styles.assetAdd}
                accessibilityRole="button"
                accessibilityLabel="Add item"
              >
                <Icon name="add" size="sm" color={Colors.primary} />
                <Text style={styles.assetAddLabel}>Add item</Text>
              </Pressable>
            ) : null}
          </View>

          {linked.length === 0 ? (
            /* Dashed rather than filled, for the reason a House-tab suggestion
               is dashed: it is an offer, and nothing is wrong with a job that
               never takes it. Most jobs are about nothing in the record. */
            <Pressable
              onPress={openAssets}
              disabled={busy}
              style={styles.assetEmpty}
              accessibilityRole="button"
              accessibilityLabel="Link an item from the house"
            >
              <Icon name="add" size="sm" color={Colors.primary} />
              <Text style={styles.assetAddLabel}>Link an item from the house</Text>
            </Pressable>
          ) : (
            linked.map((item) => (
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
                    gets the tap, the rule the photo tile already pays. */}
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
            ))
          )}

          {/* Offers, so they look like offers: the sunken chip, a +, and a
              label saying where they came from. Tapping one links it — the
              same `set_snag_things` the picker writes through. */}
          {suggested.length > 0 ? (
            <View style={styles.suggestRow}>
              <Text style={styles.suggestLabel}>{`In the ${roomOf!.toLowerCase()}:`}</Text>
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
          ) : null}
        </Card>

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
            {/* A word rather than a bare +. The box beside it takes a noun
                nobody has typed before, so the control next to it has to say
                what pressing it does — and the + was a 48px target carrying no
                label on the one card that is a list somebody adds to. */}
            <Pressable
              onPress={addPart}
              disabled={busy || !partDraft.trim()}
              style={[styles.partAdd, (busy || !partDraft.trim()) && styles.partAddOff]}
              accessibilityRole="button"
              accessibilityLabel="Add to the shopping list"
            >
              <Text
                style={[
                  styles.partAddLabel,
                  (busy || !partDraft.trim()) && styles.partAddLabelOff,
                ]}
              >
                Add
              </Text>
            </Pressable>
          </View>
        </Card>

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
          {/* An ordinary multiline box with its own control underneath, not a
              chat row. Four lines, not one: this is the only channel by which
              one person tells the other anything — there are no notifications
              and never will be — and a slot showing eight words of itself gets
              a message written shorter than it needed to be.

              The box is full width and the button sits under it, because a
              48px square vertically centred against a 112px box is a *chat*
              affordance and this is not a chat. It is the same correction the
              shopping list's `+` already took: a word rather than a glyph, on
              the one control that commits what somebody has just written.

              The placeholder names what the box is for rather than showing a
              message somebody might have sent. "Ordered the part, arriving
              Tuesday" is an example, and this app's rule about example values
              is that they read as something already entered — which on the one
              box holding what the other person said is the worst place for it.
              A placeholder earns its place by saying something an example never
              could. */}
          <View style={styles.commentBox}>
            <TextInput
              style={styles.commentInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a note, or what you did"
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={4}
              maxLength={4000}
              accessibilityLabel="Add a note"
            />
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

        {/* ── When ──
            One card for one fact. The date and the repeat used to be two cards
            and a modal, and the modal asked "When's the next one due?" with a
            second set of date controls writing the same `due_at` as the box
            above it — so which date was real was a fair question to ask. And
            *Yes* opened the modal without saying anything, so dismissing it
            left *No* lit.

            Now: the date, typed or tapped, with the two answers people give
            most often a tap away; then how often it comes round, as one row of
            chips that writes when pressed. Setting up a repeat is one tap —
            and a repeat with no date would never surface, so choosing one
            dates it a cycle out unless a date is already set.

            Committed on blur, because `8/1` on the way to `8/11/2019` parses
            to the eighth of January. Setting a date starts the job, which is
            right: putting a day on something is deciding to do it. */}
        <Card
          elevation="md"
          style={styles.section}
          onLayout={(e) => { dueY.current = e.nativeEvent.layout.y; }}
        >
          <DateField
            label="When's it due?"
            value={dueDraft}
            onChangeValue={setDueDraft}
            onBlur={commitDue}
            placeholder="No date — that's fine"
            pickerTitle="When's it due?"
          />
          <View style={styles.optionRow}>
            {QUICK_DATES.map(({ label, at }) => {
              const day = at();
              return (
                <Option
                  key={label}
                  label={label}
                  active={!!snag.dueAt && dayKey(snag.dueAt) === dayKey(day)}
                  onPress={() => patch({ dueAt: day.toISOString() })}
                  disabled={busy}
                />
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Repeats</Text>
          <View style={styles.optionRow}>
            <Option
              label="Never"
              active={!snag.repeatDays}
              onPress={() => {
                if (snag.repeatDays) patch({ repeatDays: null });
              }}
              disabled={busy}
            />
            {repeatChoices(snag.repeatDays).map(({ days, label }) => (
              <Option
                key={days}
                label={label}
                active={snag.repeatDays === days}
                onPress={() => {
                  if (snag.repeatDays === days) return;
                  patch({
                    repeatDays: days,
                    dueAt: snag.dueAt ?? new Date(Date.now() + days * DAY_MS).toISOString(),
                  });
                }}
                disabled={busy}
              />
            ))}
          </View>
          {snag.repeatDays ? (
            <Text style={styles.sectionHint}>
              {describeRepeat(snag)} It comes up under Due soon on the list — Snag doesn't
              send reminders.
            </Text>
          ) : null}
        </Card>
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
    width: 120,
    height: 165,
    marginRight: Spacing.sm,
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
  assetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
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
  // Dashed and sunken: an offer rather than an instruction. Most jobs are
  // about nothing in the record, and an empty state that shouts is an empty
  // state that reads as an unfinished form.
  assetEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    marginTop: Spacing.sm,
    borderRadius: Radius.button,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    backgroundColor: Colors.sunken,
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
  suggestRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  suggestLabel: { fontSize: Typography.sm, color: Colors.textMuted, marginRight: Spacing.xs },
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
  // The pill and its tap area are different sizes on purpose, as everywhere
  // else a chip row appears in this app: the visible thing stays a badge so it
  // does not outweigh the headline above it, and the Pressable around it
  // carries the minimum target.
  metaChip: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
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
  // Mark done stands clear of both its neighbours. Above it, because finishing
  // is the last thing that happens and is not part of the repeat card; below
  // it, because the sticky bar's button sits directly under it and peripheral
  // vision reads two adjacent full-width controls as one pair whatever they
  // say. The bar's own top rule and shadow do the rest.
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
    minWidth: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.input,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Neutral rather than faded when there is nothing to add: fern at half
  // strength is a pale sage that reads as broken rather than as not-ready.
  partAddOff: { backgroundColor: Colors.sunken },
  partAddLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.white,
  },
  partAddLabelOff: { color: Colors.textMuted },
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
  commentBox: { gap: Spacing.sm, marginTop: Spacing.sm },
  commentActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  commentInput: {
    // Full width, with the control underneath rather than beside it. Nothing
    // is flexed around it any more, so the `minWidth: 0` that a flexed
    // TextInput needs on web is no longer load-bearing here — it is kept
    // because an <input>'s intrinsic ~20-character width is still what a
    // narrow phone would otherwise measure against.
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
