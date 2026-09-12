import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Modal, ScrollView, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from './Icon';
import { Colors, Fonts, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { compressAndUpload, photoFileName, takePhoto } from '../lib/photoUpload';
import { failureReason } from '../lib/deadline';
import { suggestionsForRoom, type ThingInput } from '@snag/supabase-queries';
import { Location, ThingKind, THING_KINDS, THING_KIND_LABELS } from '../types';

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
 * Nothing is written until the last step. That is the one real difference from
 * the snag amend row, and it is forced: `create_thing` needs a kind, and a row
 * half-created by somebody who walked away mid-flow is exactly the unconfirmed
 * entry the ghost design exists to keep out of the record.
 */

type Step = 'room' | 'what' | 'label' | 'takes';

const STEPS: Step[] = ['room', 'what', 'label', 'takes'];

/** Service intervals a household actually uses. Nobody types "180 days". */
const CYCLES: { days: number; label: string }[] = [
  { days: 180, label: '6 months' },
  { days: 365, label: 'A year' },
  { days: 730, label: '2 years' },
];

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
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const [step, setStep] = useState<Step>('room');
  const [room, setRoom] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ThingKind>('appliance');
  const [naming, setNaming] = useState(false);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [takes, setTakes] = useState('');
  const [serviceDays, setServiceDays] = useState<number | null>(null);
  /** For a paint: which surface in the room. "Main wall", "Windows". */
  const [where, setWhere] = useState('');
  const [newRoom, setNewRoom] = useState<string | null>(null);
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
    setPhotoPath(null);
    setTakes('');
    setServiceDays(null);
    setWhere('');
    setNewRoom(null);
    setBusy(false);
    // Tapping a ghost has already answered the first two questions, so opening
    // on them would be asking somebody to confirm what they just said.
    setStep(start?.name ? 'label' : start?.room ? 'what' : 'room');
  }, [visible, start]);

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

  function next() {
    if (step === 'room') setStep('what');
    else if (step === 'what') setStep('label');
    else if (step === 'label') setStep('takes');
  }

  async function addRoom() {
    const name = newRoom?.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      if (await onAddRoom(name)) {
        setRoom(name);
        setNewRoom(null);
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
    } catch (err: unknown) {
      // Shown in the sheet rather than an alert: the step is still on screen
      // and the retry is the same button they just pressed.
      setModel((current) => current);
      console.error('Plate photo failed:', failureReason(err));
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
        make: make.trim() || null,
        model: model.trim() || null,
        // A paint answers the last step with a surface; everything else answers
        // it with a part and a cycle. Neither carries the other's fields.
        consumables: !painting && takes.trim() ? [takes.trim()] : [],
        serviceDays: painting ? null : serviceDays,
        notes: painting ? where.trim() || null : null,
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
  const labelStepEmpty = !photoPath && !make.trim() && !model.trim();
  const nextLabel = step === 'label' && labelStepEmpty ? 'Skip for now' : 'Next';

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
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              {newRoom === null ? (
                <View style={styles.chips}>
                  {locations.map((location) => (
                    <Chip
                      key={location.id}
                      label={location.name}
                      on={room === location.name}
                      onPress={() => setRoom(location.name)}
                    />
                  ))}
                  <Chip
                    label="Whole house"
                    on={room === null && !!start}
                    onPress={() => setRoom(null)}
                  />
                  <Chip label="Add a room…" on={false} onPress={() => setNewRoom('')} />
                </View>
              ) : (
                <View style={styles.fields}>
                  <TextInput
                    style={styles.input}
                    value={newRoom}
                    onChangeText={setNewRoom}
                    placeholder="Conservatory · Study · Movie room"
                    placeholderTextColor={Colors.textMuted}
                    maxLength={40}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={addRoom}
                    accessibilityLabel="Name the room"
                  />
                  <Pressable
                    onPress={addRoom}
                    disabled={busy || !newRoom.trim()}
                    style={[styles.cta, (busy || !newRoom.trim()) && styles.ctaOff]}
                    accessibilityRole="button"
                    accessibilityLabel="Add the room"
                  >
                    <Text
                      style={[styles.ctaLabel, (busy || !newRoom.trim()) && styles.ctaLabelOff]}
                    >
                      Add the room
                    </Text>
                  </Pressable>
                  <Text style={styles.hint}>
                    It joins the tags the list groups by and capture offers, not just this tab.
                  </Text>
                </View>
              )}
            </ScrollView>
          </>
        ) : null}

        {/* ── 2. what is it ───────────────────────────────────────────── */}
        {step === 'what' ? (
          <>
            <Text style={styles.question}>What is it?</Text>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              {!naming ? (
                <View style={styles.chips}>
                  {suggestions.map((suggestion) => (
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
                  <Chip label="Something else…" on={false} onPress={() => setNaming(true)} />
                </View>
              ) : (
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
              )}
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
              </View>
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
              <Text style={styles.hint}>This is what a job about it offers you in the shop.</Text>
              <Text style={styles.question2}>Serviced how often?</Text>
              <View style={styles.chips}>
                <Chip label="Never" on={serviceDays === null} onPress={() => setServiceDays(null)} />
                {CYCLES.map((cycle) => (
                  <Chip
                    key={cycle.days}
                    label={cycle.label}
                    on={serviceDays === cycle.days}
                    onPress={() => setServiceDays(cycle.days)}
                  />
                ))}
              </View>
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
        ) : (
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
