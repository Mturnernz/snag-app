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

/**
 * Capture: a photo, a title, a room. Nothing else.
 *
 * This is the screen someone uses standing in the bathroom holding a broken
 * toilet seat, with about ten seconds of patience. Priority, effort, whether
 * it needs parts, when it's due and who's doing it are all real and all
 * useful — and every one of them is friction here. They're set later, from the
 * list, by someone sitting down. Two moments, two screens.
 *
 * Resist adding a field to this form. The place for it is triage.
 */
export default function CaptureScreen() {
  const { household, property, rooms, refresh } = useHousehold();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [room, setRoom] = useState('');
  const [saving, setSaving] = useState(false);
  const [photosBlocking, setPhotosBlocking] = useState(false);
  const photoPicker = useRef<PhotoPickerHandle>(null);

  const canSave = title.trim().length > 0 && !!property && !photosBlocking && !saving;

  async function handleSave() {
    if (!property) return;
    setSaving(true);
    try {
      const photoPaths = (await photoPicker.current?.getPhotoUrls()) ?? [];
      await createSnag({
        propertyId: property.id,
        title: title.trim(),
        room: room.trim() || null,
        photoPaths,
      });

      setTitle('');
      setRoom('');
      photoPicker.current?.reset();
      // A newly used room should be offered as a suggestion next time.
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

        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder="Toilet seat is broken"
          placeholderTextColor={Colors.textMuted}
          maxLength={120}
          returnKeyType="done"
          autoFocus={false}
        />

        <Text style={styles.label}>Where is it?</Text>
        <TextInput
          style={styles.roomInput}
          value={room}
          onChangeText={setRoom}
          placeholder="Bathroom"
          placeholderTextColor={Colors.textMuted}
          maxLength={60}
        />

        {/*
          Rooms are free text, and these are simply the ones already used here.
          Nobody administers a list of rooms before they can log a dripping tap
          — but typing "Bathroom" for the twentieth time is friction too.
        */}
        {rooms.length > 0 ? (
          <View style={styles.suggestions}>
            {rooms.slice(0, 8).map((name) => {
              const active = room.trim().toLowerCase() === name.toLowerCase();
              return (
                <Pressable
                  key={name}
                  onPress={() => setRoom(active ? '' : name)}
                  style={[styles.suggestion, active && styles.suggestionActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.suggestionText, active && styles.suggestionTextActive]}>
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.photoSection}>
          <Text style={styles.label}>Photo</Text>
          <PhotoPicker
            ref={photoPicker}
            pathPrefix={household.id}
            onBlockingChange={setPhotosBlocking}
          />
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
          <Text style={styles.hint}>Sort out priority and timing later</Text>
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
    marginBottom: Spacing.sm,
  },
  titleInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.lg,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET,
  },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSecondary,
    marginTop: Spacing.lg,
  },
  roomInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: Typography.base,
    color: Colors.textPrimary,
    minHeight: MIN_TOUCH_TARGET,
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  suggestion: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.chip,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  suggestionActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  suggestionText: { fontSize: Typography.sm, color: Colors.textSecondary },
  suggestionTextActive: { color: Colors.primary, fontWeight: Typography.semibold },
  photoSection: { marginTop: Spacing.xs },
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
