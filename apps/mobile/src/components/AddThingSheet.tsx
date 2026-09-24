import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useEdgeInsets } from '../hooks/useEdgeInsets';

import Icon from './Icon';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { compressAndUpload, photoFileName, takePhoto } from '../lib/photoUpload';
import { failureReason } from '../lib/deadline';
import { readLabel, uploadFile } from '../lib/supabase';
import {
  applyLabelReading, catalogueSuggestions, describeCycle, documentFileName, documentName,
  matchSuggestions, suggestionsForRoom, swatchColour, type ThingInput,
} from '@snag/supabase-queries';
import {
  Location, SERVICE_CYCLES, ThingKind, ThingSpec, THING_KINDS, THING_KIND_LABELS,
} from '../types';

/**
 * Adding something to the house record, in four steps.
 *
 * **This is not capture, and it is deliberately slower than capture is.** A
 * snag is filed in ten seconds standing in front of the problem; a thing is
 * added at a workbench, or while a repairer reads a model number out. The two
 * moments do not want the same control, and the compose bar — one tap, no
 * questions — was answering the wrong one here: it produced a photograph of a
 * plate with no room, no kind and no name, which is the weakest thing the
 * record can hold.
 *
 * Three rules keep it from becoming the thirty-field form this whole tab exists
 * to avoid:
 *
 * - **Only the room is required**, and it is filled in before the sheet opens
 *   whenever the + was pressed from inside a room, or a ghost was tapped.
 * - **Every other step can be skipped**, and skipping is a labelled control
 *   rather than a back-out. A thing with a room and a name is a perfectly good
 *   entry; the rest is what a future trip to the shop will thank you for.
 * - **The camera is still one tap**, just no longer the doorway. Step three
 *   photographs the rating plate, which remains the fastest way to capture
 *   make, model, serial and date of manufacture without typing anything.
 *
 * **Both list steps are the same control**, and that is deliberate. Step one
 * used to be a wall of twelve room chips plus an "Add a room…" chip that swapped
 * the whole step for a naming field; step two was already a search box that
 * narrowed as you typed and offered to add whatever did not match. They asked
 * the same shape of question and answered it two different ways. Now both are:
 * type, watch the list narrow, and if nothing is it, add what you typed. A house
 * whose rooms or appliances are not the catalogue's is a normal house, and
 * neither step is allowed to insist otherwise.
 *
 * Nothing is written until the last step. That is the one real difference from
 * the snag amend row, and it is forced: `create_thing` needs a kind, and a row
 * half-created by somebody who walked away mid-flow is exactly the unconfirmed
 * entry the ghost design exists to keep out of the record.
 */

type Step = 'room' | 'what' | 'label' | 'takes';

const STEPS: Step[] = ['room', 'what', 'label', 'takes'];

/** Where reading the photographed label has got to. Never blocks a step. */
type Reading =
  | { state: 'idle' }
  | { state: 'reading' }
  | { state: 'read'; filled: string[] }
  | { state: 'failed'; words: string };


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
  onAdd: (input: Omit<ThingInput, 'propertyId'>) => Promise<void>;
}

export default function AddThingSheet({
  visible, locations, pathPrefix, start, onAddRoom, onCancel, onAdd,
}: Props) {
  const insets = useEdgeInsets();
  const keyboard = useKeyboardInset();

  const [step, setStep] = useState<Step>('room');
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
  // Bumped on every open, so a reading that lands after the sheet has been
  // closed and reopened fills nothing in a walkthrough it was never for.
  const openCount = useRef(0);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [takes, setTakes] = useState('');
  /**
   * What the model knows goes with this make and model — never read off the
   * label, so never laid into the box. Offered on step four as rows to tap.
   */
  const [suggested, setSuggested] = useState<string[]>([]);
  const [suggestedService, setSuggestedService] = useState<number | null>(null);
  /** Suggestions somebody tapped, kept beside whatever they type in the box. */
  const [picked, setPicked] = useState<string[]>([]);
  const [serviceDays, setServiceDays] = useState<number | null>(null);
  /** For a paint: which surface in the room. "Main wall", "Windows". */
  const [where, setWhere] = useState('');
  /** Free text on step three. A paint answers step four with a surface instead. */
  const [note, setNote] = useState('');
  const [docPath, setDocPath] = useState<string | null>(null);
  const [docLabel, setDocLabel] = useState<string | null>(null);
  /** What they typed into step one's search. Never a value, only a filter. */
  const [lookRoom, setLookRoom] = useState('');
  /** What they typed into step two's search. Never a value, only a filter. */
  const [look, setLook] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset on every open. A sheet that remembers the last thing somebody added
  // offers the bathroom's extractor fan while they are standing in the garage.
  useEffect(() => {
    if (!visible) return;
    setRoom(start?.room ?? null);
    setName(start?.name ?? '');
    setKind(start?.kind ?? 'appliance');
    setNaming(false);
    setMake('');
    setModel('');
    setSerial('');
    setSpec({});
    setReading({ state: 'idle' });
    openCount.current += 1;
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
    // Tapping a ghost has already answered the first two questions, so opening
    // on them would be asking somebody to confirm what they just said.
    // `room: null` from the Whole house heading is a choice; `room` absent is
    // nobody having chosen yet. Collapsing the two would send somebody who
    // pressed + on a heading back to a question they just answered.
    setStep(start?.name ? 'label' : start && start.room !== undefined ? 'what' : 'room');
  }, [visible, start]);

  // What the boxes hold this render, for a reading that lands later.
  const latest = useRef({ name, make, model, serial, takes, spec });
  latest.current = { name, make, model, serial, takes, spec };

  const index = STEPS.indexOf(step);
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
   * What step two offers: this room's own list first, then the rest of the
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
   * Substring anywhere and case-insensitive, exactly like step two's matcher —
   * somebody hunting the living room types "living", and somebody hunting it
   * from the other end types "room". Neither should come back empty.
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
    setNaming(true);
  }

  function next() {
    if (step === 'room') setStep('what');
    else if (step === 'what') setStep('label');
    else if (step === 'label') setStep('takes');
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

  function back() {
    if (step === 'takes') setStep('label');
    else if (step === 'label') setStep('what');
    else if (step === 'what') setStep('room');
    else onCancel();
  }

  async function shoot() {
    if (busy || !pathPrefix) return;
    const uri = await takePhoto();
    if (!uri) return;
    setBusy(true);
    try {
      const { path, error } = await compressAndUpload(uri, photoFileName(pathPrefix));
      if (error || !path) throw error ?? new Error('The photo did not upload');
      setPhotoPath(path);
      read(path);
    } catch (err: unknown) {
      // Shown in the sheet rather than an alert: the step is still on screen
      // and the retry is the same button they just pressed.
      setModel((current) => current);
      console.error('Plate photo failed:', failureReason(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * What the photographed label says, laid into the boxes still empty.
   *
   * Not awaited by anything: the photo is on the record the moment it
   * uploads, and the person can carry on typing, press Next, or leave while
   * this runs. When it lands it fills **only what is still blank**
   * (`applyLabelReading`) — whatever somebody reached first is theirs — and
   * says which boxes it filled, so they know what to check against the label
   * rather than assuming it read everything. Nothing is written by this; the
   * last step is still the only write.
   *
   * A failure is a line under the boxes, never an alert: the step is still on
   * screen and typing it is exactly what they would have done without this.
   */
  async function read(path: string) {
    const mine = openCount.current;
    setReading({ state: 'reading' });
    try {
      const found = await readLabel(path, kind);
      if (mine !== openCount.current) return;
      if (!found) {
        setReading({ state: 'failed', words: "Couldn't make out a label in that photo — type what it says." });
        return;
      }
      // Against the boxes as they are *now*, not as they were when the photo
      // was taken: a box typed into while the read was out is filled.
      const { next, filled } = applyLabelReading(latest.current, found, kind);
      setName(next.name);
      setMake(next.make);
      setModel(next.model);
      setSerial(next.serial);
      setTakes(next.takes);
      setSpec(next.spec);
      setSuggested(found.suggestedConsumables ?? []);
      setSuggestedService(found.suggestedServiceDays ?? null);
      setReading({ state: 'read', filled });
    } catch (err: unknown) {
      if (mine !== openCount.current) return;
      setReading({
        state: 'failed',
        words: err instanceof Error && err.message ? err.message : "Couldn't read the label",
      });
    }
  }

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

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await onAdd({
        kind,
        room,
        name: name.trim() || null,
        photoPaths: photoPath ? [photoPath] : [],
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
        // room apart — so it is asked at the last step in those words. For
        // everything else it is free text, asked beside the label.
        notes: painting ? where.trim() || null : note.trim() || null,
      });
    } finally {
      setBusy(false);
    }
  }

  const canLeaveRoom = !!room;
  const canLeaveWhat = !!name.trim();
  // Step three asks for nothing, so "Next" and a separate "Skip" were two
  // controls with one outcome sitting side by side. One control, and it says
  // which of the two things it is doing.
  const labelStepEmpty =
    !photoPath && !docPath && !make.trim() && !model.trim() && !note.trim() && !serial.trim();
  const swatch = painting ? swatchColour(spec) : null;
  const specLine = painting
    ? [spec.product, spec.sheen, spec.tint ? `tint ${spec.tint}` : null].filter(Boolean).join(' · ')
    : '';
  const nextLabel = step === 'label' && labelStepEmpty ? 'Skip for now' : 'Next';
  // What the thing will be recorded as taking: the tapped suggestions, then the
  // box, each once whatever its capitals.
  const takesList = [...picked, takes.trim()]
    .filter(Boolean)
    .filter((one, i, all) => all.findIndex((other) => other.toLowerCase() === one.toLowerCase()) === i);
  // A suggestion already taken, or already typed, is not offered again.
  const offers = suggested.filter(
    (one) => !takesList.some((taken) => taken.toLowerCase() === one.toLowerCase())
  );

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
            Step {index + 1} of 4{step === 'room' ? ' · required' : ''}
          </Text>
          <Pressable onPress={onCancel} style={styles.headTap} accessibilityRole="button" accessibilityLabel="Cancel">
            <Icon name="close" size="md" color={Colors.textMuted} />
          </Pressable>
        </View>

        {/* ── 1. which room ───────────────────────────────────────────── */}
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

        {/* ── 2. what is it ───────────────────────────────────────────── */}
        {step === 'what' ? (
          <>
            <Text style={styles.question}>What is it?</Text>
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
                      onPress={() => {
                        setKind(suggestion.kind);
                        if (suggestion.kind === 'finish') {
                          // A paint is not called "Paint" — it is called Half
                          // Spanish White, and that is the answer somebody
                          // came to this tab for.
                          setName('');
                          setNaming(true);
                        } else {
                          setName(suggestion.name);
                        }
                      }}
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
                        onPress={() => {
                          setKind(suggestion.kind);
                          if (suggestion.kind === 'finish') {
                            setName('');
                            setNaming(true);
                          } else {
                            setName(suggestion.name);
                          }
                        }}
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

        {/* ── 3. the label ────────────────────────────────────────────── */}
        {step === 'label' ? (
          <>
            <Text style={styles.question}>
              {painting ? 'Photograph the tin lid' : 'Photograph the label'}
            </Text>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              <Pressable
                onPress={shoot}
                disabled={busy || !pathPrefix}
                style={[styles.shoot, photoPath && styles.shootDone]}
                accessibilityRole="button"
                accessibilityLabel="Photograph the label"
              >
                {busy ? (
                  <ActivityIndicator color={Colors.primary} />
                ) : (
                  <>
                    <Icon
                      name={photoPath ? 'checkmark-circle-outline' : 'camera-outline'}
                      size="lg"
                      color={photoPath ? Colors.primary : Colors.textSecondary}
                    />
                    <Text style={[styles.shootLabel, photoPath && styles.shootLabelDone]}>
                      {photoPath
                        ? 'Got it — it is on the record'
                        : painting
                          ? 'Take a photo of the tin lid'
                          : 'Take a photo of the rating plate'}
                    </Text>
                  </>
                )}
              </Pressable>
              <Text style={styles.hint}>
                {painting
                  ? 'The lid carries the colour code and the tint formula — the numbers that get you the same paint rather than a near match. Or type them; either can wait.'
                  : 'The plate carries the make, model and serial at once. Or type them — either can wait.'}
              </Text>
              <View style={styles.fields}>
                <TextInput
                  style={styles.input}
                  value={make}
                  onChangeText={setMake}
                  placeholder={kind === 'finish' ? 'Resene' : 'Mitsubishi Electric'}
                  placeholderTextColor={Colors.textMuted}
                  maxLength={80}
                  accessibilityLabel={kind === 'finish' ? 'Brand' : 'Make'}
                />
                <TextInput
                  style={[styles.input, styles.inputMono]}
                  value={model}
                  onChangeText={setModel}
                  placeholder={kind === 'finish' ? '7BB 83/018' : 'MSZ-AP50VGK'}
                  placeholderTextColor={Colors.textMuted}
                  maxLength={80}
                  autoCorrect={false}
                  autoCapitalize="characters"
                  accessibilityLabel={kind === 'finish' ? 'Colour code' : 'Model'}
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

              {/* A paint is asked for its surface at the last step instead, in
                  those words: `notes` is one column and the kind decides what
                  it means. */}
              {!painting ? (
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
              ) : null}
            </ScrollView>
          </>
        ) : null}

        {/* ── 4. what it takes ────────────────────────────────────────── */}
        {step === 'takes' && painting ? (
          <>
            {/* A tin of paint takes nothing and is never serviced. What it has
                instead is a surface, and in a room with two paints that note is
                the only thing telling them apart. */}
            <Text style={styles.question}>Where did it go?</Text>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              <View style={styles.fields}>
                <TextInput
                  style={styles.input}
                  value={where}
                  onChangeText={setWhere}
                  placeholder="Main wall · windows · ceiling · trim"
                  placeholderTextColor={Colors.textMuted}
                  maxLength={200}
                  autoFocus
                  accessibilityLabel="Where did it go"
                />
              </View>
              <Text style={styles.hint}>
                In a room with more than one colour this is what tells them apart. Skippable, like
                everything after the room.
              </Text>
            </ScrollView>
          </>
        ) : null}

        {step === 'takes' && !painting ? (
          <>
            <Text style={styles.question}>Anything you re-buy for it?</Text>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
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
              <Text style={styles.hint}>This is what a job about it offers you in the shop.</Text>
              <Text style={styles.question2}>Serviced how often?</Text>
              <View style={styles.chips}>
                <Chip label="Never" on={serviceDays === null} onPress={() => setServiceDays(null)} />
                {/* The thing page's own list, so the two places a service
                    cycle is chosen offer the same answers in the same words.
                    It was a third, local list of three. */}
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
            </ScrollView>
          </>
        ) : null}

        {/* ── the one control that moves ──────────────────────────────── */}
        {step === 'takes' ? (
          <Pressable
            onPress={submit}
            disabled={busy}
            style={[styles.cta, busy && styles.ctaOff]}
            accessibilityRole="button"
            accessibilityLabel="Add it to the house"
          >
            {busy ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={styles.ctaLabel}>Add it</Text>
            )}
          </Pressable>
        ) : (step === 'what' && noMatch && !naming) || (step === 'room' && noRoomMatch) ? null : (
          // Nothing matched, so the only thing to do is add it — and a dead
          // Next sitting under the one live control is a choice that isn't one.
          // True of both list steps, which is the point of them being the same
          // control: step one grew this footer back the first time it was given
          // a search box, and it read exactly as wrong there.
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
 * One line under the boxes saying where reading the label has got to.
 *
 * It names what it filled, because "read from the photo" over five boxes when
 * it managed two would have somebody trust three it never touched.
 */
function LabelStatus({ reading }: { reading: Reading }) {
  if (reading.state === 'idle') return null;
  if (reading.state === 'reading') {
    return (
      <View style={styles.readingRow}>
        <ActivityIndicator size="small" color={Colors.textMuted} />
        <Text style={styles.readingText}>Reading the label…</Text>
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
  shootDone: { backgroundColor: Colors.primaryLight },
  shootLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    flexShrink: 1,
  },
  shootLabelDone: { color: Colors.primary },
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
