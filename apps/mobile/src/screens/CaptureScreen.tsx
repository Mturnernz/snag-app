import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PhotoPicker, { PhotoPickerHandle } from '../components/PhotoPicker';
import Button from '../components/Button';
import Icon from '../components/Icon';
import { Colors, Radius, Spacing, Typography, MIN_TOUCH_TARGET } from '../constants/theme';
import { useHousehold } from '../hooks/useHousehold';
import { useToast } from '../hooks/useToast';
import { createSnag } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { SnagPriority } from '../types';

/**
 * A photo, a tag, a priority — and a line of description only if there is
 * something a photo can't say.
 *
 * Three taps and no keyboard, in the common case. This is used standing in the
 * bathroom holding a broken toilet seat, so everything here is chosen to be
 * reachable with a thumb:
 *
 * - **No title.** A photo of the thing says what a title would, and requiring
 *   one put a keyboard between someone and the problem in front of them. The
 *   snag needs a photo *or* a description — one with neither is nothing, and
 *   the server says so in words rather than through a constraint name.
 * - **Location is a tag, not a field, and it sits last.** The chips are seeded
 *   per property, so they're full on the day a place exists — a list derived
 *   from past use is empty exactly then. They are also deliberately quiet and
 *   below the description: a snag with no tag is a perfectly good snag, and
 *   twelve solid buttons above the fold read as a required field.
 * - **The place is a picker, and only when there is one to make.** A bach is a
 *   property, not a tag: it has its own people and its own tags.
 * - **Priority is here, not in triage.** It is the one judgement only the
 *   person standing there can make — whether this is a today problem or a
 *   someday one. Two values, because a third would need thinking about.
 *
 * Everything else — effort, needs-parts, due date, repeat, who's doing it —
 * still belongs on the detail screen. Resist adding a fifth thing here.
 */
export default function CaptureScreen() {
  const { household, properties, activeProperty, setActiveProperty, locations, refresh } = useHousehold();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  const [room, setRoom] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<SnagPriority>('low');
  const [photoCount, setPhotoCount] = useState(0);
  const [photosBlocking, setPhotosBlocking] = useState(false);
  const [saving, setSaving] = useState(false);
  const photoPicker = useRef<PhotoPickerHandle>(null);

  // Mirrors the server's rule so the button explains itself before it refuses.
  const hasSomething = photoCount > 0 || description.trim().length > 0;
  const canSave = hasSomething && !!activeProperty && !photosBlocking && !saving;

  async function handleSave() {
    if (!activeProperty) return;
    setSaving(true);
    try {
      const photoPaths = (await photoPicker.current?.getPhotoUrls()) ?? [];
      await createSnag({
        propertyId: activeProperty.id,
        room,
        description: description.trim() || null,
        photoPaths,
        priority,
      });

      setRoom(null);
      setDescription('');
      setPriority('low');
      photoPicker.current?.reset();
      refresh();
      showToast('Added to the list');
    } catch (err: any) {
      showAlert("Couldn't save that", err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>What needs doing?</Text>

        {/*
          Only when there is somewhere else it could go. A picker offering one
          option is a question with one answer, and the retired product's
          equivalent taught the other half of this lesson: when it silently
          picked for you, a report filed against the wrong place looked like a
          permissions problem to whoever hit it.
        */}
        {properties.length > 1 ? (
          <View style={styles.properties}>
            {properties.map((candidate) => {
              const active = activeProperty?.id === candidate.id;
              return (
                <Pressable
                  key={candidate.id}
                  onPress={() => setActiveProperty(candidate.id)}
                  style={[styles.property, active && styles.propertyActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Icon
                    name={active ? 'home' : 'home-outline'}
                    size="sm"
                    color={active ? Colors.white : Colors.textSecondary}
                  />
                  <Text style={[styles.propertyLabel, active && styles.propertyLabelActive]}>
                    {candidate.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* The photo leads, because it is usually the whole report. */}
        <PhotoPicker
          ref={photoPicker}
          pathPrefix={household.id}
          onBlockingChange={setPhotosBlocking}
          onPhotosChange={setPhotoCount}
        />

        <Text style={styles.label}>How urgent?</Text>
        <View style={styles.priorityRow}>
          <Pressable
            onPress={() => setPriority('high')}
            style={[styles.priority, priority === 'high' && styles.priorityHighActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: priority === 'high' }}
          >
            <Icon
              name="alert-circle-outline"
              size="md"
              color={priority === 'high' ? Colors.white : Colors.textSecondary}
            />
            <Text style={[styles.priorityLabel, priority === 'high' && styles.priorityLabelActive]}>
              High
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPriority('low')}
            style={[styles.priority, priority === 'low' && styles.priorityLowActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: priority === 'low' }}
          >
            <Icon
              name="time-outline"
              size="md"
              color={priority === 'low' ? Colors.textPrimary : Colors.textSecondary}
            />
            <Text style={[styles.priorityLabel, priority === 'low' && styles.priorityLowLabelActive]}>
              Low
            </Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Anything to add? <Text style={styles.optional}>Optional</Text></Text>
        <TextInput
          style={styles.description}
          value={description}
          onChangeText={setDescription}
          placeholder="Hinge has sheared off"
          placeholderTextColor={Colors.textMuted}
          maxLength={200}
          multiline
        />

        {/*
          Last, and quiet on purpose.

          These are a suggestion, not a question to be answered. A snag with no
          tag is a perfectly good snag — it lands in the list and the weekend
          view groups it under "Everywhere else" — so a row of twelve solid
          buttons above the description was overstating the case, and put a
          decision in front of someone who had already taken the photo they
          came to take.

          So: below everything, small, and unfilled until one is picked. The pill
          carries a hairline outline — without one, nothing said these were
          pressable at all — but the outline sits on the pill, not on the touch
          target, which stays MIN_TOUCH_TARGET and invisible around it. Twelve
          48px outlined boxes would say "required field" all over again. The
          checkmark carries the selected state alongside the tint, so it isn't
          colour alone.

          Nothing here is a closed list: Profile → Location tags edits it.
        */}
        <View style={styles.tagBlock}>
          <Text style={styles.tagHint}>
            Where is it? <Text style={styles.optional}>Optional</Text>
          </Text>
          <View style={styles.tags}>
            {locations.map((location) => {
              const active = room === location.name;
              return (
                <Pressable
                  key={location.id}
                  onPress={() => setRoom(active ? null : location.name)}
                  style={styles.tagTap}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <View style={[styles.tag, active && styles.tagActive]}>
                    {active ? <Icon name="checkmark" size="sm" color={Colors.primary} /> : null}
                    <Text style={[styles.tagLabel, active && styles.tagLabelActive]}>
                      {location.name}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.actionBar, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Button
          label="Add to the list"
          onPress={handleSave}
          loading={saving}
          disabled={!canSave}
          fullWidth
          icon="add-circle-outline"
        />
        <View style={styles.hintRow}>
          <Icon name="information-circle-outline" size="sm" color={Colors.textMuted} />
          <Text style={styles.hint}>
            {hasSomething ? 'Sort out timing and effort later' : 'A photo or a few words is enough'}
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  heading: {
    fontSize: Typography.xxl,
    fontWeight: Typography.bold,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginTop: Spacing.lg,
  },
  optional: { fontWeight: Typography.regular, color: Colors.textMuted },
  properties: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
  property: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.button,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  propertyActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  propertyLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  propertyLabelActive: { color: Colors.white, fontWeight: Typography.semibold },
  tagBlock: {
    marginTop: Spacing.xl,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  tagHint: { fontSize: Typography.sm, color: Colors.textMuted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.xs },
  // The tap area and the visible pill are different sizes, deliberately.
  //
  // Borderless text gave no affordance at all: nothing said the room names were
  // things you could press. A hairline outline says it — but wrapping a 48px
  // target in that outline would draw twelve boxes the size of buttons, which is
  // the "this is a required field" reading the row was moved down here to
  // escape. So the outline goes on a small pill and the 48px target stays
  // invisible around it.
  tagTap: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.chip,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tagActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primaryLight },
  tagLabel: { fontSize: Typography.sm, color: Colors.textMuted },
  tagLabelActive: { color: Colors.textPrimary, fontWeight: Typography.semibold },
  priorityRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  priority: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: Radius.button,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  priorityHighActive: { backgroundColor: Colors.priority.high, borderColor: Colors.priority.high },
  // Selected, not alarming. Filling Low with the ink made the quieter of two
  // choices the heavier-looking one, and put a second saturated block on a
  // screen whose only alert colour is meant to be High. Selection is carried by
  // the well, the border and the weight instead — three differences, none of
  // them a hue.
  priorityLowActive: { backgroundColor: Colors.sunken, borderColor: Colors.border },
  priorityLabel: {
    fontSize: Typography.base,
    fontWeight: Typography.medium,
    color: Colors.textSecondary,
  },
  priorityLabelActive: { color: Colors.white, fontWeight: Typography.semibold },
  priorityLowLabelActive: { color: Colors.textPrimary, fontWeight: Typography.semibold },
  description: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET + Spacing.lg,
    marginTop: Spacing.xs,
    textAlignVertical: 'top',
  },
  actionBar: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
  },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  hint: { fontSize: Typography.sm, color: Colors.textMuted },
});
