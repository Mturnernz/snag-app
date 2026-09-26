import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, ActivityIndicator, Image, StyleSheet,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import Icon from './Icon';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { compressAndUpload, photoFileName, pickPhotos, takePhoto } from '../lib/photoUpload';
import { failureReason } from '../lib/deadline';
import { readLabel, resolveLabelReading, uploadFile } from '../lib/supabase';
import {
  applyLabelReading, catalogueSuggestions, describeCycle, documentFileName, documentName,
  LabelReadError, matchSuggestions, suggestionsForRoom, swatchColour,
  type LabelGuess, type LabelReading, type ThingInput,
} from '@snag/supabase-queries';
import {
  Location, SERVICE_CYCLES, ThingKind, ThingSpec, THING_KINDS, THING_KIND_LABELS,
} from '../types';

/**
 * Adding something to the house record: the photo first, then four questions.
 *
 * **This is not capture, and it is deliberately slower than capture is.** A
 * snag is filed in ten seconds standing in front of the problem; a thing is
 * added at a workbench, or while a repairer reads a model number out. The two
 * moments do not want the same control, and the compose bar — one tap, no
 * questions — was answering the wrong one here: it produced a photograph of a
 * plate with no room, no kind and no name, which is the weakest thing the
 * record can hold.
 *
 * **The photo comes first so nobody waits on it.** Reading a label takes five
 * to forty seconds, and a walk round the house recording the heat pump, the
 * dishwasher and the dryer was a minute of watching a spinner per appliance.
 * So the shutter is step one: the photo uploads and the label is read while
 * the person answers the questions only they can — which room, what it is —
 * and by the last step the boxes are usually already filled. *Add it* never
 * waits on the read. A reading that lands afterwards is kept by the server
 * (`home.label_readings`) and turns up as a card on the thing's own page, to
 * be checked there — never written onto the record unseen.
 *
 * Three rules keep it from becoming the thirty-field form this whole tab exists
 * to avoid:
 *
 * - **Only the room and the name are required**, and both are filled in before
 *   the sheet opens whenever the + was pressed from inside a room, or a ghost
 *   was tapped — those steps are then skipped on the way forward.
 * - **Every other step can be skipped**, and skipping is a labelled control
 *   rather than a back-out.
 * - **The camera is one tap**, and it is the doorway again: a rating plate is
 *   the fastest way to capture make, model and serial without typing.
 *
 * **Both list steps are the same control**, and that is deliberate: type,
 * watch the list narrow, and if nothing is it, add what you typed. A house
 * whose rooms or appliances are not the catalogue's is a normal house, and
 * neither step is allowed to insist otherwise.
 *
 * Nothing is written to the record until the last step. `create_thing` needs
 * a kind, and a row half-created by somebody who walked away mid-flow is
 * exactly the unconfirmed entry the ghost design exists to keep out.
 */

type Step = 'photo' | 'room' | 'what' | 'details';

const STEPS: Step[] = ['photo', 'room', 'what', 'details'];

/** Where reading the photographed label has got to. Never blocks a step. */
type Reading =
  | { state: 'idle' }
  | { state: 'reading' }
  /** Landed, but the boxes are on a later step: laid in when it is reached. */
  | { state: 'landed' }
  | { state: 'read'; filled: string[] }
  | { state: 'failed'; words: string };

/** Where the photo's upload has got to. Only *Add it* ever waits on this. */
type Upload = 'idle' | 'uploading' | 'done' | 'failed';

interface Props {
  visible: boolean;
  locations: Location[];
  /** `<household_id>` — the storage folder the RLS policies read. */
  pathPrefix: string | null;
  /** Set when the + was pressed inside a room, or a ghost was tapped. */
  start?: { room?: string | null; name?: string | null; kind?: ThingKind } | null;
  /**
   * Creates a room tag and returns whether it worked. The moment somebody
   * notices the conservatory is missing is the moment they are trying to record
   * something in it, so the list of rooms has to be editable from inside the
   * flow rather than three screens away in Profile.
   */
  onAddRoom: (name: string) => Promise<boolean>;
  onCancel: () => void;
  /** Resolves false when the write was refused, so the sheet knows it is still open for a reason. */
  onAdd: (input: Omit<ThingInput, 'propertyId'>) => Promise<boolean | void>;
  /**
   * A reading that landed after *Add it*: it is waiting on the thing's page,
   * and the screen may want to say so. `readable` is false when there was no
   * label to be made out.
   */
  onLateReading?: (name: string, readable: boolean) => void;
}

export default function AddThingSheet({
  visible, locations, pathPrefix, start, onAddRoom, onCancel, onAdd, onLateReading,
}: Props) {
  const insets = useEdgeInsets();
  const keyboard = useKeyboardInset();

  const [step, setStep] = useState<Step>('photo');
  /** Steps already answered when the sheet opened, passed over on the way forward. */
  const [skipped, setSkipped] = useState<Step[]>([]);
  const [room, setRoom] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ThingKind>('appliance');
  const [naming, setNaming] = useState(false);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  /** Only ever filled from the label: the walkthrough does not ask for it. */
  const [serial, setSerial] = useState('');
  /** A paint's sheen, tint, product and swatch, when the tin said them. */
  const [spec, setSpec] = useState<ThingSpec>({});
  const [reading, setReading] = useState<Reading>({ state: 'idle' });
  /** What the reader thinks the thing is. Offered on *What is it?*, never chosen past a choice. */
  const [guess, setGuess] = useState<LabelGuess | null>(null);
  // Bumped on every open, so a reading that lands after the sheet has been
  // closed and reopened fills nothing in a walkthrough it was never for.
  const openCount = useRef(0);
  // Bumped on every photo, so a retake's reading wins over the first one's.
  const photoCount = useRef(0);
  /** A reading that landed before its boxes were on screen. */
  const landed = useRef<LabelReading | null>(null);
  const readingId = useRef<string | null>(null);
  /** Opens whose *Add it* went through, and what the thing was called — for a reading landing later. */
  const submitted = useRef(new Map<number, string>());
  /** Whether the kind has been said by somebody — the start, or a tap on *What is it?*. */
  const kindSaid = useRef(false);
  /** The guess is pre-selected at most once, so choosing something else is never undone. */
  const guessOffered = useRef(false);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload>('idle');
  const uploading = useRef<Promise<string | null> | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [takes, setTakes] = useState('');
  /**
   * What the model knows goes with this make and model — never read off the
   * label, so never laid into the box. Offered on the last step as rows to tap.
   */
  const [suggested, setSuggested] = useState<string[]>([]);
  const [suggestedService, setSuggestedService] = useState<number | null>(null);
  /** Suggestions somebody tapped, kept beside whatever they type in the box. */
  const [picked, setPicked] = useState<string[]>([]);
  const [serviceDays, setServiceDays] = useState<number | null>(null);
  /** For a paint: which surface in the room. "Main wall", "Windows". */
  const [where, setWhere] = useState('');
  /** Free text on the last step. A paint answers with a surface instead. */
  const [note, setNote] = useState('');
  const [docPath, setDocPath] = useState<string | null>(null);
  const [docLabel, setDocLabel] = useState<string | null>(null);
  /** What they typed into the room step's search. Never a value, only a filter. */
  const [lookRoom, setLookRoom] = useState('');
  /** What they typed into *What is it?*'s search. Never a value, only a filter. */
  const [look, setLook] = useState('');
  const [busy, setBusy] = useState(false);
  /** *Add it* waiting on the upload, which is the one wait left. */
  const [saving, setSaving] = useState(false);

  // Reset on every open. A sheet that remembers the last thing somebody added
  // offers the bathroom's extractor fan while they are standing in the garage.
  useEffect(() => {
    if (!visible) return;
    setRoom(start?.room ?? null);
    setName(start?.name ?? '');
    setKind(start?.kind ?? 'appliance');
    kindSaid.current = !!start?.kind;
    guessOffered.current = false;
    setNaming(false);
    setMake('');
    setModel('');
    setSerial('');
    setSpec({});
    setReading({ state: 'idle' });
    setGuess(null);
    landed.current = null;
    readingId.current = null;
    openCount.current += 1;
    photoCount.current += 1;
    setLocalUri(null);
    setUpload('idle');
    uploading.current = null;
    setPhotoPath(null);
    setTakes('');
    setSuggested([]);
    setSuggestedService(null);
    setPicked([]);
    setServiceDays(null);
    setWhere('');
    setNote('');
    setDocPath(null);
    setDocLabel(null);
    setLookRoom('');
    setLook('');
    setBusy(false);
    setSaving(false);
    // Tapping a ghost has already answered which room and what it is; the + on
    // a heading has answered the room. `room: null` from the Whole house
    // heading is a choice; `room` absent is nobody having chosen yet.
    // Collapsing the two would send somebody who pressed + on a heading back
    // to a question they just answered. Skipped steps are only passed over on
    // the way forward: Back still reaches them, so a room can be changed.
    const answered: Step[] = [];
    if (start && start.room !== undefined) answered.push('room');
    if (start?.name) answered.push('what');
    setSkipped(answered);
    setStep('photo');
  }, [visible, start]);

  // What the boxes hold this render, for a reading that lands later.
  const latest = useRef({ name, make, model, serial, takes, spec });
  latest.current = { name, make, model, serial, takes, spec };
  const kindNow = useRef(kind);
  kindNow.current = kind;

  const flow = STEPS.filter((one) => one === step || !skipped.includes(one));
  const index = flow.indexOf(step);
  const painting = kind === 'finish';

  /**
   * What this room offers — the same list the ghosts are drawn from, so the two
   * cannot disagree about what a room has.
   *
   * A room has one rangehood; it has as many paints as it has surfaces. The
   * ghost prompts for the first paint and this offers every one after it, which
   * is why Paint stays here whatever is already recorded and the other
   * suggestions do not.
   */
  const suggestions = useMemo(() => (room ? suggestionsForRoom(room) : []), [room]);

  /**
   * What *What is it?* offers: this room's own list first, then the rest of the
   * house's vocabulary — because not every house is laid out the same, and a
   * picker that only ever offers the catalogue's idea of a kitchen quietly
   * insists everybody's rooms are arranged like it.
   */
  const elsewhere = useMemo(() => {
    const mine = new Set(suggestions.map((one) => one.name));
    return catalogueSuggestions().filter((one) => !mine.has(one.name));
  }, [suggestions]);

  /**
   * The rooms this property has, narrowed by whatever is in the box.
   *
   * Substring anywhere and case-insensitive, exactly like *What is it?*'s
   * matcher — somebody hunting the living room types "living", and somebody
   * hunting it from the other end types "room". Neither should come back empty.
   */
  const roomQuery = lookRoom.trim().toLowerCase();
  const roomMatches = locations.filter((one) => one.name.toLowerCase().includes(roomQuery));
  const wholeHouseMatches = 'whole house'.includes(roomQuery);
  const noRoomMatch = roomQuery.length > 0 && roomMatches.length === 0 && !wholeHouseMatches;

  const hereMatches = matchSuggestions(suggestions, look);
  const elsewhereMatches = matchSuggestions(elsewhere, look);
  const searchingList = look.trim().length > 0;
  const noMatch = searchingList && hereMatches.length === 0 && elsewhereMatches.length === 0;

  /** Whatever was typed, as the name of something new. */
  function nameItYourself(from: string) {
    setName(from);
    setKind(from ? 'appliance' : kind);
    kindSaid.current = true;
    setNaming(true);
  }

  /** A suggestion tapped on *What is it?* — the catalogue's, or the photo's. */
  function choose(suggestion: { name: string; kind: ThingKind }) {
    setKind(suggestion.kind);
    kindSaid.current = true;
    if (suggestion.kind === 'finish' || suggestion.kind === 'tile') {
      // A paint is not called "Paint" — it is called Half Spanish White, and
      // that is the answer somebody came to this tab for. The tin may already
      // have said it.
      setName(landed.current?.colourName ?? '');
      setNaming(true);
    } else {
      setName(suggestion.name);
    }
  }

  function next() {
    const at = STEPS.indexOf(step);
    const ahead = STEPS.slice(at + 1).find((one) => !skipped.includes(one));
    if (ahead) setStep(ahead);
  }

  function back() {
    const at = STEPS.indexOf(step);
    if (at <= 0) onCancel();
    else setStep(STEPS[at - 1]);
  }

  /**
   * A room the catalogue has never heard of, named from the search box itself.
   *
   * It writes to `home.locations`, so a conservatory added here is a room on the
   * List tab and in capture too — rooms are a property's vocabulary, not this
   * sheet's. The box is cleared on success so the list comes back showing the
   * new room selected rather than a filter that now matches one thing.
   */
  async function addRoom() {
    const name = lookRoom.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      if (await onAddRoom(name)) {
        setRoom(name);
        setLookRoom('');
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * The photo, from the camera or the library — and then straight on.
   *
   * The sheet moves to the next question the moment there is a picture, and
   * the upload and the read carry on behind it. That is the whole of what
   * stops a walk round the house being a minute of spinner per appliance.
   */
  async function shoot(source: 'camera' | 'library') {
    if (!pathPrefix) return;
    let uri: string | null = null;
    if (source === 'camera') {
      uri = await takePhoto();
    } else {
      const { uris } = await pickPhotos(1);
      uri = uris[0] ?? null;
    }
    if (!uri) return;
    setLocalUri(uri);
    startUpload(uri);
    if (step === 'photo') next();
  }

  /** Uploads the photo and, once it is in, asks what the label says. Never awaited here. */
  function startUpload(uri: string) {
    if (!pathPrefix) return;
    const mine = openCount.current;
    photoCount.current += 1;
    const shot = photoCount.current;
    // A retake starts again from nothing: the last photo's reading is not this one's.
    setPhotoPath(null);
    setReading({ state: 'idle' });
    setGuess(null);
    landed.current = null;
    readingId.current = null;
    setUpload('uploading');
    const work = (async (): Promise<string | null> => {
      try {
        const { path, error } = await compressAndUpload(uri, photoFileName(pathPrefix));
        if (error || !path) throw error ?? new Error('The photo did not upload');
        if (mine !== openCount.current || shot !== photoCount.current) return null;
        setPhotoPath(path);
        setUpload('done');
        read(path, shot);
        return path;
      } catch (err: unknown) {
        console.error('Plate photo failed:', failureReason(err));
        if (mine === openCount.current && shot === photoCount.current) setUpload('failed');
        return null;
      }
    })();
    uploading.current = work;
  }

  /**
   * What the photographed label says.
   *
   * Not awaited by anything: the person carries on answering while this runs.
   * When it lands it fills **only what is still blank** (`applyLabelReading`)
   * — whatever somebody reached first is theirs — and says which boxes it
   * filled. If the boxes are not on screen yet it waits until they are, so the
   * kind it is laid in by is the one the person chose rather than a guess.
   *
   * A reading that lands after *Add it* is not lost: the server kept it, the
   * thing's page offers it, and `onLateReading` lets the screen say so.
   *
   * A failure is a line under the boxes, never an alert: typing it is exactly
   * what they would have done without this.
   */
  async function read(path: string, shot: number) {
    const mine = openCount.current;
    setReading({ state: 'reading' });
    const stale = () => mine !== openCount.current || shot !== photoCount.current;
    try {
      const answer = await readLabel(path, kindSaid.current ? kindNow.current : null);
      const late = submitted.current.get(mine);
      if (late !== undefined && shot === photoCount.current) {
        submitted.current.delete(mine);
        onLateReading?.(late, !!answer.reading);
        return;
      }
      if (stale()) return;
      readingId.current = answer.readingId;
      setGuess(answer.guess);
      if (!answer.reading) {
        setReading({ state: 'failed', words: "Couldn't make out a label in that photo — type what it says." });
        return;
      }
      landed.current = answer.reading;
      setSuggested(answer.reading.suggestedConsumables ?? []);
      setSuggestedService(answer.reading.suggestedServiceDays ?? null);
      setReading({ state: 'landed' });
    } catch (err: unknown) {
      const late = submitted.current.get(mine);
      if (late !== undefined) {
        submitted.current.delete(mine);
        return;
      }
      if (stale()) return;
      readingId.current = err instanceof LabelReadError ? err.readingId : null;
      setReading({
        state: 'failed',
        words: err instanceof Error && err.message ? err.message : "Couldn't read the label",
      });
    }
  }

  // A reading lays itself into the boxes when the boxes are on screen — and
  // against what they hold *now*, so anything typed while it was out is kept.
  useEffect(() => {
    if (step !== 'details' || reading.state !== 'landed' || !landed.current) return;
    const { next: filledIn, filled } = applyLabelReading(latest.current, landed.current, kind);
    setName(filledIn.name);
    setMake(filledIn.make);
    setModel(filledIn.model);
    setSerial(filledIn.serial);
    setTakes(filledIn.takes);
    setSpec(filledIn.spec);
    setReading({ state: 'read', filled });
  }, [step, reading.state, kind]);

  // The photo's guess at what the thing is, chosen for them only when nothing
  // has been chosen yet and only once — never over a tap, and never a paint,
  // whose name is a colour and whose box would pop a keyboard mid-step.
  useEffect(() => {
    if (step !== 'what' || !guess?.name || guessOffered.current) return;
    guessOffered.current = true;
    const guessKind = guess.kind ?? 'appliance';
    if (name.trim() || naming || guessKind === 'finish' || guessKind === 'tile') return;
    setKind(guessKind);
    setName(guess.name);
  }, [step, guess]);

  /**
   * The invoice, the certificate of safety, the manual.
   *
   * Uploaded here and carried into `create_thing` rather than written
   * afterwards: the bytes are in the bucket the moment this returns, and a
   * create-then-update is two chances for somebody to walk away between the
   * file landing and the row that points at it. `create_thing` takes
   * `p_document_paths` for exactly this.
   *
   * If they walk away before the last step the file is orphaned — the same
   * trade the plate photo already makes, and the same one `create_thing`'s
   * all-or-nothing write forces. The audit query in SNAG_INFRA_NOTES.md is how
   * those are found.
   */
  async function attachDocument() {
    if (busy || !pathPrefix) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];

    setBusy(true);
    try {
      const key = documentFileName(pathPrefix, asset.name ?? 'document.pdf');
      const { path, error } = await uploadFile(asset.uri, key, 'application/pdf');
      if (error || !path) throw error ?? new Error('The document did not upload');
      setDocPath(path);
      setDocLabel(documentName(path));
    } catch (err: unknown) {
      console.error('Document failed:', failureReason(err));
    } finally {
      setBusy(false);
    }
  }

  /** Drops a photo that would not upload, so *Add it* can go without it. */
  function withoutPhoto() {
    photoCount.current += 1;
    uploading.current = null;
    setLocalUri(null);
    setPhotoPath(null);
    setUpload('idle');
    setReading({ state: 'idle' });
  }

  /**
   * The one write. It waits on the photo's upload — `create_thing` needs the
   * stored key — and never on the read: a reading still out is kept by the
   * server and offered on the thing's page instead.
   */
  async function submit() {
    if (busy || saving) return;
    const mine = openCount.current;
    let path = photoPath;
    if (upload === 'uploading' && uploading.current) {
      setSaving(true);
      path = await uploading.current;
      setSaving(false);
      if (mine !== openCount.current) return;
    }
    // A photo that did not upload is said beside the button, with a way on
    // without it — never a silent save that drops it.
    if (localUri && !path) {
      setUpload('failed');
      return;
    }

    setBusy(true);
    try {
      const done = await onAdd({
        kind,
        room,
        name: name.trim() || null,
        photoPaths: path ? [path] : [],
        documentPaths: docPath ? [docPath] : [],
        make: make.trim() || null,
        model: model.trim() || null,
        // Both only ever arrive from the label. A paint has no serial, and
        // offering the row would invent one — the thing page's own rule.
        serial: !painting && serial.trim() ? serial.trim() : null,
        spec: painting ? cleanSpec(spec) : undefined,
        // A paint answers the last step with a surface; everything else answers
        // it with a part and a cycle. Neither carries the other's fields.
        consumables: painting ? [] : takesList,
        serviceDays: painting ? null : serviceDays,
        // `notes` is one column doing two jobs, and the kind decides which. For
        // a paint it is the surface — the only thing telling two colours in one
        // room apart — so it is asked in those words. For everything else it is
        // free text.
        notes: painting ? where.trim() || null : note.trim() || null,
      });
      if (done === false) return;
      if (reading.state === 'read' || reading.state === 'failed') {
        // Seen in the boxes, so there is nothing left for a card to ask. A
        // busy read still being retried is left alone: its card is the answer.
        const id = readingId.current;
        const retrying = reading.state === 'failed' && /keep trying/i.test(reading.words);
        if (id && !retrying) resolveLabelReading(id, 'used').catch(() => {});
      } else if (reading.state === 'reading' || upload === 'uploading') {
        submitted.current.set(mine, name.trim() || 'it');
      }
    } finally {
      setBusy(false);
    }
  }

  // `null` is Whole house, and it is an answer only when a heading chose it.
  const canLeaveRoom = !!room || (room === null && start?.room === null);
  const canLeaveWhat = !!name.trim();
  const swatch = painting ? swatchColour(spec) : null;
  const specLine = painting
    ? [spec.product, spec.sheen, spec.tint ? `tint ${spec.tint}` : null].filter(Boolean).join(' · ')
    : '';
  const nextLabel = step === 'photo' && !localUri ? 'Skip for now' : 'Next';
  // What the thing will be recorded as taking: the tapped suggestions, then the
  // box, each once whatever its capitals.
  const takesList = [...picked, takes.trim()]
    .filter(Boolean)
    .filter((one, i, all) => all.findIndex((other) => other.toLowerCase() === one.toLowerCase()) === i);
  // A suggestion already taken, or already typed, is not offered again.
  const offers = suggested.filter(
    (one) => !takesList.some((taken) => taken.toLowerCase() === one.toLowerCase())
  );
  const guessKind = guess?.kind ?? 'appliance';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Close" />
      <View
        style={[
          styles.sheet,
          { marginBottom: keyboard, paddingBottom: (keyboard > 0 ? 0 : insets.bottom) + Spacing.lg },
        ]}
      >
        <View style={styles.grab} />

        <View style={styles.head}>
          <Pressable onPress={back} style={styles.headTap} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="chevron-back" size="md" color={Colors.textMuted} />
          </Pressable>
          <Text style={styles.step}>
            Step {index + 1} of {flow.length}{step === 'room' ? ' · required' : ''}
          </Text>
          <Pressable onPress={onCancel} style={styles.headTap} accessibilityRole="button" accessibilityLabel="Cancel">
            <Icon name="close" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>

        {/* ── 1. the photo ────────────────────────────────────────────── */}
        {step === 'photo' ? (
          <>
            <Text style={styles.question}>
              {painting ? 'Photograph the tin lid' : 'Photograph the label'}
            </Text>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              {localUri ? (
                <View style={styles.previewRow}>
                  <Image source={{ uri: localUri }} style={styles.preview} accessibilityLabel="The photo" />
                  <View style={styles.previewSide}>
                    <PhotoStatus upload={upload} reading={reading} />
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={() => shoot('camera')}
                  disabled={!pathPrefix}
                  style={styles.shoot}
                  accessibilityRole="button"
                  accessibilityLabel="Photograph the label"
                >
                  <Icon name="camera-outline" size="lg" color={Colors.textSecondary} />
                  <Text style={styles.shootLabel}>
                    {painting ? 'Take a photo of the tin lid' : 'Take a photo of the rating plate'}
                  </Text>
                </Pressable>
              )}
              <View style={styles.photoActions}>
                {localUri ? (
                  <Pressable
                    onPress={() => shoot('camera')}
                    disabled={!pathPrefix}
                    style={styles.attach}
                    accessibilityRole="button"
                    accessibilityLabel="Take another photo"
                  >
                    <Icon name="camera-outline" size="sm" color={Colors.primary} />
                    <Text style={styles.attachLabel}>Take another</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => shoot('library')}
                  disabled={!pathPrefix}
                  style={styles.attach}
                  accessibilityRole="button"
                  accessibilityLabel="Choose a photo"
                >
                  <Icon name="images-outline" size="sm" color={Colors.primary} />
                  <Text style={styles.attachLabel}>{localUri ? 'Choose another' : 'Choose a photo'}</Text>
                </Pressable>
              </View>
              <Text style={styles.hint}>
                {painting
                  ? 'The lid carries the colour code and the tint formula. It is read while you carry on.'
                  : 'The plate carries the make, model and serial. It is read while you carry on — no need to wait.'}
              </Text>
            </ScrollView>
          </>
        ) : null}

        {/* ── 2. which room ───────────────────────────────────────────── */}
        {step === 'room' ? (
          <>
            <Text style={styles.question}>Which room?</Text>
            <View style={styles.searchRow}>
              <Icon name="search" size="sm" color={Colors.textMuted} />
              <TextInput
                style={styles.searchField}
                value={lookRoom}
                onChangeText={setLookRoom}
                placeholder="Start typing a room…"
                placeholderTextColor={Colors.textMuted}
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={noRoomMatch ? addRoom : undefined}
                accessibilityLabel="Search the rooms"
              />
            </View>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              {noRoomMatch ? (
                // Not a dead end. A conservatory is not an odd house, and the
                // sheet has to be able to learn one without sending anybody to
                // Profile → Location tags and back.
                <View style={styles.fields}>
                  <Text style={styles.hint}>
                    No room by that name yet. It joins the tags the list groups by and capture
                    offers, not just this tab.
                  </Text>
                  <Pressable
                    onPress={addRoom}
                    disabled={busy}
                    style={[styles.cta, busy && styles.ctaOff]}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${lookRoom.trim()} as a room`}
                  >
                    {busy ? (
                      <ActivityIndicator color={Colors.white} />
                    ) : (
                      <Text style={styles.ctaLabel} numberOfLines={1}>
                        Add “{lookRoom.trim()}” as a room
                      </Text>
                    )}
                  </Pressable>
                </View>
              ) : (
                <View style={styles.chips}>
                  {roomMatches.map((location) => (
                    <Chip
                      key={location.id}
                      label={location.name}
                      on={room === location.name}
                      onPress={() => setRoom(location.name)}
                    />
                  ))}
                  {wholeHouseMatches ? (
                    <Chip
                      label="Whole house"
                      on={room === null && !!start}
                      onPress={() => setRoom(null)}
                    />
                  ) : null}
                </View>
              )}
            </ScrollView>
          </>
        ) : null}

        {/* ── 3. what is it ───────────────────────────────────────────── */}
        {step === 'what' ? (
          <>
            <Text style={styles.question}>What is it?</Text>
            {/* The photo's own answer, while there is a photo being read. The
                line is there from the start of the read, so the offer arriving
                takes the place of "looking" rather than pushing the list down
                under somebody's finger. */}
            {!naming && (upload === 'uploading' || reading.state === 'reading' || guess?.name) ? (
              <View style={styles.guessRow}>
                {guess?.name ? (
                  <Chip
                    label={`From the photo: ${guess.name}`}
                    on={guessKind === 'finish' || guessKind === 'tile'
                      ? naming && kind === guessKind
                      : name === guess.name}
                    onPress={() => choose({ name: guess.name!, kind: guessKind })}
                  />
                ) : (
                  <View style={styles.readingRow}>
                    <ActivityIndicator size="small" color={Colors.textMuted} />
                    <Text style={styles.readingText}>Looking at the photo…</Text>
                  </View>
                )}
              </View>
            ) : null}
            {!naming ? (
              <View style={styles.searchRow}>
                <Icon name="search" size="sm" color={Colors.textMuted} />
                <TextInput
                  style={styles.searchField}
                  value={look}
                  onChangeText={setLook}
                  placeholder="Start typing — dishwasher, heat pump, paint…"
                  placeholderTextColor={Colors.textMuted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                  accessibilityLabel="Search what to add"
                />
              </View>
            ) : null}
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              {!naming && noMatch ? (
                <View style={styles.fields}>
                  <Text style={styles.hint}>
                    Nothing in the list is that. Houses differ — add it and it becomes part of
                    this one's record.
                  </Text>
                  <Pressable
                    onPress={() => nameItYourself(look.trim())}
                    style={styles.cta}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${look.trim()}`}
                  >
                    <Text style={styles.ctaLabel} numberOfLines={1}>
                      Add “{look.trim()}”
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {!naming && !noMatch ? (
                <View style={styles.chips}>
                  {hereMatches.map((suggestion) => (
                    <Chip
                      key={suggestion.name}
                      label={suggestion.name}
                      on={name === suggestion.name}
                      onPress={() => choose(suggestion)}
                    />
                  ))}
                  {!searchingList ? (
                    <Chip label="Something else…" on={false} onPress={() => nameItYourself('')} />
                  ) : null}
                </View>
              ) : null}
              {/* The rest of the house's vocabulary, below this room's own. A
                  study with a heat pump in it is not an odd house. */}
              {!naming && !noMatch && elsewhereMatches.length > 0 ? (
                <>
                  {/* Only when there is a group above it to be elsewhere *than*.
                      A search the room itself does not match is just results,
                      and a lone "Elsewhere in the house" heading over the only
                      list on screen asks the reader "elsewhere than what?". */}
                  {hereMatches.length > 0 ? (
                    <Text style={styles.sectionLabel}>
                      {searchingList ? 'Elsewhere in the house' : 'Anything else'}
                    </Text>
                  ) : null}
                  <View style={styles.chips}>
                    {elsewhereMatches.map((suggestion) => (
                      <Chip
                        key={`else-${suggestion.name}`}
                        label={suggestion.name}
                        on={name === suggestion.name}
                        onPress={() => choose(suggestion)}
                      />
                    ))}
                  </View>
                </>
              ) : null}
              {!naming && !noMatch && searchingList ? (
                <View style={styles.chips}>
                  <Chip
                    label={`Add “${look.trim()}”`}
                    on={false}
                    onPress={() => nameItYourself(look.trim())}
                  />
                </View>
              ) : null}
              {naming ? (
                <View style={styles.fields}>
                  {painting ? <Text style={styles.hint}>Which colour?</Text> : null}
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder={painting ? 'Half Spanish White' : 'Gas water heater'}
                    placeholderTextColor={Colors.textMuted}
                    maxLength={80}
                    autoFocus
                    accessibilityLabel={painting ? 'Which colour' : 'What is it'}
                  />
                  {!painting ? (
                    <>
                      <Text style={styles.hint}>And what sort of thing is it?</Text>
                      <View style={styles.chips}>
                        {THING_KINDS.map((value) => (
                          <Chip
                            key={value}
                            label={THING_KIND_LABELS[value]}
                            on={kind === value}
                            onPress={() => setKind(value)}
                          />
                        ))}
                      </View>
                    </>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
          </>
        ) : null}


        {/* ── 4. anything else ────────────────────────────────────────── */}
        {step === 'details' ? (
          <>
            <Text style={styles.question}>Anything else?</Text>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              {localUri ? (
                <View style={styles.previewRow}>
                  <Image source={{ uri: localUri }} style={styles.thumb} accessibilityLabel="The photo" />
                  <View style={styles.previewSide}>
                    {upload === 'failed' ? (
                      <>
                        <Text style={styles.readingText}>The photo didn't upload.</Text>
                        <View style={styles.photoActions}>
                          <Pressable
                            onPress={() => startUpload(localUri)}
                            style={styles.attach}
                            accessibilityRole="button"
                            accessibilityLabel="Try the photo again"
                          >
                            <Text style={styles.attachLabel}>Try again</Text>
                          </Pressable>
                          <Pressable
                            onPress={withoutPhoto}
                            style={styles.attach}
                            accessibilityRole="button"
                            accessibilityLabel="Add it without the photo"
                          >
                            <Text style={styles.attachLabel}>Without the photo</Text>
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <PhotoStatus upload={upload} reading={reading} />
                    )}
                  </View>
                </View>
              ) : null}

              <View style={styles.fields}>
                <TextInput
                  style={styles.input}
                  value={make}
                  onChangeText={setMake}
                  placeholder={painting ? 'Brand' : 'Make'}
                  placeholderTextColor={Colors.textMuted}
                  maxLength={80}
                  accessibilityLabel={painting ? 'Brand' : 'Make'}
                />
                <TextInput
                  style={[styles.input, styles.inputMono]}
                  value={model}
                  onChangeText={setModel}
                  placeholder={painting ? 'Colour code' : 'Model'}
                  placeholderTextColor={Colors.textMuted}
                  maxLength={80}
                  autoCorrect={false}
                  autoCapitalize="characters"
                  accessibilityLabel={painting ? 'Colour code' : 'Model'}
                />
                {/* Not asked for — the walkthrough never has — but when the
                    plate carried one it is shown in a box, so it is checked
                    and can be corrected rather than saved unseen. */}
                {!painting && (serial || (reading.state === 'read' && reading.filled.includes('serial'))) ? (
                  <TextInput
                    style={[styles.input, styles.inputMono]}
                    value={serial}
                    onChangeText={setSerial}
                    placeholder="Serial"
                    placeholderTextColor={Colors.textMuted}
                    maxLength={80}
                    autoCorrect={false}
                    autoCapitalize="characters"
                    accessibilityLabel="Serial"
                  />
                ) : null}
                {painting && (swatch || specLine) ? (
                  <View style={styles.specRow}>
                    {swatch ? (
                      <View
                        style={[styles.swatch, { backgroundColor: swatch }]}
                        accessibilityLabel={`Swatch ${swatch}`}
                      />
                    ) : null}
                    {specLine ? (
                      <Text style={styles.specText} numberOfLines={2}>{specLine}</Text>
                    ) : null}
                  </View>
                ) : null}
                <LabelStatus reading={reading} />
              </View>

              {painting ? (
                // A tin of paint takes nothing and is never serviced. What it
                // has instead is a surface, and in a room with two paints that
                // note is the only thing telling them apart.
                <>
                  <Text style={styles.question2}>Where did it go?</Text>
                  <View style={styles.fields}>
                    <TextInput
                      style={styles.input}
                      value={where}
                      onChangeText={setWhere}
                      placeholder="Main wall · windows · ceiling · trim"
                      placeholderTextColor={Colors.textMuted}
                      maxLength={200}
                      accessibilityLabel="Where did it go"
                    />
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.question2}>Anything you re-buy for it?</Text>
                  <View style={styles.fields}>
                    {picked.map((item) => (
                      <View key={item} style={styles.pickedRow}>
                        <Text style={styles.pickedText} numberOfLines={1}>{item}</Text>
                        <Pressable
                          onPress={() => setPicked((all) => all.filter((one) => one !== item))}
                          style={styles.pickedRemove}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${item}`}
                        >
                          <Icon name="close" size="sm" color={Colors.textMuted} />
                        </Pressable>
                      </View>
                    ))}
                    <TextInput
                      style={[styles.input, styles.inputMono]}
                      value={takes}
                      onChangeText={setTakes}
                      placeholder="A filter, a bulb, a cartridge…"
                      placeholderTextColor={Colors.textMuted}
                      maxLength={60}
                      autoCorrect={false}
                      accessibilityLabel="What it takes"
                    />
                  </View>
                  {offers.length ? (
                    <View style={styles.offers}>
                      {/* Said on the heading, because these are the one thing in
                          this walkthrough nobody can check against the photo. */}
                      <Text style={styles.sectionLabel}>Suggested for this model · check before you buy</Text>
                      {offers.map((item) => (
                        <Pressable
                          key={item}
                          onPress={() => setPicked((all) => [...all, item])}
                          style={styles.offer}
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${item}`}
                        >
                          <Icon name="add-circle-outline" size="md" color={Colors.primary} />
                          <Text style={styles.offerText} numberOfLines={1}>{item}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  <Text style={styles.question2}>Serviced how often?</Text>
                  <View style={styles.chips}>
                    <Chip label="Never" on={serviceDays === null} onPress={() => setServiceDays(null)} />
                    {/* The thing page's own list, so the two places a service
                        cycle is chosen offer the same answers in the same words. */}
                    {SERVICE_CYCLES.map((days) => (
                      <Chip
                        key={days}
                        label={`Every ${describeCycle(days)}`}
                        on={serviceDays === days}
                        onPress={() => setServiceDays(days)}
                      />
                    ))}
                  </View>
                  {/* Said here because it is now true: the answer is a job on the
                      list, not a note on the record. */}
                  {serviceDays ? (
                    <Text style={styles.hint}>
                      {`It goes on the list as a job every ${describeCycle(serviceDays)}.`}
                    </Text>
                  ) : null}
                  {suggestedService && serviceDays !== suggestedService ? (
                    <Text style={styles.hint}>
                      Suggested for this model: every {describeCycle(suggestedService)}.
                    </Text>
                  ) : null}
                  <View style={styles.fields}>
                    <TextInput
                      style={[styles.input, styles.inputMulti]}
                      value={note}
                      onChangeText={setNote}
                      placeholder="Anything worth writing down — where it is, who installed it, what it cost"
                      placeholderTextColor={Colors.textMuted}
                      maxLength={1000}
                      multiline
                      accessibilityLabel="Notes"
                    />
                  </View>
                </>
              )}

              {/* The paperwork, at the moment somebody has it in their hand.
                  Asking for it later means asking somebody to go and find it,
                  which is the thing this whole tab exists to stop. */}
              {docPath ? (
                <View style={styles.doc}>
                  <Icon name="document-text-outline" size="sm" color={Colors.textSecondary} />
                  <Text style={styles.docName} numberOfLines={2}>{docLabel}</Text>
                  <Pressable
                    onPress={() => {
                      setDocPath(null);
                      setDocLabel(null);
                    }}
                    style={styles.docRemove}
                    accessibilityRole="button"
                    accessibilityLabel="Remove the file"
                  >
                    <Icon name="close" size="sm" color={Colors.textMuted} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={attachDocument}
                  disabled={busy || !pathPrefix}
                  style={styles.attach}
                  accessibilityRole="button"
                  accessibilityLabel="Attach a file"
                >
                  <Icon name="attach-outline" size="sm" color={Colors.primary} />
                  <Text style={styles.attachLabel}>
                    Attach a file — invoice, certificate, manual
                  </Text>
                </Pressable>
              )}
            </ScrollView>
          </>
        ) : null}

        {/* ── the one control that moves ──────────────────────────────── */}
        {step === 'details' ? (
          <Pressable
            onPress={submit}
            disabled={busy || saving}
            style={[styles.cta, (busy || saving) && styles.ctaOff]}
            accessibilityRole="button"
            accessibilityLabel="Add it to the house"
          >
            {saving ? (
              // The one wait left, and it says what it is waiting on.
              <View style={styles.readingRow}>
                <ActivityIndicator color={Colors.textMuted} />
                <Text style={styles.ctaLabelOff}>Uploading the photo…</Text>
              </View>
            ) : busy ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.ctaLabel}>Add it</Text>
            )}
          </Pressable>
        ) : (step === 'what' && noMatch && !naming) || (step === 'room' && noRoomMatch) ? null : (
          // Nothing matched, so the only thing to do is add it — and a dead
          // Next sitting under the one live control is a choice that isn't one.
          <View style={styles.footer}>
            <Pressable
              onPress={next}
              disabled={step === 'room' ? !canLeaveRoom : step === 'what' ? !canLeaveWhat : false}
              style={[
                styles.cta,
                styles.ctaGrow,
                ((step === 'room' && !canLeaveRoom) || (step === 'what' && !canLeaveWhat)) && styles.ctaOff,
              ]}
              accessibilityRole="button"
              accessibilityLabel={nextLabel}
            >
              <Text
                style={[
                  styles.ctaLabel,
                  ((step === 'room' && !canLeaveRoom) || (step === 'what' && !canLeaveWhat)) && styles.ctaLabelOff,
                ]}
              >
                {nextLabel}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.chipTap}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
    >
      <View style={[styles.chip, on && styles.chipOn]}>
        <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** A paint's spec, with the keys nobody filled left out rather than stored empty. */
function cleanSpec(spec: ThingSpec): ThingSpec | undefined {
  const kept = Object.fromEntries(
    Object.entries(spec).filter(([, value]) => value && value.trim())
  );
  return Object.keys(kept).length ? kept : undefined;
}


/**
 * Beside the photo: where its upload and its reading have got to, in the
 * words of somebody who does not have to wait for either.
 */
function PhotoStatus({ upload, reading }: { upload: Upload; reading: Reading }) {
  if (upload === 'uploading') {
    return (
      <View style={styles.readingRow}>
        <ActivityIndicator size="small" color={Colors.textMuted} />
        <Text style={styles.readingText}>Sending the photo — carry on.</Text>
      </View>
    );
  }
  if (upload === 'failed') return <Text style={styles.readingText}>The photo didn't upload.</Text>;
  if (reading.state === 'reading') {
    return (
      <View style={styles.readingRow}>
        <ActivityIndicator size="small" color={Colors.textMuted} />
        <Text style={styles.readingText}>Reading the label — carry on.</Text>
      </View>
    );
  }
  if (reading.state === 'landed' || reading.state === 'read') {
    return <Text style={styles.readingText}>Label read.</Text>;
  }
  if (reading.state === 'failed') return <Text style={styles.readingText}>{reading.words}</Text>;
  return <Text style={styles.readingText}>Got it.</Text>;
}

/**
 * One line under the boxes saying where reading the label has got to.
 *
 * It names what it filled, because "read from the photo" over five boxes when
 * it managed two would have somebody trust three it never touched. While the
 * read is still out it says that *Add it* does not have to wait for it.
 */
function LabelStatus({ reading }: { reading: Reading }) {
  if (reading.state === 'idle' || reading.state === 'landed') return null;
  if (reading.state === 'reading') {
    return (
      <View style={styles.readingRow}>
        <ActivityIndicator size="small" color={Colors.textMuted} />
        <Text style={styles.readingText}>
          Still reading the label — add it now if you like, and you'll be asked to check it on the
          item's page.
        </Text>
      </View>
    );
  }
  if (reading.state === 'failed') {
    return <Text style={styles.readingText}>{reading.words}</Text>;
  }
  return (
    <Text style={styles.readingText}>
      {reading.filled.length
        ? `Read from the photo: ${reading.filled.join(', ')}. Check against the label before you save.`
        : "Nothing read off that label that the boxes didn't already have."}
    </Text>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(43, 39, 36, 0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '86%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  grab: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headTap: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: -Spacing.md,
  },
  step: {
    fontFamily: Fonts.mono,
    fontSize: Typography.xs,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  question: { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.textPrimary },
  question2: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
  },
  scroll: { flexGrow: 0 },
  hint: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 19, marginTop: Spacing.sm },
  pickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingLeft: Spacing.md,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
  },
  pickedText: { flex: 1, minWidth: 0, fontFamily: Fonts.mono, fontSize: Typography.base, color: Colors.textPrimary },
  pickedRemove: {
    width: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offers: { marginTop: Spacing.xs },
  offer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: MIN_TOUCH_TARGET },
  offerText: { flex: 1, minWidth: 0, fontFamily: Fonts.mono, fontSize: Typography.base, color: Colors.textPrimary },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
  },
  searchField: { flex: 1, fontSize: Typography.base, color: Colors.textPrimary },
  sectionLabel: {
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.textMuted,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chipTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    backgroundColor: Colors.sunken,
  },
  chipOn: { backgroundColor: Colors.primary },
  chipLabel: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.textSecondary },
  chipLabelOn: { color: Colors.white, fontWeight: Typography.semibold },
  fields: { gap: Spacing.sm, marginTop: Spacing.sm },
  input: {
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: Typography.base,
    color: Colors.textPrimary,
  },
  inputMono: { fontFamily: Fonts.mono, fontSize: Typography.sm },
  specRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  // The paint's own colour, not a hue the app spends; hairline because most
  // paint is a white and a white circle on a white sheet is not there.
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  specText: { flex: 1, fontFamily: Fonts.mono, fontSize: Typography.sm, color: Colors.textSecondary },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  readingText: { fontSize: Typography.sm, color: Colors.textMuted, lineHeight: 19 },
  inputMulti: { minHeight: 80, paddingTop: Spacing.sm, textAlignVertical: 'top' },
  attach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  attachLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.primary },
  doc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: Colors.sunken,
    borderRadius: Radius.input,
  },
  // The filename is the label — it is why the storage key keeps it — so it
  // wraps rather than truncating to a name every invoice shares.
  docName: { flex: 1, minWidth: 0, fontSize: Typography.sm, color: Colors.textPrimary },
  docRemove: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: 88,
    borderRadius: Radius.card,
    backgroundColor: Colors.sunken,
    paddingHorizontal: Spacing.lg,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  preview: { width: 120, height: 120, borderRadius: Radius.card, backgroundColor: Colors.sunken },
  thumb: { width: 56, height: 56, borderRadius: Radius.input, backgroundColor: Colors.sunken },
  previewSide: { flex: 1, minWidth: 0, gap: Spacing.xs },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.lg },
  // As tall as the chip it becomes, so the offer landing moves nothing.
  guessRow: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  shootLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    flexShrink: 1,
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cta: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  ctaGrow: { flex: 1 },
  // A disabled filled button goes neutral, never faded: fern at half strength
  // reads as broken rather than as not-ready.
  ctaOff: { backgroundColor: Colors.sunken },
  ctaLabel: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.white },
  ctaLabelOff: { color: Colors.textMuted },
});
